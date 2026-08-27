import { useState, useEffect, useRef, lazy, Suspense, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { createPortal } from 'react-dom';
import { Search, ShoppingCart, Trash2, CheckCircle, Camera, Plus, X, Phone, Calendar, UserCheck, Edit, Loader2, Send, Zap, Printer, MessageSquare, FileText } from 'lucide-react';
import AICamera from '../../components/AICamera';
import { api, apiClient, getCompactInventoryCache, isCompactInventoryCacheReady,
  type SpecialOrder, type CompactInventoryItem } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { toastEvent } from '../../services/events';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useFetchMode } from '../../hooks/useFetchMode';
import { StagedQueueFloatingWidget } from '../../components/StagedQueueFloatingWidget';
import { stagedQueueService, type StagedItem } from '../../services/stagedQueueService';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { isExpiredDate, toDateInputValue } from '../../utils/date';
import { printCurrentBill } from '../../utils/printBill';
import { useDraftStore } from '../../lib/cache/useDraftStore';

const getLocalDateString = (d: Date = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parsePackSizeFromPackaging = (packaging: string | null | undefined): number | null => {
  if (!packaging) return null;
  const trimmed = packaging.trim();
  const stripOfMatch = trimmed.match(/^\s*(?:STRIP|PACK|BOX|BLISTER)\s+OF\s+(\d+)/i);
  if (stripOfMatch) {
    const size = parseInt(stripOfMatch[1], 10);
    if (size > 0) return size;
  }
  const bottleOfMatch = trimmed.match(/^\s*BOTTLE\s+OF\s+(\d+)/i);
  if (bottleOfMatch) {
    const size = parseInt(bottleOfMatch[1], 10);
    if (size > 0) return size;
  }
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }
  const match = trimmed.match(/^(\d+)/);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  return size > 0 ? size : null;
};

const UniversalMedicineEditModal = lazy(() => import('../../components/UniversalMedicineEditModal').then(m => ({ default: m.UniversalMedicineEditModal })));

const ModalSkeleton = () => (
  <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
    <div className="absolute inset-0 bg-bg/80 backdrop-blur-md" />
    <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden slide-up">
      <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-6 w-32 bg-glass-border/40 rounded animate-pulse" />
        </div>
        <div className="h-8 w-8 bg-glass-border/40 rounded-full animate-pulse" />
      </div>
      <div className="p-6 space-y-4 overflow-y-auto">
        <div className="h-10 bg-glass-border/30 rounded-xl animate-pulse" />
        <div className="h-40 bg-glass-border/20 rounded-xl animate-pulse" />
      </div>
    </div>
  </div>
);

interface CartRow {
  id: number | string;
  medicine_id?: number | string;
  inventory_id?: number | string;
  name?: string;
  medicine_name?: string;
  batch?: string;
  batch_no?: string;
  batch_number?: string;
  expiry?: string;
  expiry_date?: string;
  mrp?: number;
  item_mrp?: number | string;
  sell_price?: number | string | null;
  unit_price?: number;
  unitPrice?: number;
  cost_price?: number | null;
  costPrice?: number | null;
  qty?: number;
  quantity?: number;
  looseQty?: number;
  loose_qty?: number;
  loose_quantity?: number;
  discount?: number;
  discount_per?: number;
  discountPer?: number;
  packSize?: number;
  pack_size?: number | null;
  gst_percent?: number;
  stock_qty?: number;
  availableStock?: number;
  availableLooseStock?: number;
  salts?: string;
  isEmptyRow?: boolean;
  allow_loose_sale?: number | boolean;
  alternative_batches?: unknown[];
  alternatives?: PosBatchItem[];
  scanImage?: string;
  rawOcrText?: string;
  hsn_code?: string;
  api_reference?: string;
  manufacturer?: string;
  packaging?: string | null;
  is_out_of_stock?: boolean;
  batch_quantity?: number;
  gst?: number | string;
  tax_percent?: number | string;
  item_code?: string;
  short_code?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  [key: string]: unknown;
}

interface PosBatchItem {
  id?: number | string;
  medicine_id?: number | string;
  inventory_id?: number | string;
  name?: string;
  medicine_name?: string;
  item_code?: string;
  short_code?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  batch_no?: string;
  expiry_date?: string;
  expiry?: string;
  quantity?: number;
  stock_qty?: number;
  loose_quantity?: number;
  mrp?: number;
  cost_price?: number | null;
  unit_price?: number;
  sell_price?: number | string | null;
  pack_size?: number | null;
  packaging?: string | null;
  manufacturer?: string;
  salts?: string;
  hsn_code?: string;
  api_reference?: string;
  alternatives?: PosBatchItem[];
  is_out_of_stock?: boolean;
  discount?: number;
  batch_quantity?: number;
  __fefoRank?: string;
  scanImage?: string;
  rawOcrText?: string;
  [key: string]: unknown;
}

interface POSTab {
  id: string;
  title?: string;
  name?: string;
  patientName?: string;
  patientPhone?: string;
  selectedCustomerId?: number | null;
  refillEnabled?: boolean;
  refillDays?: number;
  doctor?: string;
  isManualDoctor?: boolean;
  selectedDoctorId?: number | null;
  discount?: number;
  sendWhatsApp?: boolean;
  paymentMedium?: string;
  items?: CartRow[];
  prescriptions?: unknown[];
}

interface EditSaleLine {
  id?: number;
  inventory_id?: number;
  medicine_id?: number;
  medicine_name?: string;
  name?: string;
  product_name?: string;
  batch_number?: string;
  batch_no?: string;
  expiry_date?: string;
  item_mrp?: number | string;
  mrp?: number | string;
  unit_price?: number | string;
  rate?: number | string;
  sell_price?: number | string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  loose_qty?: number | string | null;
  looseQty?: number | string | null;
  pack_size?: number | string | null;
  packSize?: number | string | null;
  discount_per?: number | string | null;
  discount?: number | string | null;
  stock_qty?: number | string | null;
  loose_quantity?: number | string | null;
}

interface PosEditSale {
  id: number | string;
  invoice_no?: string;
  customer_name?: string;
  customer_phone?: string;
  doctor_name?: string;
  discount?: number | string;
  payment_medium?: string;
  date?: string;
  items?: EditSaleLine[];
  sale_items?: EditSaleLine[];
}

interface PrefillMed {
  is_ready?: number;
  stock_verified_override?: number;
  medicineId?: number;
  medicine_id?: number;
  medicineName?: string;
  medicine_name?: string;
  name?: string;
  quantity?: number | string;
  quantity_needed?: number | string;
  qty?: number | string;
  looseQty?: number | string;
  loose_qty?: number | string;
  loose_quantity?: number | string;
  packaging?: string | null;
  pack_size?: number | string;
  packSize?: number | string;
  sell_price?: number | string | null;
  mrp?: number | string;
  unit_price?: number | string;
  unitPrice?: number | string;
  discount?: number | string;
  batch_no?: string;
  expiry_date?: string;
  inventory_id?: number;
  id?: number;
}

interface PosPrefill {
  patientName?: string;
  patientPhone?: string;
  advancePayment?: number | string;
  specialOrderId?: number;
  customerId?: number;
  selectedCustomerId?: number;
  refillPatient?: boolean;
  refillId?: number;
  refillDays?: number;
  doctorName?: string;
  doctor?: string;
  medicines?: PrefillMed[];
  medicineId?: number;
  medicineName?: string;
  medicine?: PrefillMed;
  item?: PrefillMed;
  quantity?: number | string;
  qty?: number | string;
  refillIds?: number[];
}

interface PosLocationState {
  editSale?: PosEditSale;
  prefill?: PosPrefill;
}

type LocalApiError = { response?: { data?: { error?: string; message?: string; layer?: string } }; message?: string; layer?: string };

interface MedicineQuickDetails {
  mrp?: number | string;
  sell_price?: number | string | null;
  packaging?: string | null;
  pack_size?: number | string | null;
  api_reference?: string;
  hsn_code?: string;
  alternatives?: PosBatchItem[];
}

interface DoctorSuggestion {
  id: number;
  name: string;
  most_common_qty?: number;
  most_common_loose_qty?: number;
  frequency?: number;
  specialization?: string;
  specialty?: string;
  phone?: string;
  clinic_name?: string;
  address?: string;
  reg_no?: string;
  registration_number?: string;
}

interface PatientSuggestion {
  id: number;
  name: string;
  phone?: string;
  credit_balance?: number;
  credit_enabled?: number;
  last_sale_date?: string;
  purchase_count?: number;
  active_refill?: number;
  last_purchase_date?: string;
}

interface PatientLookupResponse {
  suggestions?: PatientSuggestion[];
  isSuggestion?: boolean;
}

interface MedSuggestion {
  name: string;
  medicine_id?: number;
  api_reference?: string;
  manufacturer?: string;
}

interface MatchedRefill extends PrefillMed {
  patient_name?: string;
  patient_phone?: string;
  doctor_name?: string;
  medicines?: PrefillMed[];
}

interface RefillPanelGroup {
  patient_name?: string;
  patient_phone?: string;
  customer_id?: number;
  next_refill_date?: string;
  medicines?: PrefillMed[];
}


interface ScanResultInfo {
  text?: string;
  capturedImage?: string;
  scanImage?: string;
  rawOcrText?: string;
  medicineInfo?: { batchNumber?: string; potentialName?: string; mrp?: number | string; packaging?: string | null; expiryDate?: string; costPrice?: number | string | null };
}

interface SavedBillItemRow {
  name?: string;
  batch?: string;
  qty?: number | string;
  looseQty?: number | string;
  discountPer?: number;
  amount?: number;
}

interface StagedLine {
  id?: number;
  inventory_id?: number;
  medicine_id?: number;
  name?: string;
  medicine_name?: string;
  batch_no?: string;
  mrp?: number | string;
  sell_price?: number | string | null;
  rate?: number | string;
  quantity?: number | string | null;
  qty?: number | string | null;
  loose_qty?: number | string | null;
  discount?: number | string | null;
  pack_size?: number | string | null;
  availableStock?: number | string | null;
  stock_qty?: number | string | null;
  loose_quantity?: number | string | null;
  looseQty?: number | string | null;
  unit_price?: number | string | null;
  cost_price?: number | string | null;
  batch_number?: string;
  batch?: string;
  expiry_date?: string;
  expiry?: string;
  salts?: string;
}

function writeRef<T>(ref: { current: T }, value: T): void {
  ref.current = value;
}

const generatePatientDisplayId = (): string => 'P-' + Math.floor(100000 + Math.random() * 900000);

const getInitialPOSTabs = (): POSTab[] => {
  const defaultTab = {
    id: 'default',
    title: 'Cart 1',
    patientName: '',
    patientPhone: '',
    selectedCustomerId: null,
    refillEnabled: false,
    refillDays: 30,
    items: [],
    prescriptions: []
  };

  const savedTabsJson = localStorage.getItem('pos_active_tabs');
  if (savedTabsJson) {
    try {
      const parsed = JSON.parse(savedTabsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as POSTab[]).map((t, idx) => ({
          ...defaultTab,
          ...t,
          id: t.id || `tab_${idx}_${Date.now()}`
        }));
      }
    } catch (e) {
      console.error('Failed to parse pos_active_tabs from localStorage:', e);
    }
  }

  return [defaultTab];
};

const getInitialPOSActiveTabId = (initialTabs: POSTab[]) => {
  const saved = localStorage.getItem('pos_active_tab_id');
  if (saved && initialTabs.some(t => t.id === saved)) return saved;
  return initialTabs[0]?.id || 'default';
};

// E3: hard cap on recursive nesting so pathological/cyclic `alternatives`
// data can never cause runaway recursion.
const GROUP_BATCHES_MAX_DEPTH = 3;

// Per-call memoization: keyed by medicine id, but only reused when the exact
// same input array reference is seen again (so results never go stale) —
// avoids recomputing the same medicine's alternatives subtree repeatedly
// within a single groupBatches() invocation/render cycle.
const groupBatchesInternal = (
  items: PosBatchItem[],
  depth: number,
  cache: Map<number, { input: PosBatchItem[]; output: PosBatchItem[] }>
): PosBatchItem[] => {
  const grouped: PosBatchItem[] = [];
  const map = new Map<number, PosBatchItem>();

  // FEFO rank for choosing which batch the sale will actually target:
  // batches that still have strips beat loose-only batches; among those, earliest expiry wins.
  const fefoRank = (stripQty: number, exp?: string) =>
    `${Number(stripQty) > 0 ? 0 : 1}|${exp || '9999-12'}`;

  const groupAlternatives = (medId: number, altItems: PosBatchItem[]): PosBatchItem[] => {
    if (depth >= GROUP_BATCHES_MAX_DEPTH) return [];
    const cached = cache.get(medId);
    if (cached && cached.input === altItems) {
      return cached.output;
    }
    const output = groupBatchesInternal(altItems, depth + 1, cache);
    cache.set(medId, { input: altItems, output });
    return output;
  };

  for (const item of items) {
    // Exclude expired batches strictly from POS sales
    if (isExpiredDate(item.expiry_date || item.expiry)) continue;

    const medId = Number(item.medicine_id || item.inventory_id) || Math.random();
    const stripQty = Number(item.quantity || 0);
    if (!map.has(medId)) {
      const copy: PosBatchItem = {
        ...item,
        quantity: stripQty, // running total across batches (display only)
        batch_quantity: stripQty, // stock of the chosen batch — what the sale can actually use
        loose_quantity: item.loose_quantity || 0,
        __fefoRank: fefoRank(stripQty, item.expiry_date)
      };
      if (item.alternatives && Array.isArray(item.alternatives)) {
        copy.alternatives = groupAlternatives(medId, item.alternatives);
      } else {
        copy.alternatives = [];
      }
      map.set(medId, copy);
      grouped.push(copy);
    } else {
      const existing = map.get(medId)!;
      existing.quantity = (existing.quantity || 0) + stripQty;

      // FEFO (First Expiry, First Out): adopt this batch if it ranks better,
      // keeping its OWN stock figures so the cart never mixes one batch's id with another's quantity.
      const rank = fefoRank(stripQty, item.expiry_date);
      if (rank < existing.__fefoRank!) {
        existing.__fefoRank = rank;
        existing.inventory_id = item.inventory_id;
        existing.batch_no = item.batch_no;
        existing.expiry_date = item.expiry_date;
        existing.mrp = item.mrp;
        existing.cost_price = item.cost_price;
        existing.unit_price = item.unit_price;
        existing.batch_quantity = stripQty;
        existing.loose_quantity = item.loose_quantity || 0;
      }

      if (item.alternatives && Array.isArray(item.alternatives) && item.alternatives.length > 0) {
        existing.alternatives = depth >= GROUP_BATCHES_MAX_DEPTH
          ? existing.alternatives
          : groupBatchesInternal([...(existing.alternatives ?? []), ...(item.alternatives ?? [])], depth + 1, cache);
      }
    }
  }
  return grouped;
};

const groupBatches = (items: PosBatchItem[]): PosBatchItem[] => {
  return groupBatchesInternal(items, 0, new Map<number, { input: PosBatchItem[]; output: PosBatchItem[] }>());
};

// Stable empty array reference to prevent reference-mismatch state updates
const EMPTY_ARRAY: never[] = [];


const filterLocalInventory = (query: string, inventory: PosBatchItem[]): PosBatchItem[] => {
  if (!query || query.trim().length < 2) return [];
  const term = query.trim().toLowerCase();
  
  // Filter strictly for items present in active inventory with positive stock AND NOT EXPIRED
  const validInventory = inventory.filter(item => {
    const hasInventory = !!item.inventory_id && (Number(item.stock_qty || item.quantity || 0) > 0 || Number(item.loose_quantity || 0) > 0);
    const expired = isExpiredDate(item.expiry_date || item.expiry);
    return hasInventory && !expired;
  });

  // Prefix matches first
  const prefixes = validInventory.filter(item => 
    (item.medicine_name && item.medicine_name.toLowerCase().startsWith(term)) ||
    (item.name && item.name.toLowerCase().startsWith(term)) ||
    (item.item_code && item.item_code.toLowerCase().startsWith(term)) ||
    (item.short_code && item.short_code.toLowerCase().startsWith(term)) ||
    (item.therapeutic && item.therapeutic.toLowerCase().startsWith(term)) ||
    (item.sub_therapeutic && item.sub_therapeutic.toLowerCase().startsWith(term)) ||
    (item.batch_no && item.batch_no.toLowerCase().startsWith(term))
  );
  
  if (prefixes.length >= 15) {
    return prefixes.slice(0, 30);
  }
  
  // Infix matches second
  const infixes = validInventory.filter(item => 
    ((item.medicine_name && item.medicine_name.toLowerCase().includes(term)) ||
    (item.name && item.name.toLowerCase().includes(term)) ||
    (item.item_code && item.item_code.toLowerCase().includes(term)) ||
    (item.short_code && item.short_code.toLowerCase().includes(term)) ||
    (item.therapeutic && item.therapeutic.toLowerCase().includes(term)) ||
    (item.sub_therapeutic && item.sub_therapeutic.toLowerCase().includes(term)) ||
    (item.batch_no && item.batch_no.toLowerCase().includes(term))) &&
    !(item.medicine_name && item.medicine_name.toLowerCase().startsWith(term)) &&
    !(item.name && item.name.toLowerCase().startsWith(term)) &&
    !(item.item_code && item.item_code.toLowerCase().startsWith(term)) &&
    !(item.short_code && item.short_code.toLowerCase().startsWith(term)) &&
    !(item.therapeutic && item.therapeutic.toLowerCase().startsWith(term)) &&
    !(item.batch_no && item.batch_no.toLowerCase().startsWith(term))
  );
  
  return [...prefixes, ...infixes].slice(0, 30);
};

const mapEditSaleItemsToCart = (itemsList: EditSaleLine[]): CartRow[] => {
  if (!Array.isArray(itemsList) || itemsList.length === 0) return [];
  const mapped: CartRow[] = itemsList.map((it, idx) => {
    const itemQty = it.quantity !== undefined && it.quantity !== null 
      ? Number(it.quantity) 
      : (it.qty !== undefined && it.qty !== null ? Number(it.qty) : 0);
    const itemLooseQty = it.loose_qty !== undefined && it.loose_qty !== null
      ? Number(it.loose_qty)
      : (it.looseQty !== undefined && it.looseQty !== null ? Number(it.looseQty) : 0);
    const packSize = Math.max(1, Number(it.pack_size || it.packSize || 1));
    const unitPrice = Number(it.unit_price !== undefined && it.unit_price !== null ? it.unit_price : (it.rate || it.sell_price || it.mrp || 0));
    return {
      id: it.id ? `edit_item_${it.id}` : (it.inventory_id ? `inv_item_${it.inventory_id}_${idx}` : `item_${idx}_${Date.now()}`),
      inventory_id: it.inventory_id || it.id,
      medicine_id: it.medicine_id,
      name: it.medicine_name || it.name || it.product_name || 'Medicine',
      batch: it.batch_number || it.batch_no || '',
      expiry: it.expiry_date || '',
      mrp: Number(it.item_mrp ?? it.mrp ?? unitPrice ?? 0),
      sell_price: unitPrice,
      qty: itemQty,
      quantity: itemQty,
      unitPrice: unitPrice,
      looseQty: itemLooseQty,
      discount: Number(it.discount_per !== undefined ? it.discount_per : (it.discount || 0)),
      packSize: packSize,
      availableStock: Number(it.stock_qty ?? it.quantity ?? itemQty),
      availableLooseStock: Number(it.loose_quantity ?? it.loose_qty ?? itemLooseQty),
      isEmptyRow: false
    };
  });

// Append trailing empty row for fast subsequent entries
  mapped.push(makeEmptyCartRow());
  return mapped;
};

function makeEmptyCartRow(): CartRow {
  return {
    id: 'empty_row_' + Date.now(),
    name: '',
    batch: '',
    expiry: '',
    mrp: 0,
    qty: 0,
    looseQty: 0,
    discount: 0,
    packSize: 1,
    isEmptyRow: true
  };
}

// Universal FEFO Batch Allocator: Distributes requested quantity across unexpired batches
// eslint-disable-next-line react-refresh/only-export-components -- allocator shared by POS flows
export function allocateMedicineBatches(params: {
  medicineId: number;
  medicineName: string;
  requestedQty: number;
  requestedLooseQty: number;
  packSize?: number;
  fallbackItem?: Partial<CartRow>;
  compactInventory: CompactInventoryItem[];
  editingInvoiceId?: number | null;
}): CartRow[] {
  const { medicineId, medicineName, compactInventory, editingInvoiceId, requestedQty, requestedLooseQty } = params;
  const pSize = Math.max(1, params.packSize || params.fallbackItem?.packSize || params.fallbackItem?.pack_size || 1);
  const totalRequestedTablets = (requestedQty * pSize) + (requestedLooseQty || 0);

  // 1. Find all active unexpired batches for this medicine
  const activeBatches = (compactInventory || [])
    .filter(item => {
      const idMatch = medicineId > 0 && (item.medicine_id === medicineId || item.id === medicineId);
      const nameMatch = Boolean(medicineName && (item.name || item.medicine_name) && (item.name || item.medicine_name).toLowerCase().trim() === medicineName.toLowerCase().trim());
      const hasStock = ((item.stock_qty !== undefined ? item.stock_qty : item.quantity) || 0) > 0 || (item.loose_quantity || 0) > 0;
      return (idMatch || nameMatch) && hasStock;
    })
    .map(item => {
      const expiryStr = item.expiry_date || '';
      let isExpired = false;
      if (expiryStr) {
        let expDate: Date;
        if (expiryStr.includes('/')) {
          const parts = expiryStr.split('/');
          let year = parseInt(parts[1], 10);
          const month = parseInt(parts[0], 10) - 1;
          if (year < 100) year += 2000;
          expDate = new Date(year, month + 1, 0);
        } else {
          expDate = new Date(expiryStr);
        }
        if (expDate < new Date()) isExpired = true;
      }
      return { 
        ...item, 
        stock_qty: item.stock_qty !== undefined ? item.stock_qty : (item.quantity || 0),
        loose_quantity: item.loose_quantity || 0,
        isExpired 
      };
    })
    .filter(item => !item.isExpired);

  // 2. If no active batches in inventory cache, fall back to fallback item or single row
  if (activeBatches.length === 0) {
    if (editingInvoiceId || params.fallbackItem) {
      const refItem = params.fallbackItem || {};
      return [{
        ...refItem,
        id: refItem.inventory_id || refItem.id || `item_${medicineId}_${Date.now()}`,
        inventory_id: refItem.inventory_id || (typeof refItem.id === 'number' && refItem.id < 1000000000 ? refItem.id : undefined),
        medicine_id: medicineId || refItem.medicine_id,
        name: medicineName || refItem.name,
        medicine_name: medicineName || refItem.name,
        batch: refItem.batch || refItem.batch_no || '',
        batch_no: refItem.batch_no || refItem.batch || '',
        expiry: refItem.expiry || refItem.expiry_date || '',
        expiry_date: refItem.expiry_date || refItem.expiry || '',
        qty: requestedQty,
        quantity: requestedQty,
        looseQty: requestedLooseQty,
        mrp: Number(refItem.mrp || 0),
        sell_price: refItem.sell_price || null,
        unitPrice: Number(refItem.unitPrice || refItem.unit_price || refItem.sell_price || refItem.mrp || 0),
        discount: Number(refItem.discount || 0),
        packSize: pSize,
        availableStock: Number(refItem.availableStock || refItem.stock_qty || 0),
        availableLooseStock: Number(refItem.availableLooseStock || refItem.loose_quantity || 0),
        alternative_batches: [],
        isEmptyRow: false
      }];
    }
    return [];
  }

  // 3. Sort active batches by FEFO (First Expiry, First Out):
  // Full strips first, then loose-only. Earliest expiry first.
  activeBatches.sort((a, b) => {
    const aHasStrips = (a.stock_qty || 0) > 0 ? 0 : 1;
    const bHasStrips = (b.stock_qty || 0) > 0 ? 0 : 1;
    if (aHasStrips !== bHasStrips) return aHasStrips - bHasStrips;
    
    const parseExpToTimestamp = (str: string) => {
      if (!str) return 9999999999999;
      if (str.includes('/')) {
        const parts = str.split('/');
        let year = parseInt(parts[1], 10);
        const month = parseInt(parts[0], 10) - 1;
        if (year < 100) year += 2000;
        return new Date(year, month + 1, 0).getTime();
      }
      return new Date(str).getTime() || 9999999999999;
    };
    const aTime = parseExpToTimestamp(a.expiry_date || '');
    const bTime = parseExpToTimestamp(b.expiry_date || '');
    if (aTime !== bTime) return aTime - bTime;
    return (a.inventory_id || a.id || 0) - (b.inventory_id || b.id || 0);
  });

  // 4. Distribute the requested quantity across batches
  let remainingTablets = totalRequestedTablets;
  const allocations: CartRow[] = [];
  let totalAvailableTablets = 0;

  for (const batch of activeBatches) {
    const batchStockTablets = (batch.stock_qty || 0) * pSize + (batch.loose_quantity || 0);
    totalAvailableTablets += batchStockTablets;
    
    if (remainingTablets > 0 && batchStockTablets > 0) {
      const takenTablets = Math.min(remainingTablets, batchStockTablets);
      const qty = Math.floor(takenTablets / pSize);
      const looseQty = takenTablets % pSize;

      if (qty > 0 || looseQty > 0) {
        const sellPrice = batch.sell_price !== undefined && batch.sell_price !== null
          ? batch.sell_price
          : (params.fallbackItem?.sell_price || null);
        const mrp = Number(batch.mrp || params.fallbackItem?.mrp || 0);
        let discount = params.fallbackItem?.discount;
        if ((discount === undefined || discount === 0) && sellPrice && Number(sellPrice) > 0 && mrp > 0 && Number(sellPrice) < mrp) {
          discount = parseFloat((((mrp - Number(sellPrice)) / mrp) * 100).toFixed(2));
        }
        const unitPrice = Number(params.fallbackItem?.unitPrice || batch.unit_price || sellPrice || mrp || 0);

        allocations.push({
          ...(params.fallbackItem || {}),
          id: batch.inventory_id || batch.id,
          inventory_id: batch.inventory_id || batch.id,
          medicine_id: batch.medicine_id || medicineId,
          name: batch.name || medicineName,
          medicine_name: batch.name || medicineName,
          batch: batch.batch_no,
          batch_no: batch.batch_no,
          expiry: batch.expiry_date || '',
          expiry_date: batch.expiry_date || '',
          mrp: mrp,
          sell_price: sellPrice,
          qty: qty,
          quantity: qty,
          looseQty: looseQty,
          unitPrice: unitPrice,
          discount: discount || 0,
          packSize: pSize,
          costPrice: batch.cost_price != null ? batch.cost_price : (params.fallbackItem?.costPrice || null),
          availableStock: batch.stock_qty,
          availableLooseStock: batch.loose_quantity,
          alternative_batches: activeBatches.filter(b => (b.inventory_id || b.id) !== (batch.inventory_id || batch.id)),
          isEmptyRow: false
        });
        remainingTablets -= takenTablets;
      }
    }
  }

  // If requested exceeds available stock, cap to maximum
  if (!editingInvoiceId && totalRequestedTablets > totalAvailableTablets && totalAvailableTablets > 0) {
    toastEvent.trigger(`Only ${totalAvailableTablets} units available in stock for "${medicineName}". Capped to available stock.`, "info");
  }

  // If nothing allocated (e.g. 0 requested or 0 stock), return the first batch with 0 qty
  if (allocations.length === 0 && activeBatches.length > 0) {
    const firstB = activeBatches[0];
    const sellPrice = firstB.sell_price !== undefined && firstB.sell_price !== null ? firstB.sell_price : (params.fallbackItem?.sell_price || null);
    const mrp = Number(firstB.mrp || params.fallbackItem?.mrp || 0);
    allocations.push({
      ...(params.fallbackItem || {}),
      id: firstB.inventory_id || firstB.id,
      inventory_id: firstB.inventory_id || firstB.id,
      medicine_id: firstB.medicine_id || medicineId,
      name: firstB.name || medicineName,
      medicine_name: firstB.name || medicineName,
      batch: firstB.batch_no,
      batch_no: firstB.batch_no,
      expiry: firstB.expiry_date || '',
      expiry_date: firstB.expiry_date || '',
      mrp: mrp,
      sell_price: sellPrice,
      qty: 0,
      quantity: 0,
      looseQty: 0,
      unitPrice: Number(params.fallbackItem?.unitPrice || firstB.unit_price || sellPrice || mrp || 0),
      discount: params.fallbackItem?.discount || 0,
      packSize: pSize,
      costPrice: firstB.cost_price != null ? firstB.cost_price : (params.fallbackItem?.costPrice || null),
      availableStock: firstB.stock_qty,
      availableLooseStock: firstB.loose_quantity,
      alternative_batches: activeBatches.filter(b => (b.inventory_id || b.id) !== (firstB.inventory_id || firstB.id)),
      isEmptyRow: false
    });
  }

  return allocations;
};

const POS = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const locState = location.state as PosLocationState;
  const editSaleFromState = locState?.editSale || null;

  const [initialTabs] = useState(() => {
    const baseTabs = getInitialPOSTabs();
    if (editSaleFromState) {
      const editItems = Array.isArray(editSaleFromState.items) 
        ? editSaleFromState.items 
        : (Array.isArray(editSaleFromState.sale_items) ? editSaleFromState.sale_items : []);
      const mapped = mapEditSaleItemsToCart(editItems);
      const activeId = getInitialPOSActiveTabId(baseTabs);
      return baseTabs.map(t => {
        if (t.id === activeId) {
          return {
            ...t,
            patientName: editSaleFromState.customer_name || '',
            patientPhone: editSaleFromState.customer_phone || '',
            doctor: editSaleFromState.doctor_name || '',
            discount: Number(editSaleFromState.discount || 0),
            paymentMedium: editSaleFromState.payment_medium || 'CASH',
            items: mapped.length > 0 ? mapped : t.items || []
          };
        }
        return t;
      });
    }
    return baseTabs;
  });
  const [initialActiveTabId] = useState(() => getInitialPOSActiveTabId(initialTabs));
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [searchTerm, setSearchTerm] = useDraftStore('pos_search_term', '');
  const [showCamera, setShowCamera] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [patientName, setPatientName] = useState(() => editSaleFromState?.customer_name || initialActiveTab.patientName || '');
  const [patientPhone, setPatientPhone] = useState(() => editSaleFromState?.customer_phone || initialActiveTab.patientPhone || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialActiveTab.selectedCustomerId || null);
  const [patientId] = useState(generatePatientDisplayId());
  const [refillEnabled, setRefillEnabled] = useState(initialActiveTab.refillEnabled || false);
  const [refillDays, setRefillDays] = useState(initialActiveTab.refillDays || 30);
  const [activeRefillId, setActiveRefillId] = useState<number | null>(null);
  const [matchedRefill, setMatchedRefill] = useState<MatchedRefill | null>(null);
  const [dismissedRefillId, setDismissedRefillId] = useState<number | null>(null);

  const productSearchRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const skipEmptyRowAutofocusRef = useRef(false);
  // ponytail: generation counter to invalidate stale queueMicrotask closures from addToCart
  // when the cart is replaced wholesale (edit-bill load, tab switch, clear).
  const cartGenerationRef = useRef(0);
  const patientSuggestionsRef = useRef<HTMLDivElement>(null);
  const doctorSuggestionsRef = useRef<HTMLDivElement>(null);
  const patientSectionRef = useRef<HTMLDivElement>(null);
  const doctorSectionRef = useRef<HTMLDivElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const rowSearchResultsRef = useRef<HTMLDivElement>(null);
  const selectedCustomerIdRef = useRef<number | null>(null);
  const justSelectedPatientRef = useRef<boolean>(false);
  const selectedDoctorIdRef = useRef<number | null>(null);
  // Auto-focus Patient Name input on POS page mount so user can immediately start typing
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.getElementById('patient-name-input') as HTMLInputElement | null;
      if (el && document.activeElement !== el) {
        el.focus();
        el.select?.();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState('');
  const [lastSavedItems, setLastSavedItems] = useState<SavedBillItemRow[]>([]);
  const [lastSavedPatientName, setLastSavedPatientName] = useState('');
  const [lastSavedPatientPhone, setLastSavedPatientPhone] = useState('');
  const [lastSavedGrandTotal, setLastSavedGrandTotal] = useState(0);
  const [lastSavedPaymentMedium, setLastSavedPaymentMedium] = useState('CASH');
  const [lastSavedDoctorName, setLastSavedDoctorName] = useState('');
  const [lastSavedWasWhatsAppSent, setLastSavedWasWhatsAppSent] = useState(false);
  const [lastSavedBillDiscount, setLastSavedBillDiscount] = useState(0);
  const [lastSavedCreditDues, setLastSavedCreditDues] = useState<{ invoice_no: string; total_amount: number }[] | null>(null);
  const [lastSavedCreditBalance, setLastSavedCreditBalance] = useState(0);
  const [lastSavedNextRefillDue, setLastSavedNextRefillDue] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(() => Number(editSaleFromState?.id) || null);
  const [editingInvoiceNo, setEditingInvoiceNo] = useState<string | null>(() => (editSaleFromState?.invoice_no || editSaleFromState?.id || null) as string | null);
  const [finalizingStagedSale, setFinalizingStagedSale] = useState<{ id: number } | null>(null);
  // ponytail: stores refill IDs from CRM prefill; cleared after bill save (fulfill call)
  const pendingRefillIdsRef = useRef<number[]>([]);
  const pendingDirectSaveRef = useRef<boolean>(false);
  const [doctor, setDoctor] = useState(() => editSaleFromState?.doctor_name || initialActiveTab.doctor || '');
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const [doctorHighlightIndex, setDoctorHighlightIndex] = useState(-1);
  const [isManualDoctor, setIsManualDoctor] = useState(initialActiveTab.isManualDoctor || false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(initialActiveTab.selectedDoctorId || null);
  const [doctorSuggestions, setDoctorSuggestions] = useState<DoctorSuggestion[]>([]);
  const [, setDoctorComboSuggestions] = useState<DoctorSuggestion[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  
  // Doctor Modal state
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [editingDoctorId, setEditingDoctorId] = useState<number | string | null>(null);
  const [newDoctorName, setNewDoctorName] = useState('');
  const [newDoctorSpecialty, setNewDoctorSpecialty] = useState('');
  const [newDoctorPhone, setNewDoctorPhone] = useState('');
  const [newDoctorClinic, setNewDoctorClinic] = useState('');
  const [newDoctorRegNo, setNewDoctorRegNo] = useState('');
  // Patient autocomplete
  const [patientSuggestions, setPatientSuggestions] = useState<PatientSuggestion[]>([]);
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [isPatientFuzzyMatch, setIsPatientFuzzyMatch] = useState(false);
  const [patientHighlightIndex, setPatientHighlightIndex] = useState(-1);
  const [discount, setDiscount] = useState(() => editSaleFromState?.discount !== undefined ? Number(editSaleFromState.discount || 0) : (initialActiveTab.discount || 0));
  const [date, setDate] = useState(() => editSaleFromState?.date ? editSaleFromState.date.split('T')[0] : getLocalDateString());
  const [cart, setCart] = useState<CartRow[]>(() => {
    if (initialActiveTab.items && initialActiveTab.items.length > 0) {
      return initialActiveTab.items;
    }
    return [makeEmptyCartRow()];
  });
  const [sendWhatsApp, setSendWhatsApp] = useState(initialActiveTab.sendWhatsApp || false); // DEFAULT: OFF
  const [paymentMedium, setPaymentMedium] = useState<string>(() => editSaleFromState?.payment_medium || initialActiveTab.paymentMedium || 'CASH'); // DEFAULT: CASH
  const queryClient = useQueryClient();

  const specialOrdersControl = useFetchMode('pos.specialOrders');
  const doctorsControl = useFetchMode('pos.doctors');

  const handlePosRowInputKeyDown = (e: React.KeyboardEvent, index: number, fieldName: string) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const targetIndex = index + 1;
      if (targetIndex < cart.length) {
        const el = (
          document.querySelector(`input[data-pos-row-index="${targetIndex}"][data-pos-field="${fieldName}"]`) ||
          document.getElementById(`row-${fieldName}-input-${targetIndex}`)
        ) as HTMLInputElement;
        if (el) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          el.focus();
          el.select();
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const targetIndex = index - 1;
      if (targetIndex >= 0) {
        const el = (
          document.querySelector(`input[data-pos-row-index="${targetIndex}"][data-pos-field="${fieldName}"]`) ||
          document.getElementById(`row-${fieldName}-input-${targetIndex}`)
        ) as HTMLInputElement;
        if (el) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          el.focus();
          el.select();
        }
      }
      return;
    }
  };

  // B1: the cart itself loads immediately (lazy-initialized from localStorage,
  // no network call). These three non-essential mount fetches (special orders,
  // common combinations, doctors list) are staggered ~500ms after mount so
  // they don't all compete with the cart/checkout UI for bandwidth/CPU on
  // initial page load.
  // Hydrate POS cart from URL parameters for automatic refill checkouts
  useEffect(() => {
  
    const params = new URLSearchParams(window.location.search);
    const refillPatientName = params.get('refillPatientName');
    const refillPatientPhone = params.get('refillPatientPhone');
    const refillMedicineId = params.get('refillMedicineId');
    const refillMedicineName = params.get('refillMedicineName');
    const refillId = params.get('refillId');
    const refillQty = params.get('refillQty') || '1';
    const refillDaysParam = params.get('refillDays') || '30';

    if (refillPatientName && refillMedicineId && refillMedicineName && refillId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL hydration seeds cart
      setPatientName(refillPatientName);
      setPatientPhone(refillPatientPhone || '');
      setRefillEnabled(true);
      setRefillDays(Number(refillDaysParam));
      setActiveRefillId(Number(refillId));

      const fetchAndAddMedicine = async () => {
        try {
          let compactInv = getCompactInventoryCache();
          if (!compactInv || compactInv.length === 0) {
            try {
              const res = await api.getCompactInventory();
              compactInv = res || getCompactInventoryCache();
            } catch {}
          }
          const targetId = Number(refillMedicineId);
          const targetQty = Number(refillQty) || 1;
          const allocated = allocateMedicineBatches({
            medicineId: targetId,
            medicineName: refillMedicineName,
            requestedQty: targetQty,
            requestedLooseQty: 0,
            compactInventory: compactInv
          });

          if (allocated.length > 0) {
            const emptyTrailingRow = makeEmptyCartRow();
            setCart([...allocated, emptyTrailingRow]);
          } else {
            const results = await api.searchMedicine(refillMedicineName);
            if (results && results.length > 0) {
              const matched = results[0];
              const sellPrice = Number(matched.sell_price || 0);
              const mrp = Number(matched.mrp || 0);
              const autoDisc = (sellPrice > 0 && mrp > 0 && sellPrice < mrp)
                ? parseFloat((((mrp - sellPrice) / mrp) * 100).toFixed(2))
                : 0;
              const cartItem = {
                id: matched.inventory_id || matched.id,
                inventory_id: matched.inventory_id || matched.id,
                medicine_id: targetId || matched.medicine_id || matched.id,
                name: matched.name,
                batch: matched.batch_no || matched.batch_number || '',
                expiry: matched.expiry_date || '',
                mrp: matched.mrp || 0,
                sell_price: matched.sell_price || null,
                qty: Number(refillQty),
                quantity: Number(refillQty),
                unitPrice: matched.unit_price || matched.sell_price || matched.mrp || 0,
                looseQty: 0,
                discount: autoDisc,
                packSize: parsePackSizeFromPackaging(matched.packaging) || matched.pack_size || 1
              };
              const emptyTrailingRow = makeEmptyCartRow();
              setCart([cartItem, emptyTrailingRow]);
            } else {
              toastEvent.trigger(`Refill medicine "${refillMedicineName}" is not available in inventory. Please record a purchase first.`, "error");
            }
          }
        } catch (err) {
          console.error('Failed to resolve refill medicine in POS:', err);
        }
      };
      fetchAndAddMedicine();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Hydrate POS cart from router state parameter when editing an existing bill or prefilling
  useEffect(() => {
      const locState = location.state as PosLocationState;
    if (locState && locState.editSale) {
      const editSale = locState.editSale;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- edit-bill hydration loads invoice
      setEditingInvoiceId(Number(editSale.id) || null);
      setEditingInvoiceNo((editSale.invoice_no || editSale.id || null) as string | null);
      if (editSale.customer_name) setPatientName(editSale.customer_name);
      if (editSale.customer_phone) setPatientPhone(editSale.customer_phone);
      if (editSale.doctor_name) setDoctor(editSale.doctor_name);
      if (editSale.discount !== undefined) setDiscount(Number(editSale.discount || 0));
      if (editSale.payment_medium) setPaymentMedium(editSale.payment_medium);
      if (editSale.date) setDate(editSale.date.split('T')[0]);

      const itemsList = Array.isArray(editSale.items) ? editSale.items : (Array.isArray(editSale.sale_items) ? editSale.sale_items : []);
      const cartItems = mapEditSaleItemsToCart(itemsList);
      if (cartItems.length > 0) {
        writeRef(cartGenerationRef, cartGenerationRef.current + 1);
        setCart(cartItems);
      }
      toastEvent.trigger(`Loaded Bill #${editSale.invoice_no || editSale.id} into POS for Editing`, 'info');
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    const posState = location.state as PosLocationState | null;
    if (posState && posState.prefill) {
      const prefill = posState.prefill;
      const { patientName: name, patientPhone: phone, advancePayment, refillPatient, refillId, refillDays: rDays, doctorName, doctor: docName, selectedCustomerId: prefCustId, customerId: prefCId } = prefill;
      // ponytail: capture refillIds so we can fulfill after successful bill save
      if (Array.isArray(prefill.refillIds) && prefill.refillIds.length > 0) {
        pendingRefillIdsRef.current = prefill.refillIds.map(Number).filter(Boolean);
      }
      if (name) setPatientName(name);
      if (phone) {
        setPatientPhone(phone);
        setSendWhatsApp(true); // Auto-enable WhatsApp toggle when prefilled for customer
      }
      if (prefCustId || prefCId) {
        const resolvedCId = Number(prefCustId || prefCId);
        setSelectedCustomerId(resolvedCId);
        selectedCustomerIdRef.current = resolvedCId;
      }
      if (doctorName || docName) {
        setDoctor(doctorName || docName || '');
      }
      if (refillPatient || refillId) {
        setRefillEnabled(true);
        if (refillId) setActiveRefillId(Number(refillId));
        if (rDays) setRefillDays(Number(rDays));
      }
      if (advancePayment && Number(advancePayment) > 0) {
        setDiscount((prev: number) => prev + Number(advancePayment));
      }

      const fetchAndAdd = async () => {
        try {
          const rawMedsList = Array.isArray(prefill.medicines) && prefill.medicines.length > 0
            ? prefill.medicines
            : (prefill.medicineId || prefill.medicineName || prefill.item || prefill.medicine)
            ? [prefill.item || prefill.medicine || { medicineId: prefill.medicineId, medicineName: prefill.medicineName, quantity: prefill.quantity || prefill.qty || 1 }]
            : [];

          if (rawMedsList.length > 0) {
            // Ensure compact inventory cache is ready
            let compactInv = getCompactInventoryCache();
            if (!compactInv || compactInv.length === 0) {
              try {
                const res = await api.getCompactInventory();
                compactInv = res || getCompactInventoryCache();
              } catch {}
            }

            const expandedRows: CartRow[] = [];

            for (const med of rawMedsList) {
              const targetId = Number(med.medicineId || med.medicine_id || med.id || 0);
              const targetName = (med.medicineName || med.medicine_name || med.name || '').trim();
              const targetQty = Number(med.quantity_needed || med.quantity || med.qty) || 1;
              const targetLooseQty = Number(med.looseQty || med.loose_qty || med.loose_quantity) || 0;
              const pSize = parsePackSizeFromPackaging(med.packaging) || med.pack_size || med.packSize || 1;

              const fallbackItem = {
                medicine_id: targetId,
                medicine_name: targetName,
                name: targetName,
                packaging: med.packaging,
                pack_size: pSize,
                packSize: pSize,
                sell_price: med.sell_price,
                mrp: med.mrp,
                unit_price: med.unit_price || med.unitPrice,
                unitPrice: med.unit_price || med.unitPrice,
                discount: med.discount || 0,
                batch_no: med.batch_no,
                batch: med.batch_no,
                expiry_date: med.expiry_date,
                expiry: med.expiry_date,
                inventory_id: med.inventory_id
              };

              let allocated = allocateMedicineBatches({
                medicineId: targetId,
                medicineName: targetName,
                requestedQty: targetQty,
                requestedLooseQty: targetLooseQty,
                packSize: Number(pSize) || 1,
                fallbackItem: fallbackItem as Partial<CartRow>,
                compactInventory: compactInv,
                editingInvoiceId: null
              });

              // If not found in cache and targetId > 0, query refill info from backend
              if (allocated.length === 0 && targetId > 0) {
                try {
                  const refillInfo = await api.getMedicineRefillInfo(targetId);
                  if (refillInfo && refillInfo.medicine) {
                    const m = refillInfo.medicine;
                    const bestInv = refillInfo.best_inventory;
                    const lastSale = refillInfo.last_sale;

                    if (!name && lastSale?.customer_name) setPatientName(lastSale.customer_name);
                    if (!phone && lastSale?.customer_phone) setPatientPhone(lastSale.customer_phone);
                    if (!doctor && lastSale?.doctor_name) setDoctor(lastSale.doctor_name);

                    if (bestInv) {
                      allocated = [{
                        id: bestInv.inventory_id || m.id,
                        inventory_id: bestInv.inventory_id,
                        medicine_id: m.id,
                        name: m.name,
                        medicine_name: m.name,
                        batch: bestInv.batch_no || '',
                        batch_no: bestInv.batch_no || '',
                        expiry: bestInv.expiry_date || '',
                        expiry_date: bestInv.expiry_date || '',
                        mrp: Number(bestInv.mrp || m.mrp || 0),
                        sell_price: m.sell_price || null,
                        qty: targetQty,
                        quantity: targetQty,
                        unitPrice: Number(bestInv.unit_price || m.sell_price || m.mrp || 0),
                        looseQty: targetLooseQty,
                        discount: Number(med.discount || lastSale?.discount || 0),
                        packSize: parsePackSizeFromPackaging(m.packaging) || m.pack_size || 1,
                        availableStock: Number(bestInv.quantity || 0),
                        availableLooseStock: Number(bestInv.loose_quantity || 0),
                        isEmptyRow: false
                      }];
                    }
                  }
                } catch (e) {
                  console.warn('Medicine refill info resolution error:', e);
                }
              }

              // Fallback to name search in inventory
              if (allocated.length === 0 && targetName) {
                try {
                  const matched = await api.searchMedicine(targetName);
                  if (matched && matched.length > 0) {
                    const m = matched[0];
                    allocated = [{
                      id: m.inventory_id || m.id,
                      inventory_id: m.inventory_id || m.id,
                      medicine_id: m.medicine_id || m.id,
                      name: m.name || m.medicine_name,
                      medicine_name: m.medicine_name || m.name,
                      batch: m.batch_no || m.batch_number || '',
                      batch_no: m.batch_no || m.batch_number || '',
                      expiry: m.expiry_date || '',
                      expiry_date: m.expiry_date || '',
                      mrp: Number(m.mrp || 0),
                      sell_price: m.sell_price || null,
                      qty: targetQty,
                      quantity: targetQty,
                      unitPrice: Number(m.unit_price || m.sell_price || m.mrp || 0),
                      looseQty: targetLooseQty,
                      discount: Number(med.discount || 0),
                      packSize: parsePackSizeFromPackaging(m.packaging) || m.pack_size || 1,
                      availableStock: Number(m.quantity || 0),
                      availableLooseStock: Number(m.loose_quantity || 0),
                      isEmptyRow: false
                    }];
                  }
                } catch (e) {
                  console.warn('Medicine search error:', e);
                }
              }

              if (allocated.length > 0) {
                expandedRows.push(...allocated);
              } else if (targetName) {
                toastEvent.trigger(
                  `"${targetName}" could not be found in the medicine database. It may need to be added or purchased first.`,
                  'info', '/pos'
                );
              }
            }

            if (expandedRows.length > 0) {
              const emptyTrailingRow = makeEmptyCartRow();
              const finalCart = [...expandedRows, emptyTrailingRow];
              writeRef(cartGenerationRef, cartGenerationRef.current + 1);
              setCart(finalCart);
              toastEvent.trigger(`Loaded ${expandedRows.length} item line(s) into POS`, 'success', '/pos');
            }
          }
        } catch (err) {
          console.error('Failed to prefill POS from state:', err);
        }
      };
      fetchAndAdd();
      navigate(location.pathname, { replace: true, state: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot hydration; deps would refire loads
  }, [location.state, navigate]);

  const [mountFetchesReady, setMountFetchesReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMountFetchesReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const { data: specialOrders = [] } = useApiQuery<SpecialOrder[]>(
    'pos-special-orders',
    () => api.getOrders().then((data: unknown) => Array.isArray(data) ? (data as SpecialOrder[]).filter(o => o.status === 'Pending' || o.status === 'Ordered') : []),
    { enabled: mountFetchesReady && specialOrdersControl.shouldFetch }
  );

  const [rowBatchesList, setRowBatchesList] = useState<PosBatchItem[]>([]);
  const [activeBatchRowId, setActiveBatchRowId] = useState<string | number | null>(null);

  // Multi-cart tab states
  const [tabs, setTabs] = useState<POSTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  // Synchronize active states with the active tab in the tabs list
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors live state into tab
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      if (idx === -1) return prev;
      const t = prev[idx];
      if (
        t.items !== cart ||
        t.patientName !== patientName ||
        t.patientPhone !== patientPhone ||
        t.refillEnabled !== refillEnabled ||
        t.refillDays !== refillDays ||
        t.doctor !== doctor ||
        t.isManualDoctor !== isManualDoctor ||
        t.discount !== discount ||
        t.sendWhatsApp !== sendWhatsApp ||
        t.paymentMedium !== paymentMedium ||
        t.selectedDoctorId !== selectedDoctorId
      ) {
        const next = [...prev];
        next[idx] = {
          ...t,
          items: cart,
          patientName,
          patientPhone,
          refillEnabled,
          refillDays,
          doctor,
          isManualDoctor,
          discount,
          sendWhatsApp,
          paymentMedium,
          selectedDoctorId
        };
        return next;
      }
      return prev;
    });
  }, [cart, patientName, patientPhone, refillEnabled, refillDays, doctor, isManualDoctor, discount, sendWhatsApp, paymentMedium, selectedDoctorId, activeTabId]);

  // Save tabs and activeTabId to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('pos_draft_tabs', JSON.stringify(tabs));
  }, [tabs]);

  // E4+E5+E13: merged empty-row management. These two [cart]-only effects used
  // to run back-to-back on every cart change, causing an extra intermediate
  // render pass between them. Their trigger conditions are mutually exclusive
  // (the "cart totally empty" branch only fires when there are zero non-empty
  // rows, the "append" branch only fires when the last row IS a filled/non-empty
  // row) so combining them into one effect — in the same original order —
  // produces the exact same state transitions with a single effect pass.
  useEffect(() => {
    // 1) Auto-initialize with an empty row if the cart is completely empty
    if (cart.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-seed empty cart row
      setCart([makeEmptyCartRow()]);
      return;
    }

    // 2) Automatically append a new empty row at the bottom if the last row is filled
    const lastItem = cart[cart.length - 1];
    if (lastItem && !lastItem.isEmptyRow && lastItem.name) {
      setCart(prev => [
        ...prev,
        makeEmptyCartRow()
      ]);
    }
  }, [cart]);

  // Autofocus the next empty row's medicine input when cart length increases or changes
  useEffect(() => {
    if (skipEmptyRowAutofocusRef.current) {
      writeRef(skipEmptyRowAutofocusRef, false);
      return;
    }
    if (cart.length > 0) {
      const lastIndex = cart.length - 1;
      const lastItem = cart[lastIndex];
      if (lastItem && lastItem.isEmptyRow) {
        setTimeout(() => {
          const input = document.getElementById(`row-med-input-${lastIndex}`);
          if (input) {
            input.focus();
          }
        }, 80);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- length-only trigger avoids focus loops
  }, [cart.length]);

  // Clean up any potential legacy conflicting local storage keys to ensure robust cache
  useEffect(() => {
    localStorage.removeItem('pos_tabs');
    localStorage.removeItem('pos_active_tab');
    localStorage.removeItem('pos_draft_tab_id');
  }, []);

  useEffect(() => {
    localStorage.setItem('pos_active_tab_id', activeTabId);
  }, [activeTabId]);

  const switchTab = (newTabId: string) => {
    if (newTabId === activeTabId) return;
    const target = tabs.find(t => t.id === newTabId);
    if (target) {
      setCart(target.items || []);
      setPatientName(target.patientName || '');
      setPatientPhone(target.patientPhone || '');
      setRefillEnabled(target.refillEnabled || false);
      setRefillDays(target.refillDays || 30);
      setDoctor(target.doctor || '');
      setIsManualDoctor(target.isManualDoctor || false);
      setSelectedDoctorId(target.selectedDoctorId || null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(target.discount || 0);
      setSendWhatsApp(target.sendWhatsApp || false);
      setPaymentMedium(target.paymentMedium || 'CASH');
      setActiveTabId(newTabId);
    }
  };

  const addNewTab = () => {
    const nextNum = tabs.length + 1;
    const newId = 'cart_' + Date.now();
    const newTab = {
      id: newId,
      name: `Cart ${nextNum}`,
      items: [],
      patientName: '',
      patientPhone: '',
      refillEnabled: false,
      refillDays: 30,
      doctor: '',
      isManualDoctor: false,
      discount: 0,
      sendWhatsApp: false,
      paymentMedium: 'CASH',
      selectedDoctorId: null
    };

    setCart([]);
    setPatientName('');
    setPatientPhone('');
    setRefillEnabled(false);
    setRefillDays(30);
    setDoctor('');
    setIsManualDoctor(false);
    setSelectedDoctorId(null);
    setDoctorSuggestions([]);
    setDoctorComboSuggestions([]);
    setDiscount(0);
    setSendWhatsApp(false);
    setPaymentMedium('CASH');
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    const filtered = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
      const fallback = filtered[filtered.length - 1];
      setCart(fallback.items || []);
      setPatientName(fallback.patientName || '');
      setPatientPhone(fallback.patientPhone || '');
      setRefillEnabled(fallback.refillEnabled || false);
      setRefillDays(fallback.refillDays || 30);
      setDoctor(fallback.doctor || '');
      setIsManualDoctor(fallback.isManualDoctor || false);
      setSelectedDoctorId(fallback.selectedDoctorId || null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(fallback.discount || 0);
      setSendWhatsApp(fallback.sendWhatsApp || false);
      setPaymentMedium(fallback.paymentMedium || 'CASH');
      setActiveTabId(fallback.id);
    }
    setTabs(filtered.map((t, idx) => ({
      ...t,
      name: (t.name || '').startsWith('Cart ') ? `Cart ${idx + 1}` : t.name
    })));
  };

  const getTabItemsCount = (tab: POSTab) => {
    if (tab.id === activeTabId) {
      return cart.filter(item => !item.isEmptyRow).length;
    }
    const items = tab.items || [];
    return items.filter(item => !item.isEmptyRow).length;
  };

  const updateCart = (newCartOrFn: CartRow[] | ((prev: CartRow[]) => CartRow[])) => {
    setCart(prev => {
      const next = typeof newCartOrFn === 'function' ? newCartOrFn(prev) : newCartOrFn;
      return next;
    });
  };

  const updatePatientName = (name: string) => {
    setPatientName(name);
  };
  
  const { data: doctorsList } = useApiQuery<DoctorSuggestion[]>(
    'crm-doctors',
    () => api.getDoctors(),
    { enabled: mountFetchesReady && doctorsControl.shouldFetch }
  );

  const allDoctors = useMemo(() => doctorsList || EMPTY_ARRAY, [doctorsList]);

  // Dropdown must never appear unless the user has typed at least 2 characters.
  const filteredDoctors = useMemo(() => {
    if (doctor.trim().length < 2) return EMPTY_ARRAY;
    return allDoctors.filter(doc =>
      doc.name.toLowerCase().includes(doctor.toLowerCase())
    );
  }, [allDoctors, doctor]);

  // Handle auto-resolving doctor ID from typed or selected name
  useEffect(() => {
      if (doctor.trim() === '') {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles typed doctor with id
      setSelectedDoctorId(null);
      setDoctorComboSuggestions(EMPTY_ARRAY);
      return;
    }
    const match = allDoctors.find(d => d.name.toLowerCase().trim() === doctor.toLowerCase().trim());
    if (match) {
      setSelectedDoctorId(match.id);
    } else {
      setSelectedDoctorId(null);
      setDoctorComboSuggestions(EMPTY_ARRAY);
    }
  }, [doctor, allDoctors]);

  // Load doctor suggestions when doctor ID changes
  useEffect(() => {
    let active = true;
    if (selectedDoctorId) {
      const timer = setTimeout(() => {
        api.getDoctorSuggestions(selectedDoctorId)
          .then(data => {
            if (active && Array.isArray(data)) {
              setDoctorSuggestions(data);
            }
          })
          .catch(err => {
            if (active) {
              console.error('Failed to fetch doctor suggestions:', err);
            }
          });
      }, 200);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale Rx chips
      setDoctorSuggestions(EMPTY_ARRAY);
    }
  }, [selectedDoctorId]);

  const [searchResults, setSearchResults] = useState<PosBatchItem[]>([]);
  const [onlineResults, setOnlineResults] = useState<PosBatchItem[]>([]);
  const [searchingOnline, setSearchingOnline] = useState(false);
  const [suggestions, setSuggestions] = useState<MedSuggestion[]>([]);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const [activeRowSearchIndex, setActiveRowSearchIndex] = useState<number | null>(null);
  const [rowSearchTerm, setRowSearchTerm] = useState('');
  const [rowSearchResults, setRowSearchResults] = useState<PosBatchItem[]>([]);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const [rowSearchHighlightIndex, setRowSearchHighlightIndex] = useState(-1);
  const [rowSearchDropUp, setRowSearchDropUp] = useState<boolean>(false);

  const justSelectedDoctorRef = useRef<boolean>(false);

  const focusMedicineSearch = useCallback(() => {
    setIsSearchExpanded(true);
    setTimeout(() => {
      const input = (
        productSearchRef.current?.querySelector('input') ||
        document.getElementById('medicine-search-input')
      ) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select?.();
      }
    }, 60);
  }, []);

  // Keyboard-first medicine entry lives in the cart's trailing empty row, not the top search box.
  const focusCartMedicineInput = useCallback(() => {
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[id^="row-med-input-"]');
      const target = inputs.length > 0 ? inputs[inputs.length - 1] : null;
      if (target && !target.disabled) {
        target.focus();
        target.select?.();
      }
    }, 80);
  }, []);

  useEffect(() => {
    if (patientHighlightIndex >= 0 && patientSuggestionsRef.current) {
      const highlighted = patientSuggestionsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [patientHighlightIndex]);

  useEffect(() => {
    if (doctorHighlightIndex >= 0 && doctorSuggestionsRef.current) {
      const highlighted = doctorSuggestionsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [doctorHighlightIndex]);

  useEffect(() => {
    if (searchHighlightIndex >= 0 && searchResultsRef.current) {
      const highlighted = searchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [searchHighlightIndex]);

  useEffect(() => {
    if (rowSearchHighlightIndex >= 0 && rowSearchResultsRef.current) {
      const highlighted = rowSearchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [rowSearchHighlightIndex]);

  useOnClickOutside(productSearchRef, () => {
    setSearchResults([]);
    setSuggestions([]);
    setShowSearchDropdown(false);
  });

  useOnClickOutside(activeRowRef, () => {
    setRowSearchResults([]);
    setActiveRowSearchIndex(null);
  });

  useOnClickOutside(patientSectionRef, () => {
    setShowPatientSuggestions(false);
    setPatientHighlightIndex(-1);
  });

  useOnClickOutside(doctorSectionRef, () => {
    setIsDoctorDropdownOpen(false);
    setDoctorHighlightIndex(-1);
  });

  // Inventory cache readiness + version (moved up so the shared memoized
  // mapping below can depend on cacheVersion before it is used by either
  // the row-level or header search-result dropdowns).
  const [inventoryIndexReady, setInventoryIndexReady] = useState(() => isCompactInventoryCacheReady());
  const [cacheVersion, setCacheVersion] = useState(0);

  // E2/E11: shared memoized inventory mapping. This full-array map/copy only
  // reruns when the compact inventory cache actually changes (cacheVersion),
  // not on every keystroke — both search dropdowns below consume this same
  // reference instead of each doing their own `.map()` per render.
  const mappedInventory = useMemo(() => {
    void cacheVersion; // intentional external-cache invalidation trigger
    const compactInventory = getCompactInventoryCache();
    return compactInventory.map(item => ({
      ...item,
      medicine_name: item.name,
      quantity: item.stock_qty,
      alternatives: []
    }));
  }, [cacheVersion]);

  // Local row search autocomplete
  useEffect(() => {
    const term = rowSearchTerm.trim();
      if (activeRowSearchIndex === null || term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears row dropdown on short term
      setRowSearchResults([]);
      setRowSearchHighlightIndex(-1);
      return;
    }

    const filtered = filterLocalInventory(term, mappedInventory);
    const grouped = groupBatches(filtered);
    setRowSearchResults(grouped);
    setRowSearchHighlightIndex(-1);
  }, [rowSearchTerm, activeRowSearchIndex, mappedInventory]);

  // Synchronize selection refs to avoid closure staleness in async callbacks
  useEffect(() => {
    writeRef(selectedCustomerIdRef, selectedCustomerId);
  }, [selectedCustomerId]);

  useEffect(() => {
    writeRef(selectedDoctorIdRef, selectedDoctorId);
  }, [selectedDoctorId]);

  // Fetch customer suggestions for patient autocomplete (P2)
  useEffect(() => {
    if (justSelectedPatientRef.current) {
      setPatientSuggestions([]);
      setShowPatientSuggestions(false);
      return;
    }

    if (patientName.trim().length < 2 || selectedCustomerIdRef.current !== null) {
      setPatientSuggestions([]);
      setShowPatientSuggestions(false);
      return;
    }

    const currentQuery = patientName.trim();
    const delayDebounce = setTimeout(() => {
      api.getPatients({ q: currentQuery, limit: 8 })
        .then((data: unknown) => {
          const lookup = data as PatientLookupResponse | PatientSuggestion[];
          const list = Array.isArray(lookup) ? lookup : (lookup?.suggestions || []);
          const isFuzzy = !Array.isArray(lookup) && Boolean(lookup?.isSuggestion);
          const isFocused = document.activeElement && (
            document.activeElement.getAttribute('aria-label') === 'Patient Name' ||
            document.activeElement.id === 'patient-name-input'
          );
          if (isFocused && selectedCustomerIdRef.current === null && !justSelectedPatientRef.current && patientName.trim() === currentQuery) {
            setPatientSuggestions(list);
            setIsPatientFuzzyMatch(isFuzzy);
            setShowPatientSuggestions(list.length > 0);
          }
        })
        .catch(() => {});
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounce);
  }, [patientName, selectedCustomerId]);

  // C4: cache the refills panel result set once and filter it client-side on
  // subsequent patientName keystrokes, instead of re-hitting the API per keystroke.
  const refillsPanelCacheRef = useRef<RefillPanelGroup[] | null>(null);

  // Search for pending refills / previous prescriptions matching the patient (CRM registered customers only)
  useEffect(() => {
    // Strictly require a registered CRM customer to be selected
    if (!selectedCustomerId || selectedCustomerIdRef.current === null) {
      setMatchedRefill(null);
      return;
    }

    const cleanPName = patientName.trim();
    const cleanPPhone = patientPhone.trim();
    if (cleanPName.length < 2 && cleanPPhone.length < 5) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refill banner guard reset
      setMatchedRefill(null);
      return;
    }
    const refillDigits = cleanPPhone.replace(/\D/g, '');
    const delayCheck = setTimeout(async () => {
      try {
        // 1. Check patient previous sales & refills
        const res = await api.getPatientRefillMedicines({
          customerId: selectedCustomerIdRef.current || undefined,
          phone: cleanPPhone || undefined,
          name: cleanPName || undefined
        });

        if (res && res.success && Array.isArray(res.medicines) && res.medicines.length > 0) {
          const firstMedId = res.medicines[0].refill_id || res.medicines[0].medicine_id;
          if (firstMedId !== dismissedRefillId) {
            setMatchedRefill({
              id: firstMedId,
              patient_name: res.customer?.name || cleanPName,
              patient_phone: res.customer?.phone || cleanPPhone,
              doctor_name: res.doctor_name || '',
              medicines: res.medicines
            });
            return;
          }
        }

        // 2. Fallback to panel cache for registered customer
        let panelData = refillsPanelCacheRef.current;
        if (!panelData) {
          const response = await apiClient.get('/refills/panel');
          panelData = Array.isArray(response.data) ? (response.data as RefillPanelGroup[]) : [];
          refillsPanelCacheRef.current = panelData;
        }
        const match =
          (refillDigits.length >= 5
            ? panelData.find(group => group.patient_phone?.replace(/\D/g, '').includes(refillDigits))
            : undefined) ||
          (cleanPName.length >= 2
            ? panelData.find(group => group.patient_name?.toLowerCase().trim() === cleanPName.toLowerCase())
            : undefined);
        if (match && match.medicines && match.medicines.length > 0) {
          const med = match.medicines.find(m => m.is_ready === 1 || m.stock_verified_override === 1);
          if (med && med.id !== dismissedRefillId) {
            setMatchedRefill({
              id: med.id,
              patient_name: match.patient_name,
              patient_phone: match.patient_phone,
              medicine_id: med.medicine_id,
              medicine_name: med.medicine_name,
              quantity: med.quantity_needed || 1,
              medicines: match.medicines
            });
            return;
          }
        }
        setMatchedRefill(null);
      } catch (err) {
        console.error('Failed to search for refill match:', err);
      }
    }, 450);
    return () => clearTimeout(delayCheck);
  }, [patientName, patientPhone, selectedCustomerId, dismissedRefillId]);

  const handleAcceptRefill = async () => {
    if (!matchedRefill) return;
    try {
      const medsToAdd = Array.isArray(matchedRefill.medicines) && matchedRefill.medicines.length > 0
        ? matchedRefill.medicines
        : [matchedRefill];

      let compactInv = getCompactInventoryCache();
      if (!compactInv || compactInv.length === 0) {
        try {
          const res = await api.getCompactInventory();
          compactInv = res || getCompactInventoryCache();
        } catch {}
      }

      const newItems: CartRow[] = [];
      for (const med of medsToAdd) {
        const medName = med.medicine_name || med.name || '';
        const targetId = Number(med.medicineId || med.medicine_id || med.id || 0);
        const targetQty = Number(med.quantity || med.quantity_needed || med.qty || 1);
        const targetLooseQty = Number(med.loose_qty || med.looseQty || 0);
        const pSize = parsePackSizeFromPackaging(med.packaging) || med.pack_size || med.packSize || 1;

        const fallbackItem = {
          medicine_id: targetId,
          medicine_name: medName,
          name: medName,
          packaging: med.packaging,
          pack_size: pSize,
          packSize: pSize,
          sell_price: med.sell_price,
          mrp: med.mrp,
          unit_price: med.unit_price || med.unitPrice,
          unitPrice: med.unit_price || med.unitPrice,
          discount: med.discount || 0,
          batch_no: med.batch_no,
          batch: med.batch_no,
          expiry_date: med.expiry_date,
          expiry: med.expiry_date,
          inventory_id: med.inventory_id
        };

        let allocated = allocateMedicineBatches({
          medicineId: targetId,
          medicineName: medName,
          requestedQty: targetQty,
          requestedLooseQty: targetLooseQty,
          packSize: Number(pSize) || 1,
          fallbackItem: fallbackItem as Partial<CartRow>,
          compactInventory: compactInv,
          editingInvoiceId
        });

        if (allocated.length === 0 && targetId > 0) {
          try {
            const refillInfo = await api.getMedicineRefillInfo(targetId);
            if (refillInfo && refillInfo.best_inventory) {
              const bestInv = refillInfo.best_inventory;
              allocated = [{
                id: bestInv.inventory_id,
                inventory_id: bestInv.inventory_id,
                medicine_id: targetId,
                name: medName,
                medicine_name: medName,
                batch: bestInv.batch_no || '',
                batch_no: bestInv.batch_no || '',
                expiry: bestInv.expiry_date || '',
                expiry_date: bestInv.expiry_date || '',
                mrp: Number(bestInv.mrp || 0),
                sell_price: med.sell_price || null,
                qty: targetQty,
                quantity: targetQty,
                unitPrice: Number(bestInv.unit_price || med.sell_price || med.mrp || 0),
                looseQty: targetLooseQty,
                discount: Number(med.discount || 0),
                packSize: Number(pSize) || 1,
                availableStock: Number(bestInv.quantity || 0),
                availableLooseStock: Number(bestInv.loose_quantity || 0),
                isEmptyRow: false
              }];
            }
          } catch {}
        }

        if (allocated.length === 0 && medName) {
          try {
            const results = await api.searchMedicine(medName);
            if (results && results.length > 0) {
              const matched = results[0];
              allocated = [{
                id: matched.id,
                inventory_id: matched.inventory_id || matched.id,
                medicine_id: matched.medicine_id || matched.id,
                name: matched.name || medName,
                medicine_name: matched.medicine_name || medName,
                batch: matched.batch_no || matched.batch_number || '',
                batch_no: matched.batch_no || matched.batch_number || '',
                expiry: matched.expiry_date || '',
                expiry_date: matched.expiry_date || '',
                mrp: Number(matched.mrp || 0),
                sell_price: matched.sell_price || null,
                qty: targetQty,
                quantity: targetQty,
                unitPrice: Number(matched.unit_price || matched.sell_price || matched.mrp || 0),
                looseQty: targetLooseQty,
                discount: Number(med.discount || 0),
                packSize: Number(pSize) || 1,
                isEmptyRow: false
              }];
            }
          } catch {}
        }

        if (allocated.length > 0) {
          newItems.push(...allocated);
        }
      }

      if (newItems.length > 0) {
        setCart(prev => {
          const clean = prev.filter(item => !item.isEmptyRow);
          const combined = [...clean, ...newItems];
          combined.push(makeEmptyCartRow());
          return combined;
        });

        if (matchedRefill.patient_phone && !patientPhone) {
          setPatientPhone(matchedRefill.patient_phone);
        }
        if (matchedRefill.doctor_name && !doctor) {
          setDoctor(matchedRefill.doctor_name);
        }
        if (matchedRefill.id) {
          setActiveRefillId(matchedRefill.id);
        }

        toastEvent.trigger(`Added ${newItems.length} refill item line(s) to POS cart`, 'success', '/pos');
      }
      refillsPanelCacheRef.current = null;
    } catch (err) {
      console.error('Failed to accept refill:', err);
    }
    setMatchedRefill(null);
  };

  const handleSavePatientProfile = async () => {
    if (patientName.trim()) {
      try {
        await api.addPatient({ name: patientName.trim(), phone: patientPhone.trim() });
      } catch {
        // Patient may already exist, ignore duplicate errors
      }
      try {
        await api.saveContact({
          name: patientName.trim(),
          type: 'customer',
          phone: patientPhone.trim()
        });
        window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
        window.dispatchEvent(new CustomEvent('contacts-updated'));
      } catch {}
    }
    setShowPatientModal(false);
  };

  // Universal Edit state
  const [editMedicineId, setEditMedicineId] = useState<number | null>(null);

  // Keyboard shortcut listeners (e.g. 'X' for camera, 'Alt+E' or 'F8' for quick edit medicine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;

      // F2 or Ctrl + K: Expand & Focus Medicine Search
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setIsSearchExpanded(true);
        setTimeout(() => {
          const input = productSearchRef.current?.querySelector('input');
          if (input) {
            input.focus();
            input.select();
          }
        }, 50);
        return;
      }

      // Ctrl + S: Save Bill or Save Profile
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (showPatientModalRef.current) {
          handleSavePatientProfileRef.current?.();
        } else {
          handleCompleteSaleRef.current?.();
        }
        return;
      }

      // Ctrl + 1: Focus Patient/Customer Input
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        const input = document.getElementById('patient-name-input');
        if (input) {
          input.focus();
          (input as HTMLInputElement).select();
        }
        return;
      }

      // Alt + P: Open Patient Modal
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPatientModal(true);
        return;
      }

      // Escape: Close Modals / Overlays
      if (e.key === 'Escape') {
        setShowPatientModal(false);
        setShowDoctorModal(false);
        setShowCamera(false);
        setZoomedImage(null);
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
                setEditMedicineId(medId);
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
        setShowCamera(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
      if (searchTerm.trim().length < 2) {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears search dropdown states
      setSearchResults([]);
      setSearchHighlightIndex(-1);
      setOnlineResults([]);
      setSearchingOnline(false);
      setSuggestions([]);
      return;
    }
  }, [searchTerm]);

  // Fetch fuzzy did-you-mean suggestions when results are thin
  useEffect(() => {
      if (searchTerm.trim().length < 2 || searchResults.length >= 5) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- thin-results suggestion prefetch guard
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await api.suggestMedicine(searchTerm.trim());
        if (Array.isArray(data)) {
          const filtered = data.filter(sug => !(searchResults.some(r => (r.medicine_name || '').toLowerCase() === sug.name.toLowerCase())));

          setSuggestions(filtered);
        }
      } catch (err) {
        console.error('Failed to load suggestions in POS:', err);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTerm, searchResults]);

  // Local autocomplete (replaces React Query useApiQuery to eliminate layout shift and latency)

  useEffect(() => {
    const handler = () => {
      setInventoryIndexReady(true);
      setCacheVersion(prev => prev + 1);
    };
    window.addEventListener('inventory-cache-ready', handler);
    window.addEventListener('compact-inventory-ready', handler);

    // Fallback: unlock inventory index within 1.5s even on cold boot delays
    const fallbackTimer = setTimeout(() => {
      setInventoryIndexReady(true);
    }, 1500);

    return () => {
      clearTimeout(fallbackTimer);
      window.removeEventListener('inventory-cache-ready', handler);
      window.removeEventListener('compact-inventory-ready', handler);
    };
  }, []);

  const rebalanceCartMedicine = (prevCart: CartRow[], medicineId: number | string, targetItemId: number | string, updatedFields: { qty?: number; looseQty?: number }) => {
    const targetItem = prevCart.find(i => i.id === targetItemId);
    const targetMedId = medicineId || targetItem?.medicine_id;
    const targetMedName = (targetItem?.name || targetItem?.medicine_name || '').toLowerCase().trim();

    // 1. Find all cart items of this medicine
    const medicineItems = prevCart.filter(item => {
      if (item.isEmptyRow) return false;
      const idMatch = targetMedId && item.medicine_id === targetMedId;
      const nameMatch = Boolean(targetMedName && (item.name || item.medicine_name || '').toLowerCase().trim() === targetMedName);
      return idMatch || nameMatch;
    });
    if (medicineItems.length === 0) return prevCart;

    // 2. Determine the new total requested quantity for this medicine.
    let totalRequestedTablets = 0;
    const packSize = medicineItems[0].packSize || 1;

    for (const item of medicineItems) {
      let itemQty = item.qty ?? item.quantity ?? 0;
      let itemLoose = item.looseQty ?? item.loose_qty ?? 0;
      if (item.id === targetItemId) {
        if (updatedFields.qty !== undefined) itemQty = updatedFields.qty;
        if (updatedFields.looseQty !== undefined) itemLoose = updatedFields.looseQty;
      }
      totalRequestedTablets += (itemQty * packSize) + itemLoose;
    }

    const requestedQty = Math.floor(totalRequestedTablets / packSize);
    const requestedLooseQty = totalRequestedTablets % packSize;

    const compactInventory = getCompactInventoryCache();
    const newMedRows = allocateMedicineBatches({
      medicineId: Number(targetMedId || 0),
      medicineName: medicineItems[0].name || medicineItems[0].medicine_name || '',
      requestedQty,
      requestedLooseQty,
      packSize,
      fallbackItem: medicineItems[0],
      compactInventory,
      editingInvoiceId
    });

    if (newMedRows.length === 0) {
      toastEvent.trigger("This medicine is completely out of stock or expired", "error");
      return prevCart.map(item => {
        if (item.id === targetItemId) {
          return { ...item, qty: 0, looseQty: 0 };
        }
        return item;
      }).filter(item => item.id === targetItemId || (targetMedId ? item.medicine_id !== targetMedId : (item.name || item.medicine_name || '').toLowerCase().trim() !== targetMedName));
    }

    // Replace all old rows of this medicine in the cart with the new allocated rows
    const newCart: CartRow[] = [];
    let inserted = false;
    for (const item of prevCart) {
      const isThisMed = (targetMedId && item.medicine_id === targetMedId) ||
        Boolean(targetMedName && (item.name || item.medicine_name || '').toLowerCase().trim() === targetMedName);
      if (isThisMed && !item.isEmptyRow) {
        if (!inserted) {
          newCart.push(...newMedRows);
          inserted = true;
        }
      } else {
        newCart.push(item);
      }
    }
    if (!inserted) {
      newCart.push(...newMedRows);
    }
    return newCart;
  };

  const addToCart = (med: CartRow | PosBatchItem) => {
    // Expiry check
    const expiryStr = med.expiry || med.expiry_date || '';
    if (expiryStr) {
      let expDate: Date;
      if (expiryStr.includes('/')) {
        const parts = expiryStr.split('/');
        let year = parseInt(parts[1], 10);
        const month = parseInt(parts[0], 10) - 1;
        if (year < 100) year += 2000;
        expDate = new Date(year, month + 1, 0);
      } else {
        expDate = new Date(expiryStr);
      }
      if (expDate < new Date()) {
        toastEvent.trigger(`Cannot add expired product: ${med.name} (expired ${expiryStr})`, 'error');
        return;
      }
    }

    // Check if added item has special order request
    const pendingMatches = specialOrders.filter(
      o => o.product.toLowerCase().trim() === (med.name || '').toLowerCase().trim() ||
           (med.name || '').toLowerCase().includes(o.product.toLowerCase().trim())
    );
    if (pendingMatches.length > 0) {
      toastEvent.trigger(
        `Pending request: ${pendingMatches[0].requester} asked for ${pendingMatches[0].qty} × ${med.name}`,
        'info'
      );
    }

    const cleanCart = cart.filter(item => !item.isEmptyRow);
    const existingIndex = cleanCart.findIndex(item => {
      const isDbId = (id: unknown): id is number => typeof id === 'number' && id < 1000000;
      const idMatches = isDbId(item.id) && isDbId(med.id) && item.id === med.id;
      const medicineIdMatch = item.medicine_id !== undefined && med.medicine_id !== undefined && item.medicine_id === med.medicine_id;
      const nameMatch = (item.name || '').toLowerCase().trim() === (med.name || '').toLowerCase().trim();
      return idMatches || medicineIdMatch || nameMatch;
    });

    const targetIndex = existingIndex !== -1 ? existingIndex : cleanCart.length;
    writeRef(skipEmptyRowAutofocusRef, true);

    updateCart((prevCart): CartRow[] => {
      const cleanPrev = prevCart.filter(item => !item.isEmptyRow);
      // ponytail: POS sell cart always adds 1 strip — recommended/default qty is Live Cart only
      const incQty = 1;
      const incLooseQty = 0;
      
      if (existingIndex !== -1) {
        const existingItem = cleanPrev[existingIndex];
        const newQty = (existingItem.qty || 0) + incQty;
        const newLoose = (existingItem.looseQty || 0) + incLooseQty;
        return rebalanceCartMedicine(cleanPrev, Number(existingItem.medicine_id || existingItem.id || 0), existingItem.id, { qty: newQty, looseQty: newLoose });
      }
      
      const hasRealBatch = !!(med.batch_no || med.batch) && !!(med.inventory_id || (typeof med.id === 'number' && med.id < 1000000000));
      const initialMrp = hasRealBatch ? (med.mrp || 0) : 0;
      const initialUnitPrice = hasRealBatch ? (med.unitPrice || med.unit_price || med.mrp || 0) : 0;
      const initialGst = Number(med.gst_percent !== undefined ? med.gst_percent : (med.gst !== undefined ? med.gst : (med.tax_percent !== undefined ? med.tax_percent : 12)));

      // Auto-calculate discount percentage if sell_price is set for this medicine
      let initialDiscount = med.discount !== undefined ? med.discount : 0;
      if (!initialDiscount || initialDiscount === 0) {
        const sellPrice = Number(med.sell_price || 0);
        const mrpVal = Number(initialMrp || med.mrp || 0);
        if (sellPrice > 0 && mrpVal > 0 && sellPrice < mrpVal) {
          initialDiscount = parseFloat((((mrpVal - sellPrice) / mrpVal) * 100).toFixed(2));
        }
      }

      const newItem = { 
        id: med.id, 
        medicine_id: med.medicine_id || med.id,
        inventory_id: med.inventory_id || (hasRealBatch ? med.id : undefined),
        name: med.name, 
        batch: med.batch || (hasRealBatch ? med.batch_no : ''), 
        expiry: med.expiry || med.expiry_date || '', 
        qty: incQty, 
        looseQty: incLooseQty,
        discount: initialDiscount,
        gst_percent: initialGst,
        packSize: Number(med.packSize || med.pack_size || 1),
        mrp: initialMrp, 
        sell_price: med.sell_price != null ? Number(med.sell_price) : null,
        unitPrice: Number(initialUnitPrice),
        costPrice: med.costPrice != null ? med.costPrice : (med.cost_price != null ? med.cost_price : null),
        salts: med.salts || '',
        availableStock: med.batch_quantity !== undefined ? med.batch_quantity : (med.quantity !== undefined ? med.quantity : (med.availableStock !== undefined ? med.availableStock : 0)),
        availableLooseStock: med.loose_quantity !== undefined ? med.loose_quantity : (med.availableLooseStock !== undefined ? med.availableLooseStock : 0),
        alternative_batches: med.alternative_batches || []
      };
      
      const compactInventory = getCompactInventoryCache();
      const allocated = allocateMedicineBatches({
        medicineId: Number(med.medicine_id || (typeof med.id === 'number' && med.id < 1000000000 ? med.id : 0)),
        medicineName: med.name || med.medicine_name || '',
        requestedQty: incQty,
        requestedLooseQty: incLooseQty,
        packSize: Number(med.packSize || med.pack_size || 1),
        fallbackItem: newItem as Partial<CartRow>,
        compactInventory,
        editingInvoiceId
      });

      if (allocated.length > 0) {
        return [...cleanPrev, ...allocated];
      }
      return [...cleanPrev, newItem as CartRow];
    });

    // Fetch doctor combination recommendations
    const medId = med.medicine_id || med.id;
    if (selectedDoctorId && medId) {
      api.getDoctorCombinations(selectedDoctorId, Number(medId))
        .then((comboData: unknown) => {
          if (Array.isArray(comboData)) {
            setDoctorComboSuggestions(comboData as DoctorSuggestion[]);
          }
        })
        .catch(err => {
          console.error('Failed to fetch doctor combinations:', err);
          setDoctorComboSuggestions([]);
        });
    }

    setTimeout(() => {
      const qtyInput = document.getElementById(`row-qty-input-${targetIndex}`);
      if (qtyInput) {
        qtyInput.focus();
        (qtyInput as HTMLInputElement).select();
      }
    }, 120);
  };

  const toggleAllowLooseSale = async (item: CartRow | PosBatchItem) => {
    const medId = item.medicine_id || item.id;
    if (!medId) return;
    const currentFlag = item.allow_loose_sale !== undefined ? (item.allow_loose_sale ? 1 : 0) : 1;
    const newFlag = currentFlag ? 0 : 1;

    updateCart(prev => prev.map(row => {
      if (row.medicine_id === medId || row.id === item.id) {
        return { 
          ...row, 
          allow_loose_sale: newFlag, 
          looseQty: newFlag ? row.looseQty : 0 
        };
      }
      return row;
    }));

    try {
      await api.patchAllowLooseSale(Number(medId), newFlag);
      toastEvent.trigger(
        newFlag ? `Loose sale enabled for ${item.name || item.medicine_name || 'medicine'}` : `Full Strip Only restriction applied to ${item.name || item.medicine_name || 'medicine'}`,
        'info'
      );
      invalidateAfterStockWrite(queryClient);
    } catch (err) {
      console.error('Failed to toggle allow_loose_sale:', err);
      toastEvent.trigger('Failed to update loose sale setting', 'error');
    }
  };

  const fetchDetailsAndAddToCart = async (item: PosBatchItem) => {
    const autoDisc = (item.sell_price && item.mrp && Number(item.sell_price) > 0 && Number(item.mrp) > 0 && Number(item.sell_price) < Number(item.mrp))
      ? parseFloat((((Number(item.mrp) - Number(item.sell_price)) / Number(item.mrp)) * 100).toFixed(2))
      : (item.discount || 0);

    addToCart({
      id: item.inventory_id || item.id,
      inventory_id: item.inventory_id || item.id,
      medicine_id: item.medicine_id,
      name: item.medicine_name || item.name,
      batch: item.batch_no || '',
      expiry: item.expiry_date || '',
      mrp: item.mrp,
      sell_price: item.sell_price || null,
      unitPrice: item.unit_price || item.sell_price || item.mrp || 0,
      costPrice: item.cost_price != null ? item.cost_price : null,
      salts: item.salts || item.api_reference || item.hsn_code || '',
      discount: autoDisc,
      packSize: parsePackSizeFromPackaging(item.packaging) || item.pack_size || 1,
      availableStock: item.quantity !== undefined ? item.quantity : (item.stock_qty !== undefined ? item.stock_qty : 0),
      availableLooseStock: item.loose_quantity !== undefined ? item.loose_quantity : 0,
      scanImage: item.scanImage,
      rawOcrText: item.rawOcrText
    });

    try {
      const details = await api.getMedicineQuickDetails(Number(item.medicine_id));
      if (!details) return;

      const fetchedSellPrice = details.sell_price !== undefined ? details.sell_price : (item.sell_price || null);
      const fetchedMrp = Number(details.mrp || item.mrp || 0);
      let autoDiscount = item.discount || 0;
      if (fetchedSellPrice && Number(fetchedSellPrice) > 0 && fetchedMrp > 0 && Number(fetchedSellPrice) < fetchedMrp) {
        autoDiscount = parseFloat((((fetchedMrp - Number(fetchedSellPrice)) / fetchedMrp) * 100).toFixed(2));
      }

      updateCart(prev => {
        const idx = prev.findIndex(r => r.medicine_id === item.medicine_id || r.id === (item.inventory_id || item.id));
        if (idx === -1) return prev;
        const updated = [...prev];
        if (updated[idx].salts && updated[idx].alternatives && updated[idx].alternatives.length > 0) {
          return prev;
        }
        updated[idx] = {
          ...updated[idx],
          sell_price: fetchedSellPrice,
          discount: autoDiscount,
          salts: details.api_reference || details.hsn_code || updated[idx].salts,
          packSize: parsePackSizeFromPackaging(details.packaging) || details.pack_size || updated[idx].packSize,
          alternatives: details.alternatives || [],
        };
        return updated;
      });
    } catch (error) {
      console.warn('Failed to load quick details after add (using cache data):', error);
    }
  };

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- barcode auto-add search pipeline
      setSearchResults([]);
      setSearchHighlightIndex(-1);
      return;
    }

    const filtered = filterLocalInventory(term, mappedInventory);
    const groupedData = groupBatches(filtered);

    // Premium Barcode Auto-Add Feature:
    const barcodeTerm = term.toUpperCase();
    if (groupedData.length === 1) {
      const matched = groupedData[0];
      const barcode = (matched.item_code || '').toUpperCase().trim();
      if (barcode === barcodeTerm && matched.inventory_id && !matched.is_out_of_stock) {
        fetchDetailsAndAddToCart(matched);
        setSearchTerm('');
        setSearchResults([]);
        setSearchHighlightIndex(-1);
        return;
      }
    }
    setSearchResults(groupedData);
    setSearchHighlightIndex(-1);
    setOnlineResults([]);
    setSearchingOnline(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handler identity churn must not refire
  }, [searchTerm, mappedInventory]);

  const handleSelectOnlineSuggestion = async (sug: MedSuggestion | PosBatchItem) => {
    try {
      const res = await api.autoEnrich({
        name: sug.name || '',
        api_reference: sug.api_reference || '',
        manufacturer: sug.manufacturer || undefined
      });
      
      const addedName = res?.medicine?.name || sug.name;
      toastEvent.trigger(`"${addedName}" added to master database. Please record a purchase invoice with batch & price before billing.`, "info");
      
      setSearchTerm('');
      setOnlineResults([]);
      setSearchResults([]);
    } catch (err) {
      alert(`Failed to auto-enrich medicine: ${(err as LocalApiError).message || 'Unknown error'}`);
    }
  };

  const removeFromCart = (id: number | string) => {
    updateCart(prevCart => prevCart.filter(item => item.id !== id));
  };

  const changeRowMedicine = (index: number, med: CartRow | PosBatchItem, opts?: { presetQty?: number; presetLooseQty?: number }) => {
    const originalItem = cart[index];
    if (originalItem && originalItem.rawOcrText && (originalItem.name || '').toLowerCase().trim() !== (med.medicine_name || '').toLowerCase().trim()) {
      apiClient.post('/aicamera/learn', {
        ocrText: originalItem.rawOcrText,
        correctName: med.medicine_name
      }).catch(err => console.error('Failed to post correction learning:', err));
    }

    const defaultQty = opts?.presetQty ?? (originalItem?.isEmptyRow ? 1 : ((originalItem?.qty ?? 0) || 1));
    const defaultLooseQty = opts?.presetLooseQty ?? (originalItem?.isEmptyRow ? 0 : (originalItem?.looseQty ?? 0));
    const compactInventory = getCompactInventoryCache();
    const allocated = allocateMedicineBatches({
      medicineId: Number(med.medicine_id || (typeof med.id === 'number' && med.id < 1000000000 ? med.id : 0)),
      medicineName: med.medicine_name || med.name || '',
      requestedQty: defaultQty,
      requestedLooseQty: defaultLooseQty,
      packSize: med.pack_size || 1,
      compactInventory,
      editingInvoiceId
    });

    updateCart(prev => {
      const clean = prev.filter((_, idx) => idx !== index);
      const isOrigEmpty = originalItem?.isEmptyRow;
      const rowsToAdd: CartRow[] = allocated.length > 0 ? allocated : ([{
        id: med.inventory_id || med.id,
        medicine_id: med.medicine_id || med.id,
        name: med.medicine_name || med.name,
        batch: med.batch_no || '',
        expiry: med.expiry_date || '',
        mrp: med.mrp || 0,
        costPrice: med.cost_price || 0,
        salts: med.salts || med.hsn_code || '',
        packSize: med.pack_size || 1,
        qty: defaultQty,
        quantity: defaultQty,
        looseQty: defaultLooseQty,
        availableStock: med.batch_quantity !== undefined ? med.batch_quantity : (med.quantity !== undefined ? med.quantity : 0),
        availableLooseStock: med.loose_quantity !== undefined ? Number(med.loose_quantity) : 0,
        isEmptyRow: false
      }]) as CartRow[];

      if (isOrigEmpty) {
        return [...clean, ...rowsToAdd];
      }
      const next = [...prev];
      next.splice(index, 1, ...rowsToAdd);
      return next;
    });

    setActiveRowSearchIndex(null);
    setRowSearchTerm('');
    setRowSearchResults([]);
    setRowSearchHighlightIndex(-1);
  };

  const fetchDetailsAndChangeRowMedicine = (index: number, med: CartRow | PosBatchItem, opts?: { presetQty?: number; presetLooseQty?: number }) => {
    writeRef(skipEmptyRowAutofocusRef, true);

    // Apply medicine selection synchronously for instant UI response (<5ms)
    changeRowMedicine(index, med, opts);

    setTimeout(() => {
      const qtyInput = document.getElementById(`row-qty-input-${index}`);
      if (qtyInput) {
        qtyInput.focus();
        (qtyInput as HTMLInputElement).select();
      }
    }, 40);

    // Enrich salts & alternatives asynchronously in the background
    api.getMedicineQuickDetails(Number(med.medicine_id))
      .then((details: MedicineQuickDetails) => {
        if (details) {
          updateCart(prevCart => {
            const updated = [...prevCart];
            const target = updated[index];
            if (!target || target.medicine_id !== med.medicine_id) return prevCart;
            target.salts = details.api_reference || details.hsn_code || target.salts || '';
            target.alternatives = details.alternatives || target.alternatives;
            return updated;
          });
        }
      })
      .catch((error: unknown) => {
        console.warn('Background quick details fetch failed/skipped:', error);
      });
  };

  // Doctor-prescription quick-add: fills the cart's trailing empty row with this doctor's usual qty.
  const handleDoctorSuggestionClick = (s: DoctorSuggestion) => {
    const med = { medicine_id: s.id, medicine_name: s.name };
    const presetOpts = { presetQty: s.most_common_qty || 1, presetLooseQty: s.most_common_loose_qty || 0 };
    const emptyRows = cart.map(c => c.isEmptyRow === true);
    const emptyIdx = emptyRows.lastIndexOf(true);
    if (emptyIdx >= 0) {
      fetchDetailsAndChangeRowMedicine(emptyIdx, med, presetOpts);
    } else {
      // Defensive: no empty row present yet — add via top flow, then apply usual qty.
      fetchDetailsAndAddToCart(med);
      setTimeout(() => {
        const it = cart.find(c => !c.isEmptyRow && c.medicine_id === s.id);
        if (it) updateCartItem(it.id, 'qty', presetOpts.presetQty);
      }, 200);
    }
  };

  const updateCartItem = (id: number | string, field: string, value: unknown) => {
    updateCart(prevCart => {
      const item = prevCart.find(i => i.id === id);
      if (!item) return prevCart;

      if (field === 'qty' || field === 'looseQty') {
        let updatedQty = item.qty;
        let updatedLoose = item.looseQty;

        if (field === 'qty') {
          updatedQty = Math.max(0, Number(value));
        } else if (field === 'looseQty') {
          const looseVal = Math.max(0, Number(value));
          const pSize = item.packSize || 1;
          if (looseVal >= pSize) {
            const extraStrips = Math.floor(looseVal / pSize);
            updatedQty = (item.qty || 0) + extraStrips;
            updatedLoose = looseVal % pSize;
          } else {
            updatedLoose = looseVal;
          }
        }

        return rebalanceCartMedicine(prevCart, Number(item.medicine_id ?? 0), id, { qty: updatedQty, looseQty: updatedLoose });
      }

      // Standard mapping for other fields
      return prevCart.map(item => {
        if (item.id !== id) return item;
        const updatedItem = { ...item, [field]: value };

        if (field === 'discount') {
          const numDisc = Math.min(100, Math.max(0, Number(value) || 0));
          updatedItem.discount = numDisc;
          updatedItem.discount_per = numDisc;
          updatedItem.discountPer = numDisc;
        }

        if (field === 'packSize') {
          const pSize = Math.max(1, Number(value));
          updatedItem.packSize = pSize;
          const looseVal = updatedItem.looseQty || 0;
          if (looseVal >= pSize) {
            const extraStrips = Math.floor(looseVal / pSize);
            updatedItem.qty = (updatedItem.qty || 0) + extraStrips;
            updatedItem.looseQty = looseVal % pSize;
          }
          if (typeof id === 'number' && id < 1000000) {
            api.updateMedicine(id, { pack_size: pSize })
              .catch(err => console.error('Error updating pack size in DB:', err));
          }
        }

        if (field === 'mrp' && typeof id === 'number' && id < 1000000) {
          api.updateMedicine(id, { mrp: Number(value) })
            .catch(err => console.error('Error updating MRP in DB:', err));
        }

        if (field === 'costPrice' && typeof id === 'number' && id < 1000000) {
          api.updateMedicine(id, { purchase_price: Number(value) })
            .catch(err => console.error('Error updating Cost Price in DB:', err));
        }

        return updatedItem;
      });
    });
  };

  const clearCart = () => {
    updateCart([]);
  };

  const handleScanResult = (result: ScanResultInfo) => {
    setShowCamera(false);
    if (!result) return;

    const info = result.medicineInfo || {};
    const batchQuery = info.batchNumber;
    const nameQuery = info.potentialName || (result.text ? result.text.split('\n')[0] : '');
    const mrpQuery = info.mrp ? String(info.mrp) : '';

    // Helper to perform the search chain locally
    const executeSearchChain = async () => {
      const compactInventory = getCompactInventoryCache();
      const mapped = compactInventory.map(item => ({
        ...item,
        medicine_name: item.name,
        quantity: item.stock_qty,
        alternatives: []
      }));
      
      // Step 1: Search by batch number (highest precision)
      if (batchQuery && batchQuery.trim().length > 1) {
        const batchTerm = batchQuery.trim().toLowerCase();
        const matches = mapped.filter(m => m.batch_no && m.batch_no.toLowerCase().includes(batchTerm));
        if (matches.length > 0) {
          const exact = matches.find(m => m.batch_no.toLowerCase() === batchTerm);
          return exact || matches[0];
        }
      }

      // Step 2: Search by medicine name (standard lookup)
      if (nameQuery && nameQuery.trim().length > 1) {
        const nameTerm = nameQuery.trim().toLowerCase();
        const matches = filterLocalInventory(nameTerm, mapped);
        if (matches.length > 0) {
          const exact = matches.find(m => (m.medicine_name || '').toLowerCase() === nameTerm);
          return exact || matches[0];
        }
      }

      // Step 3: Search by MRP (fallback lookup)
      if (mrpQuery && mrpQuery.trim().length > 0) {
        const mrpVal = Number(mrpQuery.trim());
        if (!isNaN(mrpVal)) {
          const matches = mapped.filter(m => Math.abs(m.mrp - mrpVal) < 0.01);
          if (matches.length > 0) return matches[0];
        }
      }

      return null;
    };

    executeSearchChain().then(matched => {
      if (matched) {
        fetchDetailsAndAddToCart({
          ...matched,
          scanImage: result.capturedImage,
          rawOcrText: result.text
        });
      } else {
        // Add as custom manual entry from scan details
        let extractedPackSize = 1;
        if (info.packaging) {
          const numMatch = info.packaging.match(/(\d+)\s*(?:tabs?|tablets?|caps?|'s|s\b)/i) || info.packaging.match(/^(\d+)$/);
          if (numMatch) {
            extractedPackSize = parseInt(numMatch[1], 10) || 1;
          }
        }
        addToCart({
          id: Date.now(),
          name: nameQuery.trim() || 'Scanned Item',
          batch: info.batchNumber || '',
          expiry: info.expiryDate || '',
          mrp: Number(info.mrp || 0),
          costPrice: info.costPrice != null ? Number(info.costPrice) : 0,
          salts: 'OCR Scan Entry',
          packSize: extractedPackSize,
          scanImage: result.capturedImage,
          rawOcrText: result.text,
          quantity: 0
        });
      }
    }).catch(err => {
      console.error('Scan resolution failed:', err);
    });
  };
  
  // Calculations — memoized so math only runs when cart contents or bill-level discount change,
  // not on every unrelated re-render (keystrokes in search, modal state updates, etc.)
  const { subtotal, discountAmount, grandTotal, totalCost } = useMemo(() => {
    let sub = 0;
    let cost = 0;
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      const stripPrice = Number(item.unitPrice !== undefined && item.unitPrice !== null ? item.unitPrice : (item.sell_price !== undefined && item.sell_price !== null ? item.sell_price : (item.mrp || 0)));
      const unitRate = (item.packSize || 0) > 0 ? stripPrice / (item.packSize || 1) : stripPrice;
      const itemTotalBeforeDiscount = (stripPrice * (item.qty || 0)) + (unitRate * (item.looseQty || 0));
      sub += itemTotalBeforeDiscount * (1 - (item.discount || 0) / 100);

      const itemCost = item.costPrice != null ? item.costPrice : 0;
      const unitCostRate = (item.packSize || 0) > 0 ? itemCost / (item.packSize || 1) : itemCost;
      cost += (itemCost * (item.qty || 0)) + (unitCostRate * (item.looseQty || 0));
    }
    const discAmt = sub * (discount / 100);
    return {
      subtotal: sub,
      discountAmount: discAmt,
      grandTotal: Math.round(sub - discAmt),
      totalCost: cost,
    };
  }, [cart, discount]);

  const hasValidItems = cart.some(item => !item.isEmptyRow && ((item.name && item.name.trim() !== '') || (item.medicine_name && item.medicine_name.trim() !== '')));
  const profitOrLoss = grandTotal - totalCost;
  const isLoss = hasValidItems && profitOrLoss < -0.001; // Loss greater than 0.1 paise


  const [showPhonePromptModal, setShowPhonePromptModal] = useState(false);
  const [promptPhoneValue, setPromptPhoneValue] = useState('');
  const [shakePromptPhone, setShakePromptPhone] = useState(false);

  const handleCompleteSale = async (overridePhone?: string, isDirectSave: boolean = false) => {
    if (!hasValidItems) {
      alert('⚠️ CANNOT SAVE BILL:\n\nPlease add at least one valid medicine to the cart before saving the bill.');
      return;
    }
    const phoneToUse = sanitizePhoneInput(overridePhone !== undefined ? overridePhone : patientPhone);

    if (isLoss) {
      alert(`❌ CANNOT SAVE BILL:\n\nTransaction results in a Net Loss (Grand Total ₹${grandTotal} is less than Cost Price ₹${Math.round(totalCost)}).\nPlease adjust overall discount or items MRP to proceed.`);
      return;
    }

    const isPhoneRequired = paymentMedium === 'CREDIT' || sendWhatsApp;
    if (isPhoneRequired && !isValid10DigitPhone(phoneToUse)) {
      setPromptPhoneValue(phoneToUse);
      pendingDirectSaveRef.current = isDirectSave;
      setShowPhonePromptModal(true);
      return;
    }
    const finalPhone = isValid10DigitPhone(phoneToUse) ? phoneToUse : '';

    // Expiry check
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      const expiryStr = item.expiry || '';
      if (expiryStr) {
        let expDate: Date;
        if (expiryStr.includes('/')) {
          const parts = expiryStr.split('/');
          let year = parseInt(parts[1], 10);
          const month = parseInt(parts[0], 10) - 1;
          if (year < 100) year += 2000;
          expDate = new Date(year, month + 1, 0);
        } else {
          expDate = new Date(expiryStr);
        }
        if (expDate < new Date()) {
          alert(`❌ CRITICAL SAFETY BLOCK:\n\nCart contains EXPIRED product: ${item.name} (${expiryStr}).\nCannot proceed with checkout.`);
          return;
        }
      }
    }
    
    // Stock Level Verification (Strips + Loose units pool check)
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      
      // Only enforce for items that are linked to actual inventory master items
      if (typeof item.id === 'number' && item.id < 1000000) {
        // Skip when stock data never loaded with the item (e.g. restored held bills / old saved tabs);
        // the server re-verifies stock authoritatively and rejects the sale if truly insufficient.
        if (item.availableStock === undefined && item.availableLooseStock === undefined) continue;

        const packSize = item.packSize || 1;
        const reqQty = Number(item.qty || 0);
        const reqLoose = Number(item.looseQty || 0);
        const reqTotalUnits = reqQty * packSize + reqLoose;

        const availQty = Number(item.availableStock !== undefined ? item.availableStock : 0);
        const availLoose = Number(item.availableLooseStock !== undefined ? item.availableLooseStock : 0);
        const availTotalUnits = availQty * packSize + availLoose;
        
        if (availTotalUnits < reqTotalUnits) {
          alert(`❌ INSUFFICIENT STOCK:\n\nMedicine: ${item.name || 'Medicine'}\nRequested: ${reqQty} strips & ${reqLoose} loose (${reqTotalUnits} units)\nAvailable: ${availQty} strips & ${availLoose} loose (${availTotalUnits} units)\n\nPlease reduce the quantity to match available stock before proceeding.`);
          return;
        }
      }
    }

    // Verify that all items have legitimate inventory batch and price before finalizing
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      const name = item.name || item.medicine_name || '';
      if (!name.trim()) continue;
      const batch = item.batch || item.batch_no || '';
      const unitPrice = Number(item.unitPrice || item.unit_price || item.mrp || 0);
      const inventoryId = item.inventory_id || (typeof item.id === 'number' && item.id < 1000000 ? item.id : undefined);

      if (!inventoryId || !batch.trim()) {
        alert(`❌ Missing Inventory Batch:\n\n"${name}" is not linked to verified inventory stock. Please select an in-stock batch or record a purchase first.`);
        return;
      }
      if (unitPrice <= 0) {
        alert(`❌ Invalid Price:\n\n"${name}" must have a selling price greater than ₹0.`);
        return;
      }
    }
    
    try {
      const salesItems = cart.filter(item => {
        if (item.isEmptyRow) return false;
        const name = item.name || item.medicine_name || '';
        return name.trim() !== '';
      }).map(item => {
        const itemDiscount = item.discount || item.discountPer || 0;
        const resolvedUnitPrice = Number(item.unitPrice || item.mrp || item.unit_price || 0);
        const name = item.name || item.medicine_name || 'Medicine';
        return {
          inventory_id: item.inventory_id || (typeof item.id === 'number' && item.id < 1000000 ? item.id : undefined),
          medicine_name: name,
          batch_no: item.batch || item.batch_no || '',
          expiry_date: item.expiry || item.expiry_date || '',
          mrp: item.mrp || resolvedUnitPrice,
          quantity: Number(item.qty !== undefined ? item.qty : (item.quantity || 0)),
          unit_price: resolvedUnitPrice,
          loose_qty: item.looseQty || item.loose_qty || 0,
          discount_per: itemDiscount,
          pack_size: item.packSize || item.pack_size || 1
        };
      });

      const payload = {
        items: salesItems,
        discount: discountAmount,
        patient_id: selectedCustomerId || undefined,
        patient_name: patientName || 'Walk-in Customer',
        patient_phone: finalPhone,
        doctor_name: doctor || undefined,
        total_amount: grandTotal,
        sale_date: (() => {
          const dateParts = date.split('-');
          const combinedDate = new Date();
          if (dateParts.length === 3) {
            combinedDate.setFullYear(parseInt(dateParts[0], 10));
            combinedDate.setMonth(parseInt(dateParts[1], 10) - 1);
            combinedDate.setDate(parseInt(dateParts[2], 10));
          }
          return combinedDate.toISOString();
        })(),
        paymentMedium: paymentMedium,
        paymentStatus: paymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID',
        sendWhatsApp: Boolean(sendWhatsApp),
        refillEnabled: refillEnabled,
        refillDays: refillDays,
        refillId: activeRefillId || undefined,
        refill_ids: pendingRefillIdsRef.current.length > 0 ? [...pendingRefillIdsRef.current] : undefined,
        editingInvoiceId: editingInvoiceId || undefined
      };
      writeRef(pendingRefillIdsRef, []);

      // Verification Layer Check: Pre-save validation
      try {
        const validation = await api.validateBill(payload as Parameters<typeof api.validateBill>[0]);
        if (!validation.success) {
          alert(`❌ Save Blocked by Verification Layer:\n\nStep: ${validation.layer}\nReason: ${validation.message}`);
          return;
        }
      } catch (err) {
        const serverError = (err as LocalApiError).response?.data?.message || (err as LocalApiError).response?.data?.error || (err as LocalApiError).message;
        const layer = (err as LocalApiError).response?.data?.layer || 'Validation';
        alert(`❌ Verification Layer Pre-Save Failure:\n\nStep: ${layer}\nReason: ${serverError}`);
        return;
      }

      // Proceed to save or update bill
      let result: { invoice_no?: string; invoiceNo?: string } | undefined;
      let isEditMode = false;
      if (editingInvoiceId) {
        isEditMode = true;
        result = await api.updateSale(editingInvoiceId, payload as Parameters<typeof api.updateSale>[1]);
        if (!result) result = {};
        result.invoice_no = editingInvoiceNo || result.invoice_no || result.invoiceNo || `INV-${editingInvoiceId}`;
      } else {
        result = await api.createSale(payload as Parameters<typeof api.createSale>[0]);
      }
      const invoiceNo = result!.invoice_no || result!.invoiceNo || 'SAVED';

      // Verification Layer Check: Post-save history validation
      if (invoiceNo !== 'SAVED') {
        try {
          const syncVerify = await api.verifySalesHistory(invoiceNo);
          if (!syncVerify.success) {
            console.error(`[Verification Layer] Post-save sync check failed: ${syncVerify.message}`);
          }
        } catch (syncErr) {
          console.error('[Verification Layer] Post-save verification API failed:', syncErr);
        }
      }
      
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh the local inventory cache so POS search shows the reduced stock immediately
      api.getCompactInventory().catch(() => {});

      if (finalizingStagedSale) {
        const consumedDraft = finalizingStagedSale;
        setFinalizingStagedSale(null);
        api.consumeStagedSale(consumedDraft.id, { invoice_no: invoiceNo })
          .then(() => {
            stagedQueueService.removeById(consumedDraft.id);
            toastEvent.trigger(`Phone draft #${consumedDraft.id} finalized as bill #${invoiceNo}`, 'info');
          })
          .catch(() => {});
      }

      if ((paymentMedium || '').toUpperCase() === 'CREDIT' && (selectedCustomerId || phoneToUse)) {
        api.getCreditDues({ customerId: selectedCustomerId, phone: phoneToUse, refillId: activeRefillId })
          .then(credit => {
            if (credit.dues.length > 0) {
              setLastSavedCreditDues(credit.dues);
              setLastSavedCreditBalance(credit.balance);
            }
            if (credit.next_refill_due) {
              setLastSavedNextRefillDue(credit.next_refill_due);
            }
          })
          .catch(() => {});
      }
      
      const isWaSent = Boolean(sendWhatsApp) && !!phoneToUse.trim();

      setLastSavedInvoiceNo(invoiceNo);
      setLastSavedPatientName(patientName || 'Walk-in Customer');
      setLastSavedPatientPhone(phoneToUse);
      setLastSavedGrandTotal(grandTotal);
      setLastSavedPaymentMedium(paymentMedium);
      setLastSavedDoctorName(doctor || '');
      setLastSavedWasWhatsAppSent(isWaSent);
      setLastSavedBillDiscount(Number(discountAmount) || 0);
      setLastSavedCreditDues(null);
      setLastSavedCreditBalance(0);
      setLastSavedNextRefillDue(null);
      setLastSavedItems(cart.filter(item => !item.isEmptyRow).map(item => {
        const discPer = Number(item.discountPer || item.discount || 0);
        const lineMrp = Number(item.unitPrice || item.mrp || item.unit_price || 0);
        const dPrice = lineMrp * (1 - discPer / 100);
        const packSize = Number(item.packSize || item.pack_size || 1) || 1;
        const qty = Number(item.qty ?? item.quantity ?? 0);
        const loose = Number(item.looseQty ?? item.loose_qty ?? 0);
        return {
          name: item.name || item.medicine_name,
          batch: item.batch_number || item.batch_no || 'N/A',
          mrp: lineMrp,
          qty,
          looseQty: loose,
          discountPer: discPer,
          amount: dPrice * qty + (dPrice / packSize) * loose
        };
      }));
      
      if (!isDirectSave) {
        setShowBarcodeModal(true);
      } else {
        toastEvent.trigger(isEditMode ? `Bill #${invoiceNo} updated!` : `Bill #${invoiceNo} saved!`, 'success');
      }
      
      // Clear cart and states
      setEditingInvoiceId(null);
      setEditingInvoiceNo(null);
      updateCart([]);
      setPatientName('');
      setPatientPhone('');
      setDoctor('');
      setSelectedDoctorId(null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(0);
      setPaymentMedium('CASH');
      setActiveRefillId(null);
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            items: [],
            patientName: '',
            patientPhone: '',
            refillEnabled: false,
            refillDays: 30,
            doctor: '',
            discount: 0,
            sendWhatsApp: false,
            paymentMedium: 'CASH',
            selectedDoctorId: null
          };
        }
        return t;
      }));
    } catch (error) {
      console.error('Error completing sale:', error);
      // Show actual server error message to help diagnose the issue
      const serverMsg = (error as LocalApiError)?.response?.data?.error || (error as LocalApiError)?.message || 'Unknown error';
      alert(`Failed to save sale:\n\n${serverMsg}\n\nIf this persists, check that the backend server is running.`);
    }
  };

  const handleOpenNewDoctorModal = () => {
    setEditingDoctorId(null);
    setNewDoctorName('');
    setNewDoctorSpecialty('');
    setNewDoctorPhone('');
    setNewDoctorClinic('');
    setNewDoctorRegNo('');
    setShowDoctorModal(true);
  };

  const handleOpenEditDoctorModal = () => {
    const matchedDoc = (doctorsList || []).find(d => d.id === selectedDoctorId) ||
      allDoctors.find(d => d.id === selectedDoctorId || (d.name && d.name.toLowerCase().trim() === doctor.toLowerCase().trim()));

    if (matchedDoc) {
      setEditingDoctorId(matchedDoc.id);
      let cleanName = matchedDoc.name || doctor;
      cleanName = cleanName.replace(/^Dr\.\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      setNewDoctorName(cleanName);
      setNewDoctorSpecialty(matchedDoc.specialization || matchedDoc.specialty || '');
      setNewDoctorPhone(matchedDoc.phone || '');
      setNewDoctorClinic(matchedDoc.clinic_name || matchedDoc.address || '');
      setNewDoctorRegNo(matchedDoc.reg_no || matchedDoc.registration_number || '');
    } else {
      setEditingDoctorId(null);
      const cleanName = doctor.replace(/^Dr\.\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      setNewDoctorName(cleanName);
      setNewDoctorSpecialty('');
      setNewDoctorPhone('');
      setNewDoctorClinic('');
      setNewDoctorRegNo('');
    }
    setShowDoctorModal(true);
  };

  const handleRegisterDoctor = async () => {
    try {
      if (!newDoctorName) return;
      const formattedName = newDoctorName.trim().toLowerCase().startsWith('dr.') ? newDoctorName.trim() : `Dr. ${newDoctorName.trim()}`;
      const docName = newDoctorSpecialty ? `${formattedName} (${newDoctorSpecialty.trim()})` : formattedName;

      let res: { id?: number } | undefined = undefined;
      if (editingDoctorId) {
        res = await api.updateDoctor(editingDoctorId, {
          name: docName,
          specialization: newDoctorSpecialty || 'General',
          phone: newDoctorPhone,
          clinic_name: newDoctorClinic,
          reg_no: newDoctorRegNo
        });
        toastEvent.trigger(`✅ Doctor details updated for ${docName}`, 'success');
      } else {
        res = await api.addDoctor({
          name: docName,
          specialization: newDoctorSpecialty || 'General',
          phone: newDoctorPhone,
          clinic_name: newDoctorClinic,
          reg_no: newDoctorRegNo
        });
        toastEvent.trigger(`✅ New Doctor registered: ${docName}`, 'success');
      }

      try {
        await api.saveContact({
          name: docName,
          type: 'doctor',
          phone: newDoctorPhone,
          address: newDoctorClinic || undefined
        });
        window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
        window.dispatchEvent(new CustomEvent('contacts-updated'));
      } catch {}

      // Refresh doctors list
      queryClient.invalidateQueries({ queryKey: ['crm-doctors'] });
      setDoctor(docName);
      if (res && res.id) {
        setSelectedDoctorId(res.id);
      }
      setShowDoctorModal(false);
      setEditingDoctorId(null);
      setNewDoctorName('');
      setNewDoctorSpecialty('');
      setNewDoctorPhone('');
      setNewDoctorClinic('');
      setNewDoctorRegNo('');
    } catch (err) {
      console.error(err);
      alert('Failed to save doctor details');
    }
  };

  const handleCompleteSaleRef = useRef<((overridePhone?: string, isDirectSave?: boolean) => Promise<void> | void) | null>(null);
  const handleSavePatientProfileRef = useRef<(() => Promise<void> | void) | null>(null);
  const showPatientModalRef = useRef<boolean>(false);

  useEffect(() => {
    writeRef(handleCompleteSaleRef, handleCompleteSale);
    writeRef(handleSavePatientProfileRef, handleSavePatientProfile);
    writeRef(showPatientModalRef, showPatientModal);
  });

  const handleLoadStagedItemIntoPOS = (stagedItem: StagedItem) => {
    if (!stagedItem) return;
    let rawItems: StagedLine[];
    try {
      rawItems = typeof stagedItem.items_json === 'string'
        ? (JSON.parse(stagedItem.items_json) as StagedLine[])
        : ((stagedItem.items_json || stagedItem.items || []) as StagedLine[]);
    } catch {
      rawItems = [];
    }

    const posItems = rawItems.map((it, idx: number) => ({
      id: it.inventory_id || it.id || (1000 + idx),
      medicine_id: it.medicine_id || 0,
      name: it.name || it.medicine_name || 'Unknown',
      qty: it.quantity !== undefined && it.quantity !== null 
        ? Number(it.quantity) 
        : (it.qty !== undefined && it.qty !== null ? Number(it.qty) : 1),
      looseQty: it.loose_quantity !== undefined && it.loose_quantity !== null
        ? Number(it.loose_quantity)
        : (it.loose_qty !== undefined && it.loose_qty !== null ? Number(it.loose_qty) : (it.looseQty || 0)),
      unit_price: it.unit_price || it.rate || it.mrp || 0,
      mrp: it.mrp || 0,
      costPrice: it.cost_price || 0,
      batch: it.batch_number || it.batch || '',
      expiry: it.expiry_date || it.expiry || '',
      salts: it.salts || '',
      packSize: it.pack_size || 1,
      availableStock: Number(it.availableStock ?? it.stock_qty ?? it.quantity ?? 0),
      isEmptyRow: false,
    }));

    setTabs(prev => prev.map((t): POSTab => {
      if (t.id === activeTabId) {
        return {
          ...t,
          patientName: stagedItem.patient_name || '',
          patientPhone: stagedItem.patient_phone || '',
          doctor: stagedItem.doctor_name || '',
          discount: Number(stagedItem.discount || 0),
          paymentMedium: stagedItem.payment_medium || 'CASH',
          items: posItems as unknown as CartRow[],
        };
      }
      return t;
    }));

    toastEvent.trigger(`⚡ Loaded staged order for ${stagedItem.patient_name || 'Customer'} into POS`, 'success');
    setFinalizingStagedSale({ id: stagedItem.id });
  };

  const lastStagedLoadRef = useRef<{ id: number; index: number } | null>(null);

  useEffect(() => {
    const maybeLoadCurrentStaged = () => {
      const current = stagedQueueService.getCurrentItem();
      if (!current) return;
      const state = stagedQueueService.getQueueState();
      if (lastStagedLoadRef.current && lastStagedLoadRef.current.id === current.id && lastStagedLoadRef.current.index === state.currentIndex) return;
      writeRef(lastStagedLoadRef, { id: current.id, index: state.currentIndex });
      handleLoadStagedItemIntoPOS(current);
    };
    maybeLoadCurrentStaged();
    return stagedQueueService.subscribe(maybeLoadCurrentStaged);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stale-closure guard reads live queue
  }, []);

  return (
    <div className="h-full flex flex-col fade-in overflow-hidden text-text">

      {/* Main Container: Stacked — Cart workspace on top, Checkout bar at bottom */}
      <div className="flex-1 flex flex-col gap-0 overflow-hidden min-h-0">

        {/* ── TOP WORKSPACE (full width) ── */}
        <div className="flex-1 flex flex-col gap-2.5 min-h-0 min-w-0 overflow-hidden p-3">

          {/* Editing Bill Banner */}
          {editingInvoiceId && (
            <div className="bg-amber-500/15 border border-amber-500/30 text-amber-500 px-3.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs font-bold shrink-0 shadow-md animate-pulse">
              <div className="flex items-center gap-2">
                <Edit size={15} />
                <span>Editing Saved Bill #{editingInvoiceNo || editingInvoiceId} (Modifying Existing Bill)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingInvoiceId(null);
                  setEditingInvoiceNo(null);
                  clearCart();
                  toastEvent.trigger('Cancelled edit bill mode', 'info');
                }}
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-300 text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel Edit
              </button>
            </div>
          )}

          {/* Phone Draft Banner */}
          {finalizingStagedSale && !editingInvoiceId && (
            <div className="bg-sky/10 border border-sky/30 text-sky px-3.5 py-2 rounded-xl flex items-center justify-between gap-2 text-xs font-bold shrink-0 shadow-md">
              <div className="flex items-center gap-2 min-w-0">
                <Phone size={15} className="shrink-0" />
                <span className="truncate">Finalizing phone draft #{finalizingStagedSale.id} — verify against live stock, then save to create the real bill</span>
              </div>
              <button
                type="button"
                onClick={() => setFinalizingStagedSale(null)}
                className="px-2.5 py-1 bg-sky/20 hover:bg-sky/30 border border-sky/40 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer shrink-0"
              >
                Detach
              </button>
            </div>
          )}

          {/* Top Control Ribbon: Patient, WhatsApp, Doctor, Date, Tabs */}
          <div className="glass-panel p-2.5 bg-glass-bg border-glass-border shrink-0 relative z-40 shadow-sm rounded-2xl w-full min-w-0 flex flex-col gap-2">
            {selectedCustomerId && matchedRefill && (
              <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 shadow-sm animate-fade-in">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse shrink-0" />
                  <span className="truncate">
                    <strong className="text-text">{matchedRefill.patient_name}</strong> has previous prescription / refill: {
                      Array.isArray(matchedRefill.medicines) && matchedRefill.medicines.length > 0 ? (
                        matchedRefill.medicines.map((m, idx) => (
                          <span key={idx} className="text-violet-300 font-bold">
                            {idx > 0 && ', '}
                            {m.medicine_name || m.name} (Qty: {m.quantity || m.quantity_needed || 1})
                          </span>
                        ))
                      ) : (
                        <strong className="text-violet-300">{matchedRefill.medicine_name} (Qty: {matchedRefill.quantity || 1})</strong>
                      )
                    }
                    {matchedRefill.doctor_name ? ` · Dr. ${matchedRefill.doctor_name}` : ''}
                  </span>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleAcceptRefill}
                    className="px-3 py-1 bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-bold text-[10px] transition-all shadow-sm cursor-pointer flex items-center gap-1"
                  >
                    + Add to Bill
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDismissedRefillId(matchedRefill.id || 999999); setMatchedRefill(null); }}
                    className="px-2.5 py-1 bg-bg3/50 hover:bg-bg3 text-muted hover:text-text rounded-lg font-bold text-[10px] transition-all border border-glass-border cursor-pointer"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              {/* Patient Name (Span 4) */}
              <div ref={patientSectionRef} className="md:col-span-4 relative z-20">
                <div className="flex gap-1 items-center relative">
                  <input
                    id="patient-name-input"
                    name="patient_name"
                    type="text"
                    autoComplete="off"
                    className="premium-input text-xs font-semibold h-8.5 px-3 flex-1 w-full bg-bg2/60 border-border/70 rounded-xl placeholder:text-muted/40"
                    placeholder="Walk-in Customer"
                    value={patientName}
                    onChange={e => {
                      writeRef(justSelectedPatientRef, false);
                      writeRef(selectedCustomerIdRef, null);
                      updatePatientName(e.target.value);
                      setSelectedCustomerId(null);
                      setPatientHighlightIndex(-1);
                    }}
                    onFocus={() => { if (selectedCustomerIdRef.current === null && !justSelectedPatientRef.current && patientSuggestions.length > 0) setShowPatientSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowPatientSuggestions(false), 180)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                        if (showPatientSuggestions && patientSuggestions.length > 0 && patientHighlightIndex >= 0) {
                          const sel = patientSuggestions[patientHighlightIndex];
                          writeRef(justSelectedPatientRef, true);
                          writeRef(selectedCustomerIdRef, sel.id);
                          updatePatientName(sel.name);
                          setPatientPhone(sel.phone || '');
                          setSelectedCustomerId(sel.id);
                          setShowPatientSuggestions(false);
                          setPatientHighlightIndex(-1);
                        }
                        e.preventDefault();
                        setTimeout(() => {
                          const docEl = document.getElementById('doctor-name-input');
                          if (docEl) { docEl.focus(); (docEl as HTMLInputElement).select?.(); }
                        }, 50);
                      } else if (showPatientSuggestions && patientSuggestions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setPatientHighlightIndex(i => Math.min(i + 1, patientSuggestions.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setPatientHighlightIndex(i => Math.max(i - 1, 0));
                        } else if (e.key === 'Escape') {
                          setShowPatientSuggestions(false);
                          setPatientHighlightIndex(-1);
                        }
                      }
                    }}
                    aria-label="Patient Name"
                  />
                  {showPatientSuggestions && (
                    <div ref={patientSuggestionsRef} className="absolute left-0 right-0 top-full z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto shadow-2xl">
                      {isPatientFuzzyMatch && (
                        <div className="px-3 py-1.5 bg-amber-500/10 text-amber-400 text-[11px] font-bold border-b border-amber-500/20 flex items-center gap-1.5">
                          <span>🔍</span> No exact match. Did you mean:
                        </div>
                      )}
                      {patientSuggestions.map((c, idx) => {
                        const hasCreditDue = (c.credit_balance && c.credit_balance > 0) || c.credit_enabled === 1;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            data-highlighted={idx === patientHighlightIndex ? "true" : "false"}
                            onMouseDown={() => {
                              justSelectedPatientRef.current = true;
                              selectedCustomerIdRef.current = c.id;
                              updatePatientName(c.name);
                              setPatientPhone(c.phone || '');
                              setSelectedCustomerId(c.id);
                              setPatientSuggestions([]);
                              setShowPatientSuggestions(false);
                              setPatientHighlightIndex(-1);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs border-b border-border/10 transition-all flex items-center justify-between gap-2 ${
                              idx === patientHighlightIndex
                                ? 'bg-primary/20 text-text font-bold'
                                : hasCreditDue
                                ? 'bg-amber-500/5 hover:bg-amber-500/10 text-text'
                                : 'text-text hover:bg-primary/10'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold truncate">{c.name}</span>
                              {c.active_refill === 1 && (
                                <span
                                  className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[9px] font-bold"
                                  title="Active refill schedule — returning refill patient"
                                >
                                  🔁 Refill
                                </span>
                              )}
                              {hasCreditDue && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[9px] font-bold">
                                  Credit ₹{Number(c.credit_balance || 0).toFixed(0)}
                                </span>
                              )}
                            </div>
                            <span className="flex items-center gap-2 shrink-0">
                              {!c.active_refill && (c.purchase_count || 0) > 0 && c.last_sale_date && (
                                <span
                                  className="text-muted text-[10px] font-semibold"
                                  title={`Returning patient — ${c.purchase_count} purchase${(c.purchase_count || 0) > 1 ? 's' : ''}`}
                                >
                                  ↩ last {new Date(c.last_sale_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </span>
                              )}
                              {c.phone && <span className="text-muted font-mono text-[11px]">{c.phone}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    onClick={() => setShowPatientModal(true)}
                    className="h-8.5 w-8.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary transition-all flex items-center justify-center shrink-0 cursor-pointer"
                    title="Manage Patient Profile & Refills"
                  >
                    <Plus size={14} className="stroke-[3]" />
                  </button>
                </div>
              </div>

              {/* WhatsApp Contact (Span 3) */}
              <div className="md:col-span-3">
                <div className="flex gap-1 items-center">
                  <input
                    id="patient-phone-input"
                    name="patient_phone"
                    type="text"
                    autoComplete="off"
                    className="premium-input text-xs font-mono font-semibold h-8.5 px-3 w-full text-text bg-bg2/60 border-border/70 rounded-xl placeholder:text-muted/40"
                    placeholder="Mobile / WhatsApp..."
                    value={patientPhone}
                    onChange={e => setPatientPhone(sanitizePhoneInput(e.target.value))}
                    maxLength={10}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                        e.preventDefault();
                        const docEl = document.getElementById('doctor-name-input');
                        if (docEl) { docEl.focus(); (docEl as HTMLInputElement).select?.(); }
                      } else if (e.key === 'Tab' && e.shiftKey) {
                        e.preventDefault();
                        const patEl = document.getElementById('patient-name-input');
                        if (patEl) { patEl.focus(); (patEl as HTMLInputElement).select?.(); }
                      }
                    }}
                    aria-label="Phone Number"
                  />
                  <button
                    onClick={() => setSendWhatsApp(!sendWhatsApp)}
                    className={`h-8.5 px-2.5 rounded-xl border text-[9px] font-extrabold uppercase tracking-wider flex items-center gap-1 transition-all select-none shrink-0 cursor-pointer ${
                      sendWhatsApp
                        ? 'bg-green/15 border-green/30 text-green hover:bg-green/25'
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                    }`}
                    title={sendWhatsApp ? "WhatsApp Notifications Active" : "WhatsApp Notifications Inactive"}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${sendWhatsApp ? 'bg-green animate-pulse' : 'bg-muted/40'}`} />
                    <span>WA:{sendWhatsApp ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              {/* Doctor Picker (Span 3) */}
              <div ref={doctorSectionRef} className="md:col-span-3 relative z-20">
                <div className="flex gap-1 relative items-center">
                  <input
                    id="doctor-name-input"
                    name="doctor_name"
                    type="text"
                    autoComplete="off"
                    aria-label="Prescribing Doctor"
                    className="premium-input text-xs font-semibold h-8.5 pl-3 pr-6 bg-bg2/60 border-border/70 w-full text-text focus:border-sky rounded-xl placeholder:text-muted/40"
                    placeholder="Select Doctor..."
                    value={doctor}
                    onChange={e => {
                      justSelectedDoctorRef.current = false;
                      selectedDoctorIdRef.current = null;
                      setDoctor(e.target.value);
                      setSelectedDoctorId(null);
                      setDoctorHighlightIndex(-1);
                      setIsDoctorDropdownOpen(e.target.value.trim().length >= 2);
                    }}
                    onFocus={() => {
                      if (
                        selectedDoctorIdRef.current === null &&
                        !justSelectedDoctorRef.current &&
                        doctor.trim().length >= 2
                      ) {
                        setIsDoctorDropdownOpen(true);
                      }
                      doctorsControl.requestLoad();
                    }}
                    onBlur={() => setTimeout(() => setIsDoctorDropdownOpen(false), 200)}
                    onKeyDown={e => {
                      if (e.key === 'Tab' && e.shiftKey) {
                        e.preventDefault();
                        setIsDoctorDropdownOpen(false);
                        setDoctorHighlightIndex(-1);
                        const patEl = document.getElementById('patient-name-input');
                        if (patEl) { patEl.focus(); (patEl as HTMLInputElement).select?.(); }
                        return;
                      }
                      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                        e.preventDefault();
                        if (isDoctorDropdownOpen && filteredDoctors.length > 0) {
                          const targetIdx = doctorHighlightIndex >= 0 ? doctorHighlightIndex : 0;
                          const sel = filteredDoctors[targetIdx];
                          if (sel) {
                            justSelectedDoctorRef.current = true;
                            selectedDoctorIdRef.current = sel.id;
                            setDoctor(sel.name);
                            setSelectedDoctorId(sel.id);
                          }
                        }
                        setIsDoctorDropdownOpen(false);
                        setDoctorHighlightIndex(-1);
                        focusCartMedicineInput();
                      } else if (isDoctorDropdownOpen && filteredDoctors.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setDoctorHighlightIndex(i => Math.min(i + 1, filteredDoctors.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setDoctorHighlightIndex(i => Math.max(i - 1, 0));
                        } else if (e.key === 'Escape') {
                          setIsDoctorDropdownOpen(false);
                          setDoctorHighlightIndex(-1);
                        }
                      }
                    }}
                    title="Select or Type Doctor Name"
                  />
                  {isDoctorDropdownOpen && doctor.trim().length >= 2 && (
                    <div ref={doctorSuggestionsRef} className="absolute left-0 right-0 top-full z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto shadow-2xl">
                      {filteredDoctors.length > 0 ? (
                        filteredDoctors.map((doc, idx) => (
                          <button
                            key={doc.id}
                            type="button"
                            data-highlighted={idx === doctorHighlightIndex ? "true" : "false"}
                            onMouseDown={() => {
                              justSelectedDoctorRef.current = true;
                              selectedDoctorIdRef.current = doc.id;
                              setDoctor(doc.name);
                              setSelectedDoctorId(doc.id);
                              setIsDoctorDropdownOpen(false);
                              setDoctorHighlightIndex(-1);
                              focusCartMedicineInput();
                            }}
                            className={`w-full text-left px-3 py-2 text-xs border-b border-border/10 transition-all font-semibold ${
                              idx === doctorHighlightIndex
                                ? 'bg-sky/20 text-text font-bold'
                                : 'text-text hover:bg-sky/10'
                            }`}
                          >
                            {doc.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs text-muted italic">
                          Press Enter to add: "{doctor}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline Edit Doctor Button (Visible when Doctor is selected/typed) */}
                  {doctor.trim() !== '' && (
                    <button
                      type="button"
                      onClick={handleOpenEditDoctorModal}
                      aria-label="Edit Selected Doctor Profile"
                      className="h-8.5 w-8.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 transition-all flex items-center justify-center shrink-0 cursor-pointer shadow-sm"
                      title="Edit Selected Doctor Profile Directly"
                    >
                      <Edit size={14} className="stroke-[2.5]" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleOpenNewDoctorModal}
                    aria-label="Register New Doctor"
                    className="h-8.5 w-8.5 rounded-xl bg-sky/10 hover:bg-sky/20 border border-sky/20 text-sky transition-all flex items-center justify-center shrink-0 cursor-pointer"
                    title="Register New Doctor"
                  >
                    <Plus size={14} className="stroke-[3]" />
                  </button>
                </div>
              </div>

              {/* Billing Date (Span 2) */}
              <div className="md:col-span-2">
                <input
                  id="pos-billing-date"
                  name="billing_date"
                  type="date"
                  autoComplete="off"
                  className="premium-input text-xs font-semibold h-8.5 px-2.5 text-text w-full font-mono bg-bg2/60 border-border/70 rounded-xl"
                  value={toDateInputValue(date)}
                  onChange={e => setDate(e.target.value)}
                  aria-label="Transaction Date"
                />
              </div>
            </div>
          </div>

          {/* A. Search & Scan Medicine Bar */}
          <div className="glass-panel p-2 flex items-center gap-2 bg-glass-bg border-glass-border relative z-30 shrink-0 shadow-sm rounded-2xl w-full min-w-0 transition-all duration-300">
            {!inventoryIndexReady && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold">
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span>Preparing index…</span>
              </div>
            )}
            
            {!isSearchExpanded && !searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setIsSearchExpanded(true);
                  setTimeout(() => focusMedicineSearch(), 50);
                }}
                className="premium-btn bg-bg2 border border-border/60 hover:border-primary/50 text-text transition-all flex items-center gap-1.5 px-3 h-8 rounded-lg shrink-0 font-medium group cursor-pointer"
              >
                <Search size={13} className="text-primary group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-bold">Search Medicine</span>
                <span className="text-[9px] font-mono font-bold bg-primary/15 border border-primary/30 px-1 py-0.5 rounded text-primary">
                  F2 / Ctrl+K
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full animate-in fade-in duration-200">
                <div ref={productSearchRef} className="relative flex-1">
                  <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted">
                    {inventoryIndexReady ? <Search size={15} /> : <Loader2 size={15} className="animate-spin text-primary" />}
                  </span>
                  <input
                    id="medicine-search-input"
                    name="medicine_search"
                    type="text"
                    autoComplete="off"
                    aria-label="Search medicine by name, composition, batch, or price"
                    placeholder={inventoryIndexReady ? "Search medicine by name, composition, batch, or price... (Ctrl + K)" : "Warming up search index..."}
                    disabled={!inventoryIndexReady}
                    className="premium-input w-full text-xs pl-9 pr-14 py-2 bg-bg2/50 border-border/60 text-text rounded-xl focus:ring-primary/20 disabled:opacity-60 disabled:cursor-wait font-medium"
                    value={searchTerm}
                    onFocus={() => {
                      setIsSearchExpanded(true);
                      if (searchTerm.trim().length >= 2) {
                        setShowSearchDropdown(true);
                      }
                    }}
                    onBlur={() => {
                      if (!searchTerm.trim()) {
                        setTimeout(() => setIsSearchExpanded(false), 250);
                      }
                    }}
                    onChange={e => {
                      const val = e.target.value;
                      setSearchTerm(val);
                      setSearchHighlightIndex(-1);
                      if (val.trim().length >= 2) {
                        setShowSearchDropdown(true);
                      } else {
                        setShowSearchDropdown(false);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Tab' && e.shiftKey) {
                        e.preventDefault();
                        setShowSearchDropdown(false);
                        setSearchHighlightIndex(-1);
                        const docEl = document.getElementById('doctor-name-input');
                        if (docEl) { docEl.focus(); (docEl as HTMLInputElement).select?.(); }
                        return;
                      }
                      if (e.key === 'ArrowDown') {
                        if (searchResults.length > 0) {
                          e.preventDefault();
                          setSearchHighlightIndex(i => Math.min(i + 1, searchResults.length - 1));
                        }
                      } else if (e.key === 'ArrowUp') {
                        if (searchResults.length > 0) {
                          e.preventDefault();
                          setSearchHighlightIndex(i => Math.max(i - 1, 0));
                        }
                      } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && showSearchDropdown && searchResults.length > 0)) {
                        if (searchResults.length > 0) {
                          e.preventDefault();
                          const targetIdx = searchHighlightIndex >= 0 ? searchHighlightIndex : 0;
                          const item = searchResults[targetIdx];
                          if (item) {
                            fetchDetailsAndAddToCart(item);
                            setSearchTerm('');
                            setSearchResults([]);
                            setSearchHighlightIndex(-1);
                            setShowSearchDropdown(false);
                          }
                        }
                      } else if (e.key === 'Escape') {
                        setShowSearchDropdown(false);
                        setSearchHighlightIndex(-1);
                        if (!searchTerm.trim()) setIsSearchExpanded(false);
                      }
                    }}
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('');
                          setShowSearchDropdown(false);
                        }}
                        className="text-muted hover:text-text p-1 cursor-pointer"
                        title="Clear text"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('');
                        setShowSearchDropdown(false);
                        setIsSearchExpanded(false);
                      }}
                      className="text-muted hover:text-text p-1 cursor-pointer rounded hover:bg-bg3"
                      title="Collapse search bar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {showSearchDropdown && searchTerm.trim().length >= 3 && searchResults.length === 0 && (
                    <div className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                      {suggestions.length > 0 && (
                        <div className="p-3 border-b border-border/30 bg-violet-500/5">
                        <span className="text-[13px] font-bold text-violet-400 uppercase tracking-wider block mb-1.5">Did you mean:</span>
                        <div className="flex gap-2 flex-wrap">
                          {suggestions.map((sug) => (
                            <button
                              key={sug.medicine_id}
                              type="button"
                              onClick={() => {
                                setSearchTerm(sug.name);
                              }}
                              className="px-2.5 py-1.5 text-[16px] rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/20 transition-all font-medium"
                            >
                              {sug.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="p-3 border-b border-border/30 text-[13px] font-bold text-muted uppercase tracking-wider bg-bg3/55">
                      ⚠️ No matching inventory found
                    </div>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          addToCart({
                            id: Date.now(),
                            name: searchTerm.trim(),
                            batch: '',
                            expiry: '',
                            mrp: 0,
                            costPrice: 0,
                            salts: 'Custom Manual Entry',
                            packSize: 1,
                            quantity: 0
                          });
                          setSearchTerm('');
                          setShowSearchDropdown(false);
                        }}
                        className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/20 text-left transition-all text-[16px] w-full group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-text group-hover:text-primary transition-all">Add "{searchTerm.trim()}" directly to cart (Quick Add)</span>
                          <span className="text-[13px] text-muted font-normal">Added as custom entry — please input real rate, batch, and expiry</span>
                        </div>
                        <span className="text-[14px] bg-primary/10 border border-primary/20 text-primary py-1.5 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-white transition-all">+ Add</span>
                      </button>

                      {searchingOnline && (
                        <div className="flex items-center justify-center p-4 text-[16px] text-muted gap-2 border-t border-border/20 bg-bg3/20">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-3 bg-bg3/55 border-t border-border/30 text-[13px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database)
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[13px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || '—'}</strong></span>
                                {sug.manufacturer && <span className="text-[13px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[14px] bg-sky/10 border border-sky/20 text-sky py-1.5 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-white transition-all">✨ Import & Add</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Search results dropdown */}
                {showSearchDropdown && searchTerm.trim().length >= 2 && searchResults.length > 0 && (
                  <div ref={searchResultsRef} className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                    {suggestions.length > 0 && (
                      <div className="p-3 border-b border-border/30 bg-violet-500/5">
                        <span className="text-[13px] font-bold text-violet-400 uppercase tracking-wider block mb-1.5">Did you mean:</span>
                        <div className="flex gap-2 flex-wrap">
                          {suggestions.map((sug) => (
                            <button
                              key={sug.medicine_id}
                              type="button"
                              onClick={() => {
                                apiClient.post('/medicines/learn-correction', {
                                  originalQuery: searchTerm,
                                  correctedMedicineId: sug.medicine_id,
                                  context: 'POS_FUZZY_SUGGESTION'
                                }).catch(err => console.error('Failed to learn correction:', err));
                                setSearchTerm(sug.name);
                              }}
                              className="px-2.5 py-1.5 text-[16px] rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/20 transition-all font-medium"
                            >
                              {sug.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="p-3 border-b border-border/30 bg-bg3/55 text-[13px] font-bold text-muted uppercase tracking-wider">
                      Matching Inventory Records:
                    </div>
                    <div className="flex flex-col">
                      {searchResults.map((med) => {
                        const renderMedicineItem = (item: PosBatchItem, isAlt = false) => {
                          const isHighlighted = !isAlt && searchHighlightIndex === searchResults.indexOf(item);
                          const packSize = item.pack_size || 1;
                          const totalUnits = (item.quantity || 0) * packSize + (item.loose_quantity || 0);
                          const cartUnits = cart.reduce((sum, c) => {
                            const isSameMed = c.medicine_id === item.medicine_id || 
                              (c.name || c.medicine_name || '').toLowerCase().trim() === (item.medicine_name || '').toLowerCase().trim();
                            if (isSameMed && !c.isEmptyRow) {
                              const cQty = c.qty ?? c.quantity ?? 0;
                              const cLoose = c.looseQty ?? c.loose_qty ?? 0;
                              return sum + (cQty * packSize) + cLoose;
                            }
                            return sum;
                          }, 0);
                          const remainingUnits = Math.max(0, totalUnits - cartUnits);
                          const remainingPacks = Math.floor(remainingUnits / packSize);
                          const isLowStockAlert = remainingPacks <= 3;

                          return (
                            <button
                              key={item.inventory_id || `item_${item.medicine_id}_${Math.random()}`}
                              type="button"
                              data-highlighted={isHighlighted ? "true" : "false"}
                              onClick={() => {
                                if (totalUnits <= 0) {
                                  toastEvent.trigger(`${item.medicine_name} is currently out of stock!`, 'error');
                                  return;
                                }
                                if (remainingUnits <= 0) {
                                  toastEvent.trigger(`Cannot add more ${item.medicine_name} — maximum available stock (${totalUnits} units) is already in cart!`, 'error');
                                  return;
                                }
                                fetchDetailsAndAddToCart(item);
                                setSearchTerm('');
                                setSearchResults([]);
                                setShowSearchDropdown(false);
                              }}
                              className={`flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group ${
                                isAlt ? 'pl-8 bg-sky/5' : ''
                              } ${
                                isLowStockAlert ? 'bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-amber-500' : ''
                              } ${
                                isHighlighted ? 'bg-primary/10 border-l-2 border-primary' : ''
                              }`}
                            >
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {isAlt && <span className="text-[13px] bg-sky/20 text-sky px-1.5 py-0.5 rounded font-bold mr-1">ALT</span>}
                                  <span className="font-semibold text-text group-hover:text-primary transition-all">{item.medicine_name}</span>
                                  {isLowStockAlert && (
                                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider">
                                      ⚠️ Low Stock ({remainingPacks} Left • Refill Needed)
                                    </span>
                                  )}
                                </div>
                                <span className="text-[13px] text-muted">
                                  Company: <span className="text-text font-semibold">{item.manufacturer || '—'}</span>
                                  {item.quantity !== undefined && (() => {
                                    const remainingLoose = remainingUnits % packSize;
                                    const hasLoose = (item.loose_quantity !== undefined && item.loose_quantity > 0) || remainingLoose > 0;
                                    return (
                                      <span className={`ml-3 font-mono font-semibold ${isLowStockAlert ? 'text-amber-400' : 'text-primary'}`}>
                                        Stock: {remainingPacks} Str
                                        {hasLoose && ` / ${remainingLoose} Tab`}
                                      </span>
                                    );
                                  })()}
                                </span>
                                {!isAlt && (!item.api_reference || item.api_reference.trim() === '') && (
                                  <span 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const res = await api.queueFromPos(Number(item.medicine_id));
                                        navigate(`/composition-queue?highlight=${res.id}`);
                                      } catch (err) {
                                        console.error('Failed to queue medicine from POS:', err);
                                      }
                                    }}
                                    className="text-[13px] text-violet-400 hover:text-violet-300 font-bold underline cursor-pointer w-fit mt-0.5"
                                  >
                                    Verify composition ↗
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="font-mono text-green font-bold">MRP: ₹{Math.round(item.mrp ?? 0)}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditMedicineId(Number(item.medicine_id));
                                    }}
                                    className="p-1.5 rounded-lg bg-bg border border-border/40 text-muted hover:text-text hover:bg-bg3 transition-all"
                                    title="Quick Edit Medicine"
                                  >
                                    <Edit size={12} />
                                  </button>
                                  <span className="text-[14px] bg-primary/10 border border-primary/20 text-primary py-1.5 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-white transition-all">+ Add</span>
                                </div>
                              </div>
                            </button>
                          );
                        };

                        const cartQty = cart.reduce((sum, c) => {
                          if (c.medicine_id === med.medicine_id) {
                            return sum + (c.qty || 0);
                          }
                          return sum;
                        }, 0);
                        const isOutOfStock = med.is_out_of_stock || (med.quantity !== undefined && (med.quantity - cartQty) <= 0);

                        if (isOutOfStock) {
                          return (
                            <div key={`oos_${med.medicine_id}`} className="flex flex-col border-b border-border/10">
                              <div className="p-3 bg-red-500/5 text-[16px] w-full flex flex-col gap-1 border-l-2 border-red-500">
                                 <div className="flex items-center justify-between">
                                   <div>
                                     <span className="font-bold text-red-400 line-through mr-2">{med.medicine_name}</span>
                                     <span className="text-[13px] text-red-400 font-bold uppercase border border-red-500/20 px-1.5 py-0.5 rounded bg-red-500/10">Out of Stock</span>
                                   </div>
                                 </div>
                                 {med.alternatives && med.alternatives.length > 0 && (
                                   <div className="text-[13px] text-sky font-bold flex items-center gap-1.5 mt-1">
                                     <span className="h-1.5 w-1.5 bg-sky rounded-full animate-ping"></span> 
                                     Alternatives in stock (same composition):
                                   </div>
                                 )}
                              </div>
                              {med.alternatives && med.alternatives.map(alt => renderMedicineItem(alt, true))}
                            </div>
                          );
                        }

                        return (
                          <div key={`in_stock_${med.inventory_id}`} className="flex flex-col">
                            {renderMedicineItem(med, false)}
                            {med.alternatives && med.alternatives.length > 0 && (
                              <div className="flex flex-col border-l-2 border-sky/30 ml-2 bg-bg3/30">
                                <div className="px-6 py-1.5 bg-sky/5 text-[13px] text-sky font-bold uppercase tracking-wider flex items-center gap-1">
                                  <span className="rotate-90">↳</span> Substitutes Available:
                                </div>
                                {med.alternatives.map(alt => renderMedicineItem(alt, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {searchingOnline && (
                        <div className="flex items-center justify-center p-3 text-[16px] text-muted gap-2 border-t border-border/10 bg-bg3/25">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-3 border-t border-border/30 bg-bg3/55 text-[13px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database):
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[13px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || '—'}</strong></span>
                                {sug.manufacturer && <span className="text-[13px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[14px] bg-sky/10 border border-sky/20 text-sky py-1.5 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-white transition-all">✨ Import & Add</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}

              {/* Doctor's commonly-prescribed medicines — quick-add chips (usual qty preset) */}
              {selectedDoctorId != null && doctorSuggestions.length > 0 && (
                <div className="flex items-center gap-1 min-w-0 max-w-[46%] overflow-x-auto scrollbar-thin shrink-0">
                  <span className="text-[9px] font-black uppercase tracking-wider text-sky shrink-0">Dr. Rx:</span>
                  {doctorSuggestions.slice(0, 8).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleDoctorSuggestionClick(s)}
                      title={`Prescribed ${s.frequency || 1}× by Dr. ${doctor} — usual qty ${s.most_common_qty || 1}${s.most_common_loose_qty ? ` +${s.most_common_loose_qty} loose` : ''}`}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky/10 border border-sky/25 text-sky hover:bg-sky/20 hover:border-sky/40 transition-all text-[10px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span className="truncate max-w-[120px]">{s.name}</span>
                      <span className="font-mono text-primary">×{s.most_common_qty || 1}{s.most_common_loose_qty ? `+${s.most_common_loose_qty}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                aria-label="AI Camera Scan"
                onClick={() => setShowCamera(true)}
                className="premium-btn bg-gradient-to-r from-primary to-teal-500 text-white shadow-[0_2px_8px_rgba(59,130,246,0.2)] hover:shadow-[0_4px_12px_rgba(59,130,246,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-1.5 px-3 h-8 rounded-lg shrink-0 font-bold text-[11px]"
              >
                <Camera size={13} />
                <span>AI Camera Scan</span>
              </button>
            </div>

          {/* B. Cart Panel - Takes up all remaining height */}
          <div className="flex-1 glass-panel flex flex-col overflow-hidden bg-glass-bg border-glass-border relative z-10 min-h-0 min-w-0 shadow-md w-full">
            {/* Cart Header / Tab System */}
            <div className="p-2.5 border-b border-border flex items-center justify-between gap-3 bg-bg3/30 flex-nowrap shrink-0 rounded-t-[2rem]">
              <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 scrollbar-thin py-0.5">
                {tabs.map((t) => {
                  const isActive = t.id === activeTabId;
                  const count = getTabItemsCount(t);
                  const displayName = (t.patientName || '').trim() ? `Pt: ${t.patientName}` : t.name;
                  return (
                    <div
                      key={t.id}
                      onClick={() => switchTab(t.id)}
                      className={`flex items-center gap-2 px-3.5 py-1.8 rounded-xl border font-bold text-xs transition-all select-none cursor-pointer flex-shrink-0 whitespace-nowrap ${
                        isActive 
                          ? 'bg-primary/10 border-primary text-primary shadow-[inset_0_0_12px_rgba(59,130,246,0.1)]' 
                          : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      <ShoppingCart size={13} className={isActive ? 'text-primary' : 'text-muted'} />
                      <span>{displayName} ({count})</span>
                      {tabs.length > 1 && (
                        <span 
                          onClick={(e) => closeTab(t.id, e)}
                          className="hover:bg-bg3 rounded-full p-0.5 ml-1 transition-all cursor-pointer flex items-center justify-center text-muted hover:text-text"
                          title="Close Tab"
                        >
                          <X size={10} />
                        </span>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={addNewTab}
                  className="flex items-center justify-center flex-shrink-0 p-1.5 rounded-xl border border-dashed border-border text-muted hover:text-text hover:border-text transition-all bg-bg hover:bg-bg2 h-[28px] w-[28px]"
                  title="Add New Cart"
                >
                  <Plus size={13} />
                </button>
              </div>
              
              <div className="flex items-center gap-2 ml-auto">
                {specialOrdersControl.mode === 'manual' && !specialOrdersControl.loaded && specialOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => specialOrdersControl.requestLoad()}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-extrabold uppercase bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 transition-all cursor-pointer mr-1"
                  >
                    Load Special Orders
                  </button>
                )}
                <button 
                  onClick={clearCart}
                  className="premium-btn bg-red/10 border border-red/20 text-red text-xs py-1.5 px-3 hover:bg-red/20 transition-all flex items-center gap-1.5 rounded-xl"
                >
                  <Trash2 size={12} /> Clear Cart
                </button>
              </div>
            </div>

            {/* Cart Table Container */}
            <div className="flex-1 overflow-auto bg-bg/25 scrollbar-thin">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-bg2/95 backdrop-blur-xl z-10">
                  <tr>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border">Medicine</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border">Batch</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Expiry</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Strip</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Loose</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Live Stock</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Disc %</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-right">Rate</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-right">MRP</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted uppercase tracking-wider border-b-2 border-border text-right">Total</th>
                    <th className="py-2 px-2.5 text-xs font-bold text-muted tracking-wider border-b-2 border-border"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map(item => {
                    const stripPrice = Number(item.unitPrice !== undefined && item.unitPrice !== null ? item.unitPrice : (item.sell_price !== undefined && item.sell_price !== null ? item.sell_price : (item.mrp || 0)));
                    const unitRate = (item.packSize || 0) > 0 ? stripPrice / (item.packSize || 1) : stripPrice;
                    const itemTotal = ((stripPrice * (item.qty || 0)) + (unitRate * (item.looseQty || 0))) * (1 - (item.discount || 0) / 100);
                    
                    // Near expiry highlight
                    let expBadgeClass = "bg-bg3 border border-border text-text";
                    if (item.expiry) {
                      const parts = item.expiry.split('/');
                      if (parts.length === 2) {
                        let year = parseInt(parts[1], 10);
                        const month = parseInt(parts[0], 10) - 1;
                        if (year < 100) year += 2000;
                        const expDate = new Date(year, month + 1, 0);
                        const diffMs = expDate.getTime() - new Date().getTime();
                        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        if (diffDays <= 90) {
                          expBadgeClass = "bg-amber-500/10 border border-amber-500/30 text-amber-500 font-bold";
                        }
                      }
                    }

                    // 3-Color Classification System:
                    // Color 1 (Theme Normal): Registered in Local Inventory with active stock & batch
                    // Color 2 (Amber Tint): Exists in Master Catalog, but NOT in active local inventory (0 stock)
                    // Color 3 (Purple Tint): Completely new / manual / unmapped item

                    const rowStatusClass = "border-b border-border/30 hover:bg-bg2/40";
                    let statusBadge = null;

                    if (!item.isEmptyRow) {
                      statusBadge = null;
                    }

                    return (
                      <tr key={item.id} data-medicine-id={item.medicine_id} className={`transition-all h-[38px] ${rowStatusClass}`}>
                        {/* Medicine Search/Change */}
                        <td className="py-1 px-2.5 min-w-[180px] relative">
                          <div className="flex items-center">
                            {statusBadge}
                            {item.scanImage && (
                              <div className="relative group/thumb shrink-0 mr-2 select-none animate-in fade-in duration-200">
                                {/* ponytail: data URLs gain nothing from loading=lazy; combined with
                                    KeepAliveOutlet display:none it left thumbnails blank until interaction */}
                                <img
                                  src={item.scanImage}
                                  alt="Scan thumbnail"
                                  decoding="async"
                                  className="w-7 h-7 object-cover rounded-lg border border-border/60 hover:border-primary/60 transition-all cursor-zoom-in shadow-sm"
                                  onClick={() => setZoomedImage(item.scanImage ?? null)}
                                />
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover/thumb:block z-[100] bg-bg2 border border-border rounded-xl p-2 shadow-2xl w-48 animate-in fade-in duration-150">
                                  <img src={item.scanImage} alt="Scan preview" decoding="async" className="w-full h-auto rounded-lg object-contain" />
                                  <div className="text-[8px] text-muted text-center mt-1 font-semibold">Click to enlarge</div>
                                </div>
                              </div>
                            )}
                            <div ref={activeRowSearchIndex === cart.indexOf(item) ? activeRowRef : null} className="flex-1 relative">
                              <input 
                                id={`row-med-input-${cart.indexOf(item)}`}
                                name={`row_med_name_${cart.indexOf(item)}`}
                                type="text" 
                                autoComplete="off"
                                className="w-full bg-transparent border-0 border-b border-transparent hover:border-border/60 focus:border-primary/60 focus:ring-0 text-sm font-semibold text-text py-0.5 px-1 rounded"
                                value={activeRowSearchIndex === cart.indexOf(item) ? rowSearchTerm : item.name}
                                onChange={e => {
                                  const val = e.target.value;
                                  const idx = cart.indexOf(item);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  if (window.innerHeight - rect.bottom < 240 && rect.top > 240) {
                                    setRowSearchDropUp(true);
                                  } else {
                                    setRowSearchDropUp(false);
                                  }
                                  setActiveRowSearchIndex(idx);
                                  setRowSearchTerm(val);
                                }}
                                onFocus={e => {
                                  const idx = cart.indexOf(item);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  if (window.innerHeight - rect.bottom < 240 && rect.top > 240) {
                                    setRowSearchDropUp(true);
                                  } else {
                                    setRowSearchDropUp(false);
                                  }
                                  setActiveRowSearchIndex(idx);
                                  const currentName = item.isEmptyRow ? '' : (item.name || '');
                                  setRowSearchTerm(currentName);
                                  if (!item.isEmptyRow) {
                                    (e.target as HTMLInputElement).select?.();
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowSearchIndex(null);
                                    setRowSearchTerm('');
                                    setRowSearchResults([]);
                                    setRowSearchHighlightIndex(-1);
                                  }, 250);
                                }}
                                onKeyDown={e => {
                                  const idx = cart.indexOf(item);
                                  if (e.key === 'Tab' && e.shiftKey) {
                                    e.preventDefault();
                                    setActiveRowSearchIndex(null);
                                    setRowSearchTerm('');
                                    setRowSearchResults([]);
                                    setRowSearchHighlightIndex(-1);
                                    if (idx > 0) {
                                      const prevQty = document.getElementById(`row-qty-input-${idx - 1}`);
                                      if (prevQty) { prevQty.focus(); (prevQty as HTMLInputElement).select?.(); }
                                    } else {
                                      const docEl = document.getElementById('doctor-name-input');
                                      if (docEl) { docEl.focus(); (docEl as HTMLInputElement).select?.(); }
                                    }
                                    return;
                                  }
                                  if (activeRowSearchIndex !== idx || rowSearchResults.length === 0) return;
                                  if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setRowSearchHighlightIndex(i => Math.min(i + 1, rowSearchResults.length - 1));
                                  } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setRowSearchHighlightIndex(i => Math.max(i - 1, 0));
                                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                                    if (rowSearchHighlightIndex >= 0 && rowSearchHighlightIndex < rowSearchResults.length) {
                                      e.preventDefault();
                                      fetchDetailsAndChangeRowMedicine(idx, rowSearchResults[rowSearchHighlightIndex]);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setActiveRowSearchIndex(null);
                                    setRowSearchTerm('');
                                    setRowSearchResults([]);
                                    setRowSearchHighlightIndex(-1);
                                  }
                                }}
                                placeholder={item.isEmptyRow ? "Search medicine..." : "Change medicine..."}
                              />
                              
                              {activeRowSearchIndex === cart.indexOf(item) && rowSearchTerm.trim().length >= 2 && rowSearchResults.length > 0 && (
                                <div 
                                  ref={rowSearchResultsRef} 
                                  className={`absolute left-0 right-0 z-[9999] bg-bg2 border-2 border-primary/40 rounded-xl overflow-hidden max-h-56 overflow-y-auto w-[340px] shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl ${
                                    rowSearchDropUp
                                      ? 'bottom-full mb-1'
                                      : 'top-full mt-1'
                                  }`}
                                >
                                  {rowSearchResults.map((med, mIdx) => {
                                    const rowPendingMatches = specialOrders.filter(
                                      o => o.product.toLowerCase().trim() === (med.medicine_name || '').toLowerCase().trim() ||
                                           (med.medicine_name || '').toLowerCase().includes(o.product.toLowerCase().trim())
                                    );
                                    const rowHasPending = rowPendingMatches.length > 0;
                                    const isRowHighlighted = rowSearchHighlightIndex === mIdx;
                                    const locTag = med.location || med.rack || (med as any).shelf || '';
                                    return (
                                      <button
                                        key={med.inventory_id}
                                        type="button"
                                        data-highlighted={isRowHighlighted ? "true" : "false"}
                                        onMouseEnter={() => setRowSearchHighlightIndex(mIdx)}
                                        onClick={() => {
                                          const idx = cart.indexOf(item);
                                          fetchDetailsAndChangeRowMedicine(idx, med);
                                        }}
                                        className={`flex flex-col p-2.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-xs w-full cursor-pointer ${isRowHighlighted ? 'bg-primary/20 border-l-2 border-primary text-text' : ''}`}
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                            <span className="font-semibold text-text truncate">{med.medicine_name}</span>
                                            {rowHasPending && (
                                              <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 px-1.5 py-0.5 rounded text-[11px] font-bold animate-pulse">
                                                ⚠️ {rowPendingMatches[0].requester} ({rowPendingMatches[0].qty})
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            {locTag && (
                                              <span className="text-[10px] bg-bg3/80 border border-border/40 text-muted px-1.5 py-0.5 rounded font-mono font-bold" title="Store Location / Rack">
                                                📍 {locTag}
                                              </span>
                                            )}
                                            {med.medicine_id && (
                                              <button
                                                type="button"
                                                title="Quick Edit in Universal Medicine Editor"
                                                onMouseDown={(e) => {
                                                  e.stopPropagation();
                                                  setEditMedicineId(Number(med.medicine_id));
                                                }}
                                                className="p-1 rounded bg-bg3/60 hover:bg-bg3 border border-border/40 text-muted hover:text-text transition-all shrink-0 cursor-pointer"
                                              >
                                                <Edit size={11} />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <span className="text-[11px] text-muted font-mono mt-0.5">Batch: {med.batch_no} | Exp: {med.expiry_date}</span>
                                        <span className="text-[11px] text-green font-bold font-mono mt-0.5">
                                          MRP: ₹{Math.round(med.mrp ?? 0)} | Stock: {(() => {
                                            const packSize = Number(med.pack_size || 1);
                                            const totalUnits = Number(med.quantity || 0) * packSize + Number(med.loose_quantity ?? med.loose_qty ?? 0);
                                            const cartUnits = cart.reduce((sum, c) => {
                                              const isSameMed = c.medicine_id === med.medicine_id || 
                                                (c.name || c.medicine_name || '').toLowerCase().trim() === (med.medicine_name || '').toLowerCase().trim();
                                              if (isSameMed && !c.isEmptyRow) {
                                                const cQty = c.qty ?? c.quantity ?? 0;
                                                const cLoose = c.looseQty ?? c.loose_qty ?? 0;
                                                return sum + (cQty * packSize) + cLoose;
                                              }
                                              return sum;
                                            }, 0);
                                            const remainingUnits = Math.max(0, totalUnits - cartUnits);
                                            const remainingPacks = Math.floor(remainingUnits / packSize);
                                            const remainingLoose = remainingUnits % packSize;
                                            const hasLoose = Number(med.loose_quantity ?? 0) > 0 || Number(med.loose_qty ?? 0) > 0 || remainingLoose > 0;
                                            return `${remainingPacks} Str${hasLoose ? ` / ${remainingLoose} Tab` : ''}`;
                                          })()}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Batch Selection */}
                        <td className="py-1 px-2.5 relative">
                          <div className="relative inline-block">
                            <button
                              id={`row-batch-input-${cart.indexOf(item)}`}
                              type="button"
                              disabled={item.isEmptyRow}
                              className={`w-28 text-center flex items-center justify-between gap-1 bg-bg/60 border border-border/60 hover:border-primary/50 focus:border-primary/80 focus:ring-1 focus:ring-primary/20 text-xs font-mono font-semibold py-1 px-2 h-7 rounded-lg transition-all ${item.isEmptyRow ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-bg3/50'}`}
                              onClick={() => {
                                if (item.isEmptyRow) return;
                                const rowKey = String(item.id);
                                if (activeBatchRowId === rowKey) {
                                  setActiveBatchRowId(null);
                                  return;
                                }
                                setActiveBatchRowId(rowKey);
                                
                                // First check compact cache for instant population
                                const compact = getCompactInventoryCache();
                                if (compact && compact.length > 0) {
                                  const localMatches = compact.filter(med => 
                                    (item.medicine_id && med.medicine_id === item.medicine_id) ||
                                    (med.name || '').toLowerCase().trim() === (item.name || '').toLowerCase().trim()
                                  );
                                  if (localMatches.length > 0) {
                                    setRowBatchesList(localMatches.map(m => ({
                                      inventory_id: m.inventory_id,
                                      medicine_id: m.medicine_id,
                                      medicine_name: m.name,
                                      batch_no: m.batch_no,
                                      expiry_date: m.expiry_date,
                                      mrp: m.mrp,
                                      cost_price: m.cost_price,
                                      quantity: m.quantity,
                                      loose_quantity: m.loose_quantity,
                                      pack_size: m.pack_size
                                    })));
                                  }
                                }
                                
                                api.searchMedicine(item.name || '')
                                  .then(data => {
                                    if (Array.isArray(data) && data.length > 0) {
                                      const matches = data.filter(med => (med.medicine_name || '').toLowerCase().trim() === (item.name || '').toLowerCase().trim());
                                      setRowBatchesList(matches.length > 0 ? matches : data);
                                    }
                                  })
                                  .catch(err => console.error('Error fetching batches:', err));
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  if (activeBatchRowId === String(item.id)) {
                                    setActiveBatchRowId(null);
                                  }
                                }, 250);
                              }}
                            >
                              <span className="truncate flex-1 text-center font-bold text-text">
                                {item.batch || (item.isEmptyRow ? '—' : 'Select')}
                              </span>
                              {!item.isEmptyRow && (
                                <svg className="w-3 h-3 text-muted shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                              )}
                            </button>
                            
                            {activeBatchRowId === String(item.id) && rowBatchesList.length > 0 && (
                              <div className="absolute left-0 z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto w-64 text-left shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                                <div className="p-2 border-b border-border/30 bg-bg3/60 text-[11px] font-bold text-muted uppercase tracking-wider flex items-center justify-between">
                                  <span>Switch Batch</span>
                                  <span className="text-[10px] font-normal text-muted/70">{rowBatchesList.length} available</span>
                                </div>
                                {rowBatchesList.map(b => {
                                  const otherCartQty = cart.reduce((sum, c) => {
                                    if (c.id === item.id) return sum; // exclude current row
                                    if (c.id === b.inventory_id || (c.medicine_id === b.medicine_id && c.batch === b.batch_no)) {
                                      return sum + (c.qty || 0);
                                    }
                                    return sum;
                                  }, 0);
                                  const liveStock = Math.max(0, (b.quantity !== undefined ? b.quantity : 0) - otherCartQty);
                                  const isCurrent = b.batch_no === item.batch;
                                  return (
                                    <button
                                      key={b.inventory_id || `${b.batch_no}-${b.expiry_date}`}
                                      type="button"
                                      onMouseDown={() => {
                                        updateCart(prev => prev.map((cItem): CartRow => {
                                          if (cItem.id !== item.id) return cItem;
                                          const newSellPrice = b.sell_price || cItem.sell_price || null;
                                          const newMrp = Number(b.mrp || cItem.mrp || 0);
                                          const numSellPrice = Number(newSellPrice || 0);
                                          const autoDiscount = (numSellPrice > 0 && newMrp > 0 && numSellPrice < newMrp)
                                            ? parseFloat((((newMrp - numSellPrice) / newMrp) * 100).toFixed(2))
                                            : cItem.discount;
                                          return {
                                            ...cItem,
                                            id: b.inventory_id ? String(b.inventory_id) : cItem.id,
                                            batch: b.batch_no,
                                            expiry: b.expiry_date,
                                            mrp: b.mrp,
                                            sell_price: newSellPrice,
                                            discount: autoDiscount,
                                            costPrice: b.cost_price,
                                            packSize: b.pack_size || cItem.packSize,
                                            availableStock: b.quantity !== undefined ? b.quantity : 0,
                                            availableLooseStock: b.loose_quantity !== undefined ? b.loose_quantity : 0
                                          };
                                        }));
                                        setActiveBatchRowId(null);
                                      }}
                                      className={`w-full text-left px-2.5 py-1.5 hover:bg-sky/15 border-b border-border/10 text-xs font-mono transition-all block ${isCurrent ? 'bg-sky/10 text-sky font-semibold' : 'text-text'}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold">{b.batch_no}</span>
                                        {isCurrent && <span className="text-[10px] text-sky font-sans">Active</span>}
                                      </div>
                                      <span className="text-muted block text-[11px] mt-0.5">Exp: {b.expiry_date || 'N/A'} | Stock: {liveStock} Str {b.loose_quantity !== undefined && b.loose_quantity > 0 ? `/ ${b.loose_quantity} Tab` : ''} | MRP: ₹{b.mrp}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                        
                        {/* Expiry */}
                        <td className="py-1 px-2.5 text-center">
                          <div className={`font-mono text-xs font-bold px-2 py-0.5 rounded-md inline-block shadow-sm ${expBadgeClass}`}>
                            {item.isEmptyRow ? '-' : item.expiry}
                          </div>
                        </td>

                        {/* Qty & Stock */}
                        {/* Strip Qty — own column */}
                        <td className="py-1 px-2.5 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-xs font-bold text-muted">-</div>;
                            }
                            return (
                              <div className="flex items-center justify-center">
                                <div className="flex items-center gap-1 bg-bg/40 border border-border/40 hover:border-border/80 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 rounded-lg px-2 py-0.5 h-7">
                                  <input 
                                    id={`row-qty-input-${cart.indexOf(item)}`}
                                    name={`row_qty_${cart.indexOf(item)}`}
                                    data-pos-row-index={cart.indexOf(item)}
                                    data-pos-field="qty"
                                    type="number"
                                    autoComplete="off" 
                                    className="w-10 text-center bg-transparent border-0 focus:ring-0 p-0 text-sm font-mono font-bold text-text focus:outline-none"
                                    value={item.qty !== undefined && item.qty !== null ? item.qty : ''}
                                    onChange={e => updateCartItem(item.id, 'qty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                                    min="0"
                                    placeholder="0"
                                    disabled={item.isEmptyRow}
                                    onKeyDown={e => {
                                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                        handlePosRowInputKeyDown(e, cart.indexOf(item), 'qty');
                                      } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if ((e.target as HTMLInputElement).value === '0' || (e.target as HTMLInputElement).value === '') {
                                          updateCartItem(item.id, 'qty', 0);
                                        }
                                        focusCartMedicineInput();
                                      } else if (e.key === 'Tab') {
                                        const curIdx = cart.indexOf(item);
                                        if (e.shiftKey) {
                                          e.preventDefault();
                                          if (curIdx > 0) {
                                            const prevLoose = document.getElementById(`row-loose-input-${curIdx - 1}`) as HTMLInputElement | null;
                                            if (prevLoose && !prevLoose.disabled) {
                                              prevLoose.focus();
                                              prevLoose.select?.();
                                             } else {
                                               const prevQty = document.getElementById(`row-qty-input-${curIdx - 1}`);
                                               if (prevQty) { prevQty.focus(); (prevQty as HTMLInputElement).select?.(); }
                                             }
                                           } else {
                                             const docEl = document.getElementById('doctor-name-input');
                                             if (docEl) { docEl.focus(); (docEl as HTMLInputElement).select?.(); }
                                           }
                                        } else {
                                          e.preventDefault();
                                          const looseInput = document.getElementById(`row-loose-input-${curIdx}`) as HTMLInputElement | null;
                                          if (looseInput && !looseInput.disabled) {
                                            looseInput.focus();
                                            looseInput.select?.();
                                          } else {
                                           const discIn = document.getElementById(`row-disc-input-${curIdx}`) as HTMLInputElement | null;
                                           if (discIn) {
                                             discIn.focus();
                                             discIn.select?.();
                                           } else {
                                             focusCartMedicineInput();
                                           }
                                          }
                                        }
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Loose Qty — own column */}
                        <td className="py-1 px-2.5 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-xs font-bold text-muted">-</div>;
                            }
                            const isLooseAllowed = item.allow_loose_sale === undefined || !!item.allow_loose_sale;
                            return (
                              <div className="flex items-center justify-center">
                                <div className={`flex items-center gap-0.5 border rounded-lg px-1.5 py-0.5 h-7 transition-all ${
                                  isLooseAllowed 
                                    ? 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20' 
                                    : 'bg-rose-500/5 border-rose-500/20 opacity-75'
                                }`}>
                                  <input 
                                    id={`row-loose-input-${cart.indexOf(item)}`}
                                    name={`row_loose_qty_${cart.indexOf(item)}`}
                                    data-pos-row-index={cart.indexOf(item)}
                                    data-pos-field="looseQty"
                                    type="number"
                                    autoComplete="off" 
                                    className={`w-9 text-center bg-transparent border-0 focus:ring-0 p-0 text-sm font-mono font-bold focus:outline-none ${
                                      isLooseAllowed ? 'text-amber-500' : 'text-muted cursor-not-allowed'
                                    }`}
                                    value={isLooseAllowed ? (item.looseQty !== undefined && item.looseQty !== null ? item.looseQty : '') : ''}
                                    onChange={e => {
                                      if (!isLooseAllowed) {
                                        toastEvent.trigger(`${item.name || 'Medicine'} is restricted to Full Pack Only. Click lock icon to enable loose sales.`, 'info');
                                        return;
                                      }
                                      updateCartItem(item.id, 'looseQty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)));
                                    }}
                                    min="0"
                                    placeholder={isLooseAllowed ? "0" : "N/A"}
                                    disabled={item.isEmptyRow || !isLooseAllowed}
                                    title={isLooseAllowed ? "Loose Tablets Qty" : "Restricted: Full Pack Only"}
                                    onKeyDown={e => {
                                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                        handlePosRowInputKeyDown(e, cart.indexOf(item), 'looseQty');
                                      } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        focusCartMedicineInput();
                                      } else if (e.key === 'Tab' && !e.shiftKey) {
                                        e.preventDefault();
                                        const curIdx = cart.indexOf(item);
                                        const discIn = document.getElementById(`row-disc-input-${curIdx}`) as HTMLInputElement | null;
                                        if (discIn) {
                                          discIn.focus();
                                          discIn.select?.();
                                        } else {
                                          focusCartMedicineInput();
                                        }
                                      } else if (e.key === 'Tab' && e.shiftKey) {
                                        e.preventDefault();
                                        const curIdx = cart.indexOf(item);
                                        const qtyIn = document.getElementById(`row-qty-input-${curIdx}`) as HTMLInputElement | null;
                                        if (qtyIn) { qtyIn.focus(); qtyIn.select?.(); }
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleAllowLooseSale(item);
                                    }}
                                    className="text-[11px] p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                                    title={isLooseAllowed ? "Loose sale allowed (Click to lock to Full Pack Only)" : "Full Pack Only (Click to allow loose tablet sales)"}
                                  >
                                    {isLooseAllowed ? '🔓' : '🔒'}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Live Stock — own column */}
                        <td className="py-1 px-2.5 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-xs font-bold text-muted">-</div>;
                            }
                            const compactInventory = getCompactInventoryCache();
                            const medicineBatches = compactInventory.filter(inv => inv.medicine_id === item.medicine_id);
                            
                            let remainingStock: number | string = 'N/A';
                            let remainingLoose = 0;
                            const packSize = item.packSize || 1;
                            
                            if (medicineBatches.length > 0) {
                              const totalAvailableStock = medicineBatches.reduce((sum, b) => sum + (b.stock_qty || 0), 0);
                              const totalAvailableLooseStock = medicineBatches.reduce((sum, b) => sum + (b.loose_quantity || 0), 0);
                              
                              const totalCartQty = cart.reduce((sum, c) => {
                                if (!c.isEmptyRow && c.medicine_id === item.medicine_id) {
                                  return sum + (c.qty ?? c.quantity ?? 0);
                                }
                                return sum;
                              }, 0);
                              const totalCartLoose = cart.reduce((sum, c) => {
                                if (!c.isEmptyRow && c.medicine_id === item.medicine_id) {
                                  return sum + (c.looseQty ?? c.loose_qty ?? 0);
                                }
                                return sum;
                              }, 0);

                              const totalUnits = (totalAvailableStock * packSize) + totalAvailableLooseStock;
                              const cartUnits = (totalCartQty * packSize) + totalCartLoose;
                              const remainingUnits = Math.max(0, totalUnits - cartUnits);

                              remainingStock = Math.floor(remainingUnits / packSize);
                              remainingLoose = remainingUnits % packSize;
                            } else if (item.availableStock !== undefined) {
                              const totalAvailableStock = item.availableStock;
                              const totalAvailableLooseStock = item.availableLooseStock || 0;

                              const totalUnits = (totalAvailableStock * packSize) + totalAvailableLooseStock;
                              const cartUnits = ((item.qty || 0) * packSize) + (item.looseQty || 0);
                              const remainingUnits = Math.max(0, totalUnits - cartUnits);

                              remainingStock = Math.floor(remainingUnits / packSize);
                              remainingLoose = remainingUnits % packSize;
                            }
                            const isFullStockInCart = typeof remainingStock === 'number' && remainingStock <= 0 && remainingLoose <= 0 && (medicineBatches.length > 0 || (item.availableStock || 0) > 0);
                            const isTrueOutOfStock = typeof remainingStock === 'number' && remainingStock <= 0 && remainingLoose <= 0 && medicineBatches.length === 0 && (item.availableStock || 0) === 0;

                            return (
                              <div 
                                title={
                                  isTrueOutOfStock
                                    ? 'Out of stock in pharmacy'
                                    : isFullStockInCart
                                    ? '100% of pharmacy stock allocated to this bill (0 remaining on shelf)'
                                    : `Remaining stock on shelf after this sale: ${remainingStock} strip(s), ${remainingLoose} loose`
                                }
                                className={`text-xs select-none font-bold font-mono px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${
                                  isTrueOutOfStock
                                    ? 'bg-red/5 border-red/20 text-red animate-pulse'
                                    : isFullStockInCart
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                                    : (typeof remainingStock === 'number' && remainingStock <= 10)
                                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-500'
                                    : 'bg-green/5 border-green/20 text-green'
                                }`}>
                                <span>{remainingStock} / {remainingLoose}</span>
                                {isFullStockInCart && (
                                  <span className="text-[10px] uppercase font-bold text-amber-400 ml-0.5" title="100% of pharmacy stock allocated to this bill">(All In Cart)</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Discount */}
                        <td className="py-1 px-2.5 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`relative flex items-center bg-bg/50 border rounded-lg px-1.5 py-0.5 h-7 transition-all ${
                              item.isEmptyRow 
                                ? 'opacity-40 border-border/30 cursor-not-allowed' 
                                : (item.discount && Number(item.discount) > 0)
                                ? 'border-sky-500/50 bg-sky-500/10 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/30'
                                : 'border-border/40 hover:border-border/80 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20'
                            }`}>
                              <input 
                                id={`row-disc-input-${cart.indexOf(item)}`}
                                name={`row_disc_${cart.indexOf(item)}`}
                                data-pos-row-index={cart.indexOf(item)}
                                data-pos-field="discount"
                                type="number" 
                                step="0.5"
                                autoComplete="off"
                                className={`w-12 text-center bg-transparent border-0 focus:ring-0 p-0 text-xs font-mono font-bold focus:outline-none ${
                                  (item.discount && Number(item.discount) > 0) ? 'text-sky-400' : 'text-text'
                                } ${item.isEmptyRow ? 'cursor-not-allowed' : ''}`}
                                value={item.isEmptyRow ? '' : (item.discount === 0 || item.discount === undefined || item.discount === null ? '' : item.discount)}
                                placeholder="0%"
                                onChange={e => updateCartItem(item.id, 'discount', e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                                min="0"
                                max="100"
                                disabled={item.isEmptyRow}
                                title="Item Discount Percentage (%) — modify manually"
                                onKeyDown={e => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    handlePosRowInputKeyDown(e, cart.indexOf(item), 'discount');
                                  } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    focusCartMedicineInput();
                                  } else if (e.key === 'Tab') {
                                    const curIdx = cart.indexOf(item);
                                    if (e.shiftKey) {
                                      e.preventDefault();
                                      const looseIn = document.getElementById(`row-loose-input-${curIdx}`) as HTMLInputElement | null;
                                      if (looseIn && !looseIn.disabled) {
                                        looseIn.focus();
                                        looseIn.select?.();
                                      } else {
                                        const qtyIn = document.getElementById(`row-qty-input-${curIdx}`) as HTMLInputElement | null;
                                        if (qtyIn) { qtyIn.focus(); qtyIn.select?.(); }
                                      }
                                    } else {
                                      e.preventDefault();
                                      const rateIn = document.getElementById(`row-rate-input-${curIdx}`) as HTMLInputElement | null;
                                      if (rateIn) {
                                        rateIn.focus();
                                        rateIn.select?.();
                                      } else {
                                        focusCartMedicineInput();
                                      }
                                    }
                                  }
                                }}
                              />
                              {!item.isEmptyRow && (
                                <span className="text-[10px] text-muted font-bold ml-0.5 select-none">%</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Rate / Sale Price */}
                        <td className="py-1 px-2.5 text-right">
                          <input 
                            id={`row-rate-input-${cart.indexOf(item)}`}
                            name={`row_rate_${cart.indexOf(item)}`}
                            data-pos-row-index={cart.indexOf(item)}
                            data-pos-field="unitPrice"
                            type="number"
                            autoComplete="off" 
                            className={`w-16 text-right font-mono bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs py-0.5 px-1 h-7 rounded-lg font-bold text-emerald-400 ${item.isEmptyRow ? 'opacity-40 cursor-not-allowed' : ''}`} 
                            value={item.isEmptyRow ? '' : (item.unitPrice !== undefined && item.unitPrice !== null ? item.unitPrice : (item.sell_price !== undefined && item.sell_price !== null ? item.sell_price : (item.mrp || '')))}
                            placeholder="0.00"
                            onChange={e => {
                              const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value));
                              updateCartItem(item.id, 'unitPrice', val);
                              updateCartItem(item.id, 'sell_price', val);
                            }}
                            disabled={item.isEmptyRow}
                            onKeyDown={e => {
                              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                handlePosRowInputKeyDown(e, cart.indexOf(item), 'unitPrice');
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                focusCartMedicineInput();
                              } else if (e.key === 'Tab') {
                                const curIdx = cart.indexOf(item);
                                if (e.shiftKey) {
                                  e.preventDefault();
                                  const discIn = document.getElementById(`row-disc-input-${curIdx}`) as HTMLInputElement | null;
                                  if (discIn) {
                                    discIn.focus();
                                    discIn.select?.();
                                  }
                                } else {
                                  e.preventDefault();
                                  const mrpIn = document.getElementById(`row-mrp-input-${curIdx}`) as HTMLInputElement | null;
                                  if (mrpIn) {
                                    mrpIn.focus();
                                    mrpIn.select?.();
                                  } else {
                                    focusCartMedicineInput();
                                  }
                                }
                              }
                            }}
                            title="Set Sale Price (Rate per Strip)"
                          />
                        </td>

                        {/* MRP */}
                        <td className="py-1 px-2.5 text-right">
                          <input 
                            id={`row-mrp-input-${cart.indexOf(item)}`}
                            name={`row_mrp_${cart.indexOf(item)}`}
                            data-pos-row-index={cart.indexOf(item)}
                            data-pos-field="mrp"
                            type="number"
                            autoComplete="off" 
                            className={`w-16 text-right font-mono bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs py-0.5 px-1 h-7 rounded-lg ${item.isEmptyRow ? 'opacity-40 cursor-not-allowed' : ''}`} 
                            value={item.isEmptyRow ? '' : (item.mrp || '')}
                            placeholder="0.00"
                            onChange={e => updateCartItem(item.id, 'mrp', Math.max(0, Number(e.target.value)))}
                            disabled={item.isEmptyRow}
                            onKeyDown={e => {
                              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                handlePosRowInputKeyDown(e, cart.indexOf(item), 'mrp');
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                focusCartMedicineInput();
                              } else if (e.key === 'Tab') {
                                const curIdx = cart.indexOf(item);
                                if (e.shiftKey) {
                                  e.preventDefault();
                                  const rateIn = document.getElementById(`row-rate-input-${curIdx}`) as HTMLInputElement | null;
                                  if (rateIn) {
                                    rateIn.focus();
                                    rateIn.select?.();
                                  }
                                } else {
                                  e.preventDefault();
                                  focusCartMedicineInput();
                                }
                              }
                            }}
                          />
                        </td>

                        {/* Total */}
                        <td className="py-1 px-2.5 text-right">
                          <div className="font-mono text-xs font-bold text-green pr-1">
                            {item.isEmptyRow ? '-' : `₹${Math.round(itemTotal)}`}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-1 px-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.medicine_id) setEditMedicineId(Number(item.medicine_id));
                              }}
                              disabled={!item.medicine_id}
                              className={`p-1 rounded-md transition-all ${item.medicine_id ? 'hover:bg-sky/10 text-muted hover:text-sky' : 'opacity-30 cursor-not-allowed text-muted'}`}
                              title="Quick Edit Medicine"
                            >
                              <Edit size={14} />
                            </button>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="p-1 hover:bg-red/10 text-muted hover:text-red rounded-md transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          
        </div>

        {/* ── BOTTOM CHECKOUT BAR (full width horizontal strip) ── */}
        <div className="shrink-0 w-full flex flex-row items-center gap-2 px-3 py-1.5 bg-bg2/95 border-t border-glass-border/50 shadow-[0_-4px_16px_rgba(0,0,0,0.14)] overflow-x-auto">

          {/* Section 1: Customer (single line) */}
          <div className="flex items-center gap-1.5 min-w-[130px] border-r border-glass-border/30 pr-2.5 shrink-0">
            <UserCheck size={12} className="text-primary shrink-0" />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-bold text-text truncate max-w-[110px]">{patientName || 'Walk-in'}</span>
              <span className="text-[9px] text-muted font-mono truncate">
                {patientPhone || '—'}
                {patientPhone && <span className="ml-1 text-green font-bold">· WA</span>}
                {selectedCustomerId && <span className="ml-1 text-primary font-bold">· Reg</span>}
              </span>
            </div>
          </div>

          {/* Section 2: Bill Breakdown (single line) */}
          <div className="flex items-center gap-2 min-w-[200px] border-r border-glass-border/30 pr-2.5 shrink-0">
            <FileText size={11} className="text-muted shrink-0" />
            <span className="text-[9px] text-muted">Sub:</span>
            <span className="font-mono font-bold text-text text-[10px]">₹{Math.round(subtotal)}</span>
            <span className="text-[9px] text-muted ml-1">Disc%</span>
            <input
              id="pos-bill-discount-input"
              name="pos_bill_discount"
              type="number"
              autoComplete="off"
              value={discount === 0 || discount === undefined || discount === null ? '' : discount}
              onChange={e => setDiscount(e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
              placeholder="0"
              className="w-10 bg-bg border border-glass-border rounded px-1 py-0 font-mono font-bold text-center text-text text-[10px] focus:outline-none focus:border-primary/50 h-5"
            />
            {discountAmount > 0 && (
              <span className="font-mono font-bold text-amber-500 text-[10px]">-₹{Math.round(discountAmount)}</span>
            )}
          </div>

          {/* Section 3: Payment Method (single row) */}
          <div className="flex items-center gap-1 border-r border-glass-border/30 pr-2.5 shrink-0">
            {[
              { id: 'CASH', label: '💵 Cash', activeClass: 'bg-green/15 text-green border-green/40' },
              { id: 'UPI', label: '📱 UPI', activeClass: 'bg-primary/15 text-primary border-primary/40' },
              { id: 'CREDIT', label: '📜 Credit', activeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/40' }
            ].map(pm => (
              <button
                key={pm.id}
                type="button"
                onClick={() => setPaymentMedium(pm.id)}
                className={`py-0.5 px-1.5 rounded text-[9px] font-extrabold uppercase border text-center transition-all cursor-pointer ${
                  paymentMedium === pm.id
                    ? `${pm.activeClass} ring-1 ring-primary/20`
                    : 'bg-bg3/40 border-glass-border/30 text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                {pm.label}
              </button>
            ))}
          </div>

          {/* Section 4: Net Payable (compact) */}
          <div className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-primary/5 border border-primary/20 shrink-0">
            <span className="text-[9px] font-black text-primary uppercase tracking-widest">Total</span>
            <span className="text-lg font-black font-mono text-primary leading-none">₹{grandTotal.toLocaleString()}</span>
          </div>

          {/* Section 5: Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              onClick={() => handleCompleteSale(undefined, true)}
              disabled={cart.length === 0}
              className={`py-1 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer border ${
                cart.length === 0
                  ? 'bg-bg3 border-glass-border text-muted cursor-not-allowed'
                  : 'bg-sky/15 border-sky/30 text-sky hover:bg-sky/25'
              }`}
            >
              <Zap size={12} /> Direct Save
            </button>
            <button
              onClick={() => handleCompleteSale(undefined, false)}
              disabled={cart.length === 0}
              className={`py-1.5 px-4 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
                cart.length === 0
                  ? 'bg-bg3 border border-glass-border text-muted cursor-not-allowed'
                  : 'bg-green text-white hover:bg-emerald-600 shadow-[0_0_14px_rgba(16,185,129,0.3)] hover:-translate-y-px'
              }`}
            >
              <CheckCircle size={13} />
              Save & Print (Ctrl+S)
            </button>
          </div>
        </div>
      </div>

      {showCamera && (
        <AICamera 
          onClose={() => setShowCamera(false)} 
          onScanResult={handleScanResult} 
        />
      )}

      {zoomedImage && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-global-modal flex items-center justify-center p-4 cursor-pointer animate-in fade-in duration-200"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-3xl max-h-[85vh] bg-bg2 border border-border rounded-2xl overflow-hidden p-2 shadow-2xl animate-in zoom-in-95 duration-200">
            <img src={zoomedImage} alt="Zoomed medicine scan" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <button 
              className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-text rounded-full p-2 transition-all"
              onClick={() => setZoomedImage(null)}
              aria-label="Close zoomed image"
            >
              <X size={20} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Credit Phone Number Requirement Prompt Modal */}
      {showPhonePromptModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-modal p-4 animate-fade-in">
          <div className="glass-panel max-w-md w-full p-6 space-y-4 border-border bg-bg2/95 rounded-2xl relative shadow-2xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-base text-text">
                <Send size={18} className="text-primary" />
                WhatsApp Number Required for Credit Bill
              </h3>
              <button 
                onClick={() => setShowPhonePromptModal(false)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              To save this credit transaction and automatically send the instant WhatsApp credit PDF bill, please enter the mobile number for <strong className="text-text">{patientName || 'Customer'}</strong>:
            </p>
            <div className="space-y-1.5">
              <PhoneInputWithBadge
                label="WhatsApp Phone Number"
                value={promptPhoneValue}
                onChange={val => setPromptPhoneValue(val)}
                placeholder="Enter 10-digit phone number (e.g. 9876543210)"
                required={true}
                allowEmpty={false}
                shakeOnError={shakePromptPhone}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowPhonePromptModal(false)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = sanitizePhoneInput(promptPhoneValue);
                  if (!isValid10DigitPhone(val)) {
                    setShakePromptPhone(true);
                    setTimeout(() => setShakePromptPhone(false), 400);
                    toastEvent.trigger('Please enter a valid 10-digit phone number', 'error');
                    return;
                  }
                  setPatientPhone(val);
                  setShowPhonePromptModal(false);
                  handleCompleteSale(val, pendingDirectSaveRef.current);
                }}
                className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <Send size={14} />
                Save &amp; Send Credit Bill
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Patient Profile & Auto-Refills Modal */}
      {showPatientModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-modal p-4 animate-fade-in">
          <div className="glass-panel max-w-md w-full p-6 space-y-5 border-border bg-bg2/95 rounded-2xl relative shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-lg text-text">
                <UserCheck size={20} className="text-primary" />
                Manage Patient & Refills
              </h3>
              <button 
                onClick={() => setShowPatientModal(false)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4">
              {/* Patient ID */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider">Patient Card ID</span>
                <input 
                  id="modal-patient-id"
                  name="modal_patient_card_id"
                  type="text" 
                  autoComplete="off"
                  className="premium-input w-full text-xs font-mono py-2 px-3 bg-bg3/40 cursor-not-allowed rounded-xl" 
                  value={patientId}
                  disabled
                  title="Auto-generated unique card ID"
                />
              </div>

              {/* Patient Name */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider">Full Name</span>
                <input 
                  id="modal-patient-name"
                  name="modal_patient_name"
                  type="text" 
                  autoComplete="off"
                  className="premium-input w-full text-sm py-2 px-3 bg-bg2/50 border-border/80 rounded-xl" 
                  placeholder="Enter full name" 
                  value={patientName}
                  onChange={e => updatePatientName(e.target.value)}
                />
              </div>

              {/* WhatsApp / Phone */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Phone size={12} className="text-green" /> WhatsApp / Contact Number
                </span>
                <input 
                  id="modal-patient-phone"
                  name="modal_patient_phone"
                  type="text" 
                  autoComplete="off"
                  className="premium-input w-full text-sm font-mono py-2 px-3 bg-bg2/50 border-border/80 rounded-xl" 
                  placeholder="e.g. 9130558910" 
                  value={patientPhone}
                  onChange={e => setPatientPhone(sanitizePhoneInput(e.target.value))}
                  maxLength={10}
                />
              </div>

              {/* Auto-Refill Manager Section */}
              <div className="border border-border rounded-2xl p-4 bg-bg3/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                      🔄 Auto-Refill Reminders
                    </span>
                    <p className="text-[10px] text-muted">Generate recurring WhatsApp stock notifications</p>
                  </div>
                  <label htmlFor="modal-refill-enabled" className="relative inline-flex items-center cursor-pointer" aria-label="Toggle Refill">
                    <input 
                      id="modal-refill-enabled"
                      name="modal_refill_enabled"
                      type="checkbox" 
                      className="sr-only peer"
                      checked={refillEnabled}
                      onChange={e => setRefillEnabled(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-text"></div>
                  </label>
                </div>

                {refillEnabled && (
                  <div className="space-y-3 pt-2 border-t border-border/40 animate-fade-in">
                    <div className="space-y-1.5">
                      <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                        <Calendar size={12} /> Refill Interval (Days)
                      </span>
                      <div className="flex gap-2">
                        <input 
                          id="modal-refill-days"
                          name="modal_refill_days"
                          type="number" 
                          autoComplete="off"
                          className="premium-input text-sm font-mono py-1.5 px-3 w-20 text-center bg-bg border-border rounded-xl" 
                          value={refillDays}
                          onChange={e => setRefillDays(Math.min(100, Math.max(1, Number(e.target.value))))}
                          min="1"
                          max="100"
                        />
                        <div className="flex gap-1 flex-1">
                          {[30, 60, 90].map(days => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setRefillDays(days)}
                              className={`text-xs py-1 px-2.5 rounded-xl border font-mono transition-all flex-1 ${refillDays === days ? 'bg-primary/20 border-primary text-primary' : 'bg-bg2 border-border text-muted hover:text-text'}`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interactive 1-100 Days Slider */}
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[10px] text-muted font-semibold">
                          <span>1 day</span>
                          <span className="text-primary font-bold">{refillDays} days</span>
                          <span>100 days</span>
                        </div>
                        <input
                          id="modal-refill-days-range"
                          name="modal_refill_days_range"
                          type="range"
                          min="1"
                          max="100"
                          value={refillDays}
                          onChange={e => setRefillDays(Number(e.target.value))}
                          className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-2 border-t border-border flex justify-end gap-3">
              <button 
                onClick={() => setShowPatientModal(false)}
                className="premium-btn bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 py-2 px-4 text-xs font-bold uppercase tracking-wider rounded-xl"
              >
                Cancel
              </button>
              <button 
                onClick={handleSavePatientProfile}
                className="premium-btn bg-primary text-white hover:bg-teal-500 py-2 px-5 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md"
              >
                Save Profile (Ctrl+S)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Doctor Registration / Edit Modal */}
      {showDoctorModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-border bg-bg3/30 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2 text-sky text-sm">
                {editingDoctorId ? <Edit size={18} className="text-amber-400" /> : <Plus size={18} />}
                {editingDoctorId ? 'Edit Doctor Profile' : 'Register New Doctor'}
              </h3>
              <button onClick={() => setShowDoctorModal(false)} className="text-muted hover:text-text transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="modal-doctor-name" className="text-xs font-bold text-muted uppercase tracking-wider">Doctor Name *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-semibold">Dr.</span>
                  <input
                    id="modal-doctor-name"
                    name="modal_doctor_name"
                    type="text"
                    autoComplete="off"
                    className="premium-input w-full pl-9 rounded-xl bg-bg2/40 border-border"
                    placeholder="John Doe"
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label htmlFor="modal-doctor-specialty" className="text-xs font-bold text-muted uppercase tracking-wider">Specialization</label>
                <input
                  id="modal-doctor-specialty"
                  name="modal_doctor_specialty"
                  type="text"
                  autoComplete="off"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="e.g. Cardiologist"
                  value={newDoctorSpecialty}
                  onChange={(e) => setNewDoctorSpecialty(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="modal-doctor-phone" className="text-xs font-bold text-muted uppercase tracking-wider">Phone</label>
                <input
                  id="modal-doctor-phone"
                  name="modal_doctor_phone"
                  type="text"
                  autoComplete="off"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border font-mono"
                  placeholder="10-digit Phone Number"
                  value={newDoctorPhone}
                  onChange={(e) => setNewDoctorPhone(sanitizePhoneInput(e.target.value))}
                  maxLength={10}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="modal-doctor-clinic" className="text-xs font-bold text-muted uppercase tracking-wider">Clinic Name</label>
                <input
                  id="modal-doctor-clinic"
                  name="modal_doctor_clinic"
                  type="text"
                  autoComplete="off"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="Clinic / Hospital Name"
                  value={newDoctorClinic}
                  onChange={(e) => setNewDoctorClinic(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="modal-doctor-reg-no" className="text-xs font-bold text-muted uppercase tracking-wider">Registration No.</label>
                <input
                  id="modal-doctor-reg-no"
                  name="modal_doctor_reg_no"
                  type="text"
                  autoComplete="off"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="e.g. MMC-12345"
                  value={newDoctorRegNo}
                  onChange={(e) => setNewDoctorRegNo(e.target.value)}
                />
              </div>
            </div>
            
            <div className="px-5 py-4 border-t border-border bg-bg3/30 flex justify-end gap-3">
              <button 
                onClick={() => setShowDoctorModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-text hover:bg-bg2 transition-all border border-transparent"
              >
                Cancel
              </button>
              <button 
                onClick={handleRegisterDoctor}
                disabled={!newDoctorName}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-sky text-white hover:bg-sky/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(14,165,233,0.2)]"
              >
                <CheckCircle size={16} /> Save Doctor
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden printable bill container for window.print() */}
      {showBarcodeModal && createPortal(
        <div id="printable-bill" data-print-root className="hidden">
          <div style={{ textAlign: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#000' }}>AI PHARMACY OS</h2>
            <p style={{ fontSize: '12px', color: '#555', margin: '0' }}>Tax Invoice / Retail Counter Receipt</p>
            <div style={{ borderBottom: '1px solid #ddd', margin: '10px 0' }}></div>
          </div>
          <div style={{ fontSize: '12px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', color: '#000' }}>
            <div>
              <p style={{ margin: '2px 0' }}><strong>Invoice No:</strong> #{lastSavedInvoiceNo}</p>
              <p style={{ margin: '2px 0' }}><strong>Customer:</strong> {lastSavedPatientName}</p>
              {lastSavedPatientPhone && <p style={{ margin: '2px 0' }}><strong>Phone:</strong> {lastSavedPatientPhone}</p>}
              {lastSavedDoctorName && <p style={{ margin: '2px 0' }}><strong>Doctor:</strong> {lastSavedDoctorName}</p>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '2px 0' }}><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
              <p style={{ margin: '2px 0' }}><strong>Payment:</strong> {lastSavedPaymentMedium}</p>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '15px', color: '#000' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #000', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '6px 2px' }}>Item Name</th>
                <th style={{ textAlign: 'left', padding: '6px 2px' }}>Batch</th>
                <th style={{ textAlign: 'center', padding: '6px 2px' }}>Qty</th>
                <th style={{ textAlign: 'center', padding: '6px 2px' }}>Loose</th>
                {lastSavedItems.some(item => Number(item.discountPer || 0) > 0) && (
                  <th style={{ textAlign: 'center', padding: '6px 2px' }}>Disc%</th>
                )}
                <th style={{ textAlign: 'right', padding: '6px 2px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lastSavedItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #ccc' }}>
                  <td style={{ padding: '6px 2px' }}>{item.name}</td>
                  <td style={{ padding: '6px 2px' }}>{item.batch}</td>
                  <td style={{ padding: '6px 2px', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '6px 2px', textAlign: 'center' }}>{item.looseQty || 0}</td>
                  {lastSavedItems.some(it => Number(it.discountPer || 0) > 0) && (
                    <td style={{ padding: '6px 2px', textAlign: 'center' }}>{Number(item.discountPer || 0) > 0 ? `${item.discountPer}%` : '-'}</td>
                  )}
                  <td style={{ padding: '6px 2px', textAlign: 'right', fontWeight: 600 }}>₹{Number(item.amount || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ borderTop: '2px solid #000', paddingTop: '8px', textAlign: 'right', fontSize: '12px', color: '#000' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '260px', marginLeft: 'auto' }}>
              <span>Subtotal:</span><span>₹{lastSavedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)}</span>
            </div>
            {lastSavedBillDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '260px', marginLeft: 'auto' }}>
                <span>Discount:</span><span>-₹{Number(lastSavedBillDiscount).toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '260px', marginLeft: 'auto', fontWeight: 'bold', fontSize: '14px', marginTop: '4px', borderTop: '1px solid #000', paddingTop: '4px' }}>
              <span>Grand Total:</span><span>₹{Number(lastSavedGrandTotal).toFixed(2)}</span>
            </div>
          </div>
          {lastSavedPaymentMedium === 'CREDIT' && lastSavedCreditDues && lastSavedCreditDues.length > 0 && (
            <div style={{ marginTop: '14px', border: '1px solid #000', padding: '8px 10px', fontSize: '11px', color: '#000' }}>
              <div style={{ fontWeight: 'bold', textTransform: 'uppercase', borderBottom: '1px solid #999', paddingBottom: '3px', marginBottom: '5px' }}>Credit Invoices Due - {lastSavedPatientName}</div>
              {lastSavedCreditDues.map((due, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span>#{due.invoice_no}</span><span>₹{Number(due.total_amount).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', borderTop: '1px solid #000', marginTop: '4px', paddingTop: '3px', fontSize: '13px' }}>
                <span>Total Credit Balance:</span><span>₹{Number(lastSavedCreditBalance).toFixed(2)}</span>
              </div>
            </div>
          )}
          {lastSavedPaymentMedium === 'CREDIT' && lastSavedNextRefillDue && (
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#000', background: '#f3f4f6', border: '1px dashed #666', padding: '6px 10px' }}>
              Next Refill Due: {new Date(lastSavedNextRefillDue).toLocaleDateString('en-IN')}
            </div>
          )}
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '11px', color: '#777' }}>
            Thank you for your visit! &middot; Get Well Soon
          </div>
        </div>,
        document.body
      )}

      {/* Post-Sale Saved Bill Confirmation Modal */}
      {showBarcodeModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md fade-in">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-green/10 border border-green/20 text-green mb-1">
                <CheckCircle size={32} className="animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-text">Sale Saved Successfully!</h3>
              <p className="text-xs text-muted">Invoice No: <span className="font-mono text-sky font-semibold">#{lastSavedInvoiceNo}</span></p>
            </div>

            <div className="bg-bg2/60 border border-border/40 p-4 rounded-xl space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted font-medium">Customer:</span>
                <span className="font-bold text-text">{lastSavedPatientName}</span>
              </div>
              {lastSavedPatientPhone && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted font-medium">Contact Phone:</span>
                  <span className="font-mono text-text font-semibold">{lastSavedPatientPhone}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-xs pt-2 border-t border-border/40">
                <span className="text-muted font-medium">Total Amount:</span>
                <span className="font-mono font-black text-primary text-sm">₹{lastSavedGrandTotal}</span>
              </div>
            </div>

            {/* SMS Status / Manual Dispatch option */}
            <div className="p-3.5 rounded-xl border text-xs flex items-center gap-3 bg-bg3/50 border-border/50">
              <MessageSquare size={18} className={lastSavedWasWhatsAppSent ? "text-green shrink-0" : "text-muted shrink-0"} />
              <div className="flex-1 min-w-0">
                {lastSavedPaymentMedium === 'CREDIT' ? (
                  <p className="font-semibold text-amber-500 text-[11px] leading-tight">
                    ⚡ Credit Sale: Instant SMS/WhatsApp message sent automatically
                  </p>
                ) : lastSavedWasWhatsAppSent ? (
                  <p className="font-semibold text-green text-[11px] leading-tight">
                    ✅ SMS/WhatsApp message sent to customer
                  </p>
                ) : lastSavedPatientPhone ? (
                  <p className="text-muted text-[11px] leading-tight">
                    SMS message not sent (WA toggle was OFF).
                  </p>
                ) : (
                  <p className="text-muted text-[11px] italic leading-tight">
                    No phone number saved for this sale.
                  </p>
                )}
              </div>
              {!lastSavedWasWhatsAppSent && lastSavedPatientPhone && lastSavedInvoiceNo && (
                <button
                  onClick={async () => {
                    try {
                      const res = await api.sendWhatsappMessage(
                        lastSavedPatientPhone,
                        `Dear ${lastSavedPatientName},\n\n📄 *Sale Invoice: #${lastSavedInvoiceNo}*\nAmount Paid: ₹${lastSavedGrandTotal}\nThank you for your purchase!\n— AI Pharmacy OS`
                      );
                      if (res && res.success !== false) {
                        setLastSavedWasWhatsAppSent(true);
                        alert('SMS/WhatsApp message sent successfully!');
                      } else {
                        alert('Failed to send SMS message.');
                      }
                    } catch (err) {
                      console.error(err);
                      alert('Error sending SMS message');
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold uppercase bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all shrink-0"
                >
                  Send SMS
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() => printCurrentBill(`Invoice-${lastSavedInvoiceNo}-${lastSavedPatientName || 'Walk-in'}`)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_12px_rgba(59,130,246,0.2)] flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Print Bill
              </button>

              <button
                onClick={() => {
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={14} /> Done / Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {editMedicineId && (
        <Suspense fallback={<ModalSkeleton />}>
          <UniversalMedicineEditModal 
            medicineId={editMedicineId} 
            initialData={cart.find(i => i.medicine_id === editMedicineId || i.id === editMedicineId) as React.ComponentProps<typeof UniversalMedicineEditModal>['initialData']}
            onClose={() => setEditMedicineId(null)} 
            onSave={async () => {
              const currentMedId = editMedicineId;
              if (!currentMedId) return;
              try {
                const details = await api.getMedicineQuickDetails(currentMedId);
                const newPackSize = parsePackSizeFromPackaging(details.packaging) || details.pack_size || 1;
                
                updateCart(prevCart => {
                  const updatedCart = prevCart.map(item => {
                    if (!item.isEmptyRow && item.medicine_id === currentMedId) {
                      return {
                        ...item,
                        name: details.name,
                        packSize: newPackSize,
                        mrp: details.mrp || item.mrp,
                        salts: details.api_reference || details.hsn_code || item.salts,
                      };
                    }
                    return item;
                  });

                  const targetItem = updatedCart.find(item => !item.isEmptyRow && item.medicine_id === currentMedId);
                  if (targetItem) {
                    return rebalanceCartMedicine(updatedCart, currentMedId, targetItem.id, {});
                  }
                  return updatedCart;
                });
              } catch (err) {
                console.error('Failed to update cart items after quick edit save:', err);
              }
            }}
            onDelete={(deletedId) => {
              updateCart(prevCart => prevCart.filter(item => item.medicine_id !== deletedId));
              setEditMedicineId(null);
            }}
          />
        </Suspense>
      )}

      {/* Floating Staged Order Queue Widget */}
      <StagedQueueFloatingWidget onLoadIntoPOS={handleLoadStagedItemIntoPOS} />

    </div>
  );
};

export default POS;
