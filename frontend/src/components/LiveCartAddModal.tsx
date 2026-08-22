import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Plus, Minus, Sparkles, Loader2, ShoppingCart, RefreshCw, AlertCircle, EyeOff, Ban, Package, CheckCircle2, RotateCcw } from 'lucide-react';
import { api, type SpecialOrder, type Refill } from '../services/api';
import { toastEvent } from '../services/events';

import { findBestCartMatchForOrder } from '../utils/orderFuzzyMatcher';

interface SuggestionMedicine {
  medicine_name: string;
  shortName?: string;
  fullName?: string;
  isPharmarack?: boolean;
  distributor?: string;
  rate?: number | null;
  mapped?: boolean;
  packaging?: string;
  stock?: string;
  isErrorMessage?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  mrp?: number | null;
}

type LocalApiError = { response?: { data?: { error?: string; details?: string } }; message?: string };

type LocalPrSearchFallback = { isError: boolean; message: string };
type LocalPrSearchOutcome = LocalPharmarackSearchItem[] | LocalPrSearchFallback;

interface LocalPharmarackSearchItem {
  name: string;
  shortName?: string;
  fullName?: string;
  packaging?: string;
  distributor?: string;
  rate?: number | null;
  mrp?: number | null;
  mapped?: boolean;
  stock?: string;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
}

interface LocalReconOrder {
  id?: number | string;
  email_uid?: string;
  uid?: string;
  medicine_names?: string[];
  subject?: string;
  status?: string;
  extracted_distributor?: string | null;
  is_saved?: number | boolean;
}

interface LocalAutoRefillItem {
  medicine_id: number;
  medicine_name: string;
  manufacturer: string;
  packaging: string;
  current_stock: number;
  sales_30d: number;
  reorder_level: number;
  recommended_qty: number;
}

interface LocalRefillPatient {
  patient_name: string;
  patient_phone: string;
  next_refill_date: string;
  medicines?: Array<{
    id: number;
    medicine_id?: number;
    medicine_name?: string;
    status?: string;
    is_active?: number;
    quantity_needed?: number | string;
    in_stock_qty?: number | string;
    refill_interval_days?: number;
    hold_for_stock?: number;
    reminder_status?: Refill['reminder_status'];
    reminder_sent_at?: string | null;
  }>;
}

// Distributor style — colored left border only, neutral background
const DISTRIBUTOR_BORDER_COLORS = [
  'border-l-blue-500',
  'border-l-purple-500',
  'border-l-emerald-500',
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-cyan-500',
  'border-l-indigo-500',
  'border-l-teal-500',
  'border-l-violet-500',
  'border-l-orange-500',
];

const getDistributorColor = (name: string | undefined): string => {
  if (!name) return 'border-l-primary';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % DISTRIBUTOR_BORDER_COLORS.length;
  return DISTRIBUTOR_BORDER_COLORS[index];
};

// Filter out emails, DL numbers, phone numbers, and GSTINs from being parsed as distributor names
const isValidDistributorName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length < 2) return false;

  // 0. Filter out placeholder / fallback distributor names
  const lower = trimmed.toLowerCase();
  if (
    lower === 'default distributor' ||
    lower === 'unknown distributor' ||
    lower === 'unknown dist.' ||
    lower === 'unknown supplier' ||
    lower === 'email import' ||
    lower === 'telegram import' ||
    lower === 'ocr import' ||
    lower === 'whatsapp import' ||
    lower === 'csv import' ||
    lower === 'excel import' ||
    lower === 'mobile import' ||
    lower === 'import' ||
    lower === 'unassigned' ||
    lower === 'default' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'n/a' ||
    lower === 'na' ||
    /^(email|telegram|ocr|whatsapp|csv|excel|mobile)?\s*import$/i.test(trimmed)
  ) {
    return false;
  }

  // 1. Filter out emails (e.g. ctinvoice@gmail.com)
  if (trimmed.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return false;
  }

  // 2. Filter out Drug License labels & numbers (e.g. DL, DL NO, DL-12345, DRUG LIC NO)
  if (/^(DL|DL\s*NO|DL\s*NUMBER|DL\s*NUM|DRUG\s*LIC|DRUG\s*LICENSE)\b/i.test(trimmed) || /^DL\s*[-/:]?\s*\d+/i.test(trimmed)) {
    return false;
  }
  if (/^DL\b/i.test(trimmed) && trimmed.length <= 5) {
    return false;
  }

  // 3. Filter out pure phone numbers (e.g. +919876543210, 9876543210)
  const numericOnly = trimmed.replace(/\D/g, '');
  if (numericOnly.length >= 10 && numericOnly.length <= 13 && trimmed.replace(/[\d\s+\-()]/g, '').length === 0) {
    return false;
  }

  // 4. Filter out GSTIN numbers (e.g. 27AAAAA0000A1Z5)
  if (/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/i.test(trimmed)) {
    return false;
  }

  // 5. Filter out raw date formats or invoice prefixes
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(trimmed) || /^INV[-/]?\d+$/i.test(trimmed)) {
    return false;
  }

  return true;
};

interface CartLineItem {
  productId: number | null;
  storeId: number;
  productCode: string;
  productName: string;
  company: string;
  packaging: string;
  qty: number;
  ptr: number;
  mrp: number;
  scheme: string;
  stock: number | null;
  amount: number;
  cartSource: string;
  isChecked: boolean;
  createdDate: string;
}

interface Distributor {
  storeId: number;
  storeName: string;
  lineTotal: number;
  deliveryPersons: { name: string; code: string }[];
  items: CartLineItem[];
}

interface SchemeInfo {
  buy: number;
  free: number;
}

const parseScheme = (schemeStr: string | undefined): SchemeInfo | null => {
  if (!schemeStr) return null;
  const match = schemeStr.match(/^(\d+)\+(\d+)$/);
  if (match) {
    return {
      buy: parseInt(match[1]),
      free: parseInt(match[2])
    };
  }
  return null;
};

const getEffectiveRate = (rate: number, schemeStr: string | undefined, qty: number): number => {
  if (!rate) return 0;
  const scheme = parseScheme(schemeStr);
  if (!scheme || qty < scheme.buy) {
    return rate;
  }
  const freeItems = Math.floor(qty / scheme.buy) * scheme.free;
  const totalItems = qty + freeItems;
  return (qty * rate) / totalItems;
};

// Helper to check if a medicine name is permanently ignored
const isMedicineIgnored = (name: string | undefined | null, ignoredList: Array<{ word: string }>): boolean => {
  if (!name || !name.trim()) return false;
  const clean = name.trim().toLowerCase();
  for (const item of ignoredList) {
    const w = (item.word || '').trim().toLowerCase();
    if (!w) continue;
    if (clean === w || clean.includes(w) || w.includes(clean)) {
      return true;
    }
  }
  return false;
};

// Module-Level Variable Cache (Preserved across mounts for <5ms instant rendering)
const loadInitialSkippedKeys = (): Set<string> => {
  try {
    const raw = localStorage.getItem('pharmarack_live_skipped_keys') || sessionStorage.getItem('pharmarack_live_skipped_keys');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch {}
  return new Set();
};

const saveSkippedKeys = (keys: Set<string>) => {
  try {
    const serialized = JSON.stringify(Array.from(keys));
    localStorage.setItem('pharmarack_live_skipped_keys', serialized);
    sessionStorage.setItem('pharmarack_live_skipped_keys', serialized);
  } catch {}
};

let cachedCartDistributors: Distributor[] = [];
let cachedPendingOrders: SpecialOrder[] = [];
let cachedPendingRefills: Refill[] = [];
let cachedReconOrders: LocalReconOrder[] = [];
let cachedAutoRefillItems: LocalAutoRefillItem[] = [];
let cachedIgnoredWords: Array<{ id: number; word: string; source: string; created_at: string }> = [];
const makeLocalIgnoredEntry = (word: string) => ({ id: Date.now(), word, source: 'user_ignore', created_at: new Date().toISOString() });
const setIgnoreNextSearchRef = (ref: { current: boolean }, value: boolean) => { ref.current = value; };
let cachedSkippedItemKeys: Set<string> = loadInitialSkippedKeys();
let cachedPrMode: 'Live' | 'Unknown' = 'Live';
const clientSearchCache = new Map<string, SuggestionMedicine[]>();
const MAX_CLIENT_SEARCH_CACHE = 100;

export interface LiveCartAddModalProps {
  initialSearch?: string;
  initialQty?: number;
  sourceOrderId?: number;
  sourceRefillId?: number;
  onClose: () => void;
}

export const LiveCartAddModal: React.FC<LiveCartAddModalProps> = ({
  initialSearch,
  initialQty,
  sourceOrderId,
  sourceRefillId,
  onClose
}) => {
  const [isOpen, setIsOpen] = useState(true);
  
  const handleClose = () => {
    setIsOpen(false);
    onClose();
  };
  
  // Input fields
  const [product, setProduct] = useState(initialSearch || '');
  const [qty, setQty] = useState(initialQty || 1);
  
  // Selected Pharmarack Metadata
  const [selectedDistributor, setSelectedDistributor] = useState('');
  const [selectedRate, setSelectedRate] = useState<number | ''>('');
  const [selectedMrp, setSelectedMrp] = useState<number | ''>('');
  const [selectedMapped, setSelectedMapped] = useState<boolean | null>(null);
  const [selectedScheme, setSelectedScheme] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | number>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | number>('');
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedPackaging, setSelectedPackaging] = useState('');
  const [selectedMedicineName, setSelectedMedicineName] = useState('');
  const [lastAddedDistributor, setLastAddedDistributor] = useState<string>(() => localStorage.getItem('pharmarack_last_added_distributor') || '');

  // Active Source Order/Refill Context
  const [activeSourceOrderId, setActiveSourceOrderId] = useState<number | undefined>(sourceOrderId);
  const [activeSourceRefillId, setActiveSourceRefillId] = useState<number | undefined>(sourceRefillId);
  const [pendingTargetQty, setPendingTargetQty] = useState<number | null>(initialQty || null);

  // Transfer medicine directly to Medicine Search box
  const handleTransferToSearch = (medName: string, targetQty: number = 1, srcOrderId?: number, srcRefillId?: number) => {
    if (!medName) return;
    ignoreNextSearchRef.current = false;
    setProduct(medName);
    
    // Store target order quantity to be applied when user selects a medicine from suggestions
    setPendingTargetQty(targetQty || 1);

    setActiveSourceOrderId(srcOrderId);
    setActiveSourceRefillId(srcRefillId);

    // Clear previous selected distributor metadata so fresh suggestions appear
    setSelectedDistributor('');
    setSelectedRate('');
    setSelectedMrp('');
    setSelectedMapped(null);
    setSelectedScheme('');
    setSelectedProductId('');
    setSelectedStoreId('');
    setSelectedProductCode('');
    setSelectedCompany('');
    setSelectedPackaging('');
    setSelectedMedicineName('');

    // Focus product input
    setTimeout(() => {
      productInputRef.current?.focus();
    }, 50);

    toastEvent.trigger(`Transferred "${medName}" to Medicine Search!`, 'info');
  };

  // Directly add to Pharmarack Live Cart with the supplied default qty.
  // Falls back to onFallback() when backend enrichment cannot resolve the product.
  // onFallback opens the distributor picker for the item instead of the medicine search box.

  // Overstock & Duplicate Check State
  const [overstockInfo, setOverstockInfo] = useState<{
    matchedLocalMedicineName: string;
    currentStock: number;
    cartQty: number;
    sales30d: number;
    maxLimit: number;
    recommendedQty: number;
    isOverstock: boolean;
    isDuplicateInCart: boolean;
    isExistingInStock: boolean;
    lastPurchasePTR?: number | null;
    lowestPurchasePTR?: number | null;
    warningMessage: string | null;
  } | null>(null);
  const [, setCheckingOverstock] = useState(false);

  const triggerOverstockCheck = async (name: string, requestedQuantity: number) => {
    if (!name || name.trim().length < 2) {
      setOverstockInfo(null);
      return;
    }
    setCheckingOverstock(true);
    try {
      const res = await api.checkPharmarackOverstock({
        productName: name,
        requestedQty: requestedQuantity
      });
      if (res && res.success) {
        setOverstockInfo(res);
      } else {
        setOverstockInfo(null);
      }
    } catch (err) {
      console.warn('Overstock check error:', err);
      setOverstockInfo(null);
    } finally {
      setCheckingOverstock(false);
    }
  };

  useEffect(() => {
    const targetName = selectedMedicineName || product.replace(/\s*\([^)]*\)$/, '').trim();
    if (targetName && targetName.length >= 2) {
      const timer = setTimeout(() => {
        triggerOverstockCheck(targetName, qty);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setOverstockInfo(null);
    }
  }, [selectedMedicineName, product, qty]);

  // Suggestions Search
  const [suggestions, setSuggestions] = useState<SuggestionMedicine[]>([]);
  const [, setCandidateOptions] = useState<SuggestionMedicine[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [prMode, setPrMode] = useState<'Live' | 'Unknown'>(cachedPrMode);

  // Cart Preview States (Hydrated instantly from module cache)
  const [cartDistributors, setCartDistributors] = useState<Distributor[]>(cachedCartDistributors);
  const [cartLoading, setCartLoading] = useState(cachedCartDistributors.length === 0);
  const [cartError, setCartError] = useState<string | null>(null);

  // Pending Orders States and Functions
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>(cachedPendingOrders);
  const [] = useState<number | null>(null);

  // Pending Filter Tab State
  const [pendingFilterTab, setPendingFilterTab] = useState<'all' | 'bounced' | 'orders' | 'minstock' | 'skipped'>('all');

  // Temporary Session Skip Handlers (valid medicines skipped for current order run only - preserved in module cache)
  const [skippedItemKeys, setSkippedItemKeys] = useState<Set<string>>(() => new Set(cachedSkippedItemKeys));

  const handleSkipItem = (itemKey: string, medicineName: string) => {
    cachedSkippedItemKeys.add(itemKey);
    const norm = (medicineName || '').trim().toLowerCase();
    if (norm) {
      cachedSkippedItemKeys.add(`med-${norm}`);
    }
    saveSkippedKeys(cachedSkippedItemKeys);
    setSkippedItemKeys(new Set(cachedSkippedItemKeys));
    toastEvent.trigger(`Skipped "${medicineName}" for this order run`, 'info');
  };

  const handleUnskipItem = (itemKey: string, medicineName: string) => {
    cachedSkippedItemKeys.delete(itemKey);
    const norm = (medicineName || '').trim().toLowerCase();
    if (norm) {
      cachedSkippedItemKeys.delete(`med-${norm}`);
    }
    saveSkippedKeys(cachedSkippedItemKeys);
    setSkippedItemKeys(new Set(cachedSkippedItemKeys));
    toastEvent.trigger(`Restored "${medicineName}" to pending list`, 'success');
  };

  const handleUnskipAll = () => {
    cachedSkippedItemKeys.clear();
    saveSkippedKeys(cachedSkippedItemKeys);
    setSkippedItemKeys(new Set());
    toastEvent.trigger('Restored all skipped items to pending lists', 'success');
  };

  // Pending Refills States and Functions
  const [pendingRefills, setPendingRefills] = useState<Refill[]>(cachedPendingRefills);
  const [] = useState<number | null>(null);

  // Reconcile Orders (unreconciled distributor email orders)
  const [reconOrders, setReconOrders] = useState<LocalReconOrder[]>(cachedReconOrders);
  const [] = useState<number | null>(null);
  const [] = useState<string>('');
    const [addedReconMedicines] = useState<Record<number | string, string[]>>({});
  // Permanently Ignored Words State
  const [ignoredWords, setIgnoredWords] = useState<Array<{ id: number; word: string; source: string; created_at: string }>>(cachedIgnoredWords);
  const [showIgnoredList, setShowIgnoredList] = useState(false);

  const fetchIgnoredWords = async () => {
    try {
      const data = await api.getIgnoredWords();
      if (Array.isArray(data)) {
        cachedIgnoredWords = data;
        setIgnoredWords(data);

        if (data.length > 0) {
          setPendingOrders(prev => prev.filter(o => !isMedicineIgnored(o.product, data)));
          setPendingRefills(prev => prev.filter(r => !isMedicineIgnored(r.medicine_name, data)));
          setAutoRefillItems(prev => prev.filter(i => !isMedicineIgnored(i.medicine_name, data)));
          setReconOrders(prev =>
            prev
              .map(r => ({
                ...r,
                medicine_names: r.medicine_names ? r.medicine_names.filter((m: string) => !isMedicineIgnored(m, data)) : []
              }))
              .filter(r => r.medicine_names && r.medicine_names.length > 0)
          );
        }
      }
    } catch (err) {
      console.error('Failed to fetch ignored words in modal:', err);
    }
  };

  const handleIgnoreWord = async (word: string) => {
    if (!word || !word.trim()) return;
    const clean = word.trim();
    try {
      await api.addIgnoredWord(clean, 'user_ignore');

      // 1. Immediately update ignoredWords state so the badge count increments instantly
      const newEntry = makeLocalIgnoredEntry(clean);
      const updatedIgnored = [newEntry, ...cachedIgnoredWords.filter((w) => w.word.toLowerCase() !== clean.toLowerCase())];
      cachedIgnoredWords = updatedIgnored;
      setIgnoredWords(updatedIgnored);

      // 2. Immediately filter out of all active pending lists in UI
      setPendingOrders((prev) => prev.filter((o) => !isMedicineIgnored(o.product, updatedIgnored)));
      setPendingRefills((prev) => prev.filter((r) => !isMedicineIgnored(r.medicine_name, updatedIgnored)));
      setAutoRefillItems((prev) => prev.filter((i) => !isMedicineIgnored(i.medicine_name, updatedIgnored)));
      setReconOrders((prev) =>
        prev
          .map((r) => ({
            ...r,
            medicine_names: r.medicine_names ? r.medicine_names.filter((m: string) => !isMedicineIgnored(m, updatedIgnored)) : []
          }))
          .filter((r) => r.medicine_names && r.medicine_names.length > 0)
      );

      fetchIgnoredWords();
      toastEvent.trigger(`Ignored "${clean}" and removed from pending lists`, 'success');
    } catch (err) {
      console.error('Failed to ignore word:', err);
      toastEvent.trigger('Failed to ignore word', 'error');
    }
  };

  const handleUnignoreWord = async (id: number, word: string) => {
    try {
      await api.removeIgnoredWord(id);
      await fetchIgnoredWords();
      await fetchReconOrders();
      toastEvent.trigger(`Removed "${word}" from ignore list`, 'info');
    } catch (err) {
      console.error('Failed to remove ignored word:', err);
      toastEvent.trigger('Failed to remove ignored word', 'error');
    }
  };

  // High-Frequency Low Stock Auto-Refills State
  const [autoRefillItems, setAutoRefillItems] = useState<LocalAutoRefillItem[]>(cachedAutoRefillItems);
  const [] = useState<number | null>(null);
  const [] = useState<number | null>(null);
  const [] = useState<string | null>(null);

  // Distributor Picker States (for Orders & Refills)
  const [] = useState<number | null>(null);
  const [] = useState<number | null>(null);
  const [] = useState<SuggestionMedicine[]>([]);
  const [] = useState(false);

  // New Special Request inline form states
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [newReqProduct, setNewReqProduct] = useState('');
  const [newReqQty, setNewReqQty] = useState(1);
  const [newReqRequester, setNewReqRequester] = useState('');
  const [newReqNotes, setNewReqNotes] = useState('');
  const [isSavingNewReq, setIsSavingNewReq] = useState(false);

  const handleCreateSpecialRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReqProduct.trim()) {
      toastEvent.trigger('Please enter medicine name for special request', 'error');
      return;
    }
    setIsSavingNewReq(true);
    try {
      await api.createOrder({
        product: newReqProduct.trim(),
        qty: Number(newReqQty) || 1,
        requester: newReqRequester.trim() || 'Walk-in Customer',
        notes: newReqNotes.trim() || undefined,
        priority: 'Normal',
        status: 'Pending'
      });
      toastEvent.trigger(`Created special request for "${newReqProduct}"!`, 'success');
      setNewReqProduct('');
      setNewReqQty(1);
      setNewReqRequester('');
      setNewReqNotes('');
      setShowNewRequestForm(false);
      await fetchPendingOrders();
    } catch (err) {
      const e = err as LocalApiError;
      console.error('Failed to create special request:', err);
      toastEvent.trigger(e.response?.data?.error || 'Failed to create special request', 'error');
    } finally {
      setIsSavingNewReq(false);
    }
  };

  const fetchPendingOrders = async () => {
    try {
      const data = await api.getOrders();
      if (Array.isArray(data)) {
        const filtered = data.filter(o => 
          (o.status === 'Pending' || o.status === 'Ordered') &&
          !isMedicineIgnored(o.product, cachedIgnoredWords)
        );
        cachedPendingOrders = filtered;
        setPendingOrders(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch pending special orders in modal:', err);
    }
  };

  const fetchPendingRefills = async () => {
    try {
      const data = await api.getRefillsPanel();
      if (Array.isArray(data)) {
        const refillList: Refill[] = [];
        const today = new Date();

        data.forEach((patient: LocalRefillPatient) => {
          if (!patient.medicines || !Array.isArray(patient.medicines)) return;

          patient.medicines.forEach((m) => {
            if (m.status === 'canceled' || m.is_active === 0) return;
            if (isMedicineIgnored(m.medicine_name, cachedIgnoredWords)) return;

            const dueDate = new Date(patient.next_refill_date);
            const diffMs = dueDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const reqQty = Number(m.quantity_needed || 1);
            const stockQty = Number(m.in_stock_qty || 0);

            // Show in actionable ordering if due within 7 days (today -> next 7 days)
            if (diffDays <= 7) {
              refillList.push({
                id: m.id,
                patient_name: patient.patient_name,
                patient_phone: patient.patient_phone,
                medicine_id: m.medicine_id || m.id,
                medicine_name: m.medicine_name,
                refill_interval_days: m.refill_interval_days || 30,
                last_refill_date: '',
                next_refill_date: patient.next_refill_date,
                status: m.status || 'active',
                hold_for_stock: m.hold_for_stock || 0,
                is_active: m.is_active !== undefined ? m.is_active : 1,
                quantity_needed: reqQty,
                in_stock_qty: stockQty,
                reminder_status: m.reminder_status || 'NOT_SENT',
                reminder_sent_at: m.reminder_sent_at || null
              });
            }
          });
        });

        cachedPendingRefills = refillList;
        setPendingRefills(refillList);
        return;
      }
    } catch (err) {
      console.warn('Failed to load refill panel in modal, trying fallback:', err);
    }

    try {
      const data = await api.getRefills();
      if (Array.isArray(data)) {
        const filtered = data.filter(r => {
          if (!r.is_active || r.status === 'completed' || r.status === 'canceled') return false;
          return !isMedicineIgnored(r.medicine_name, cachedIgnoredWords);
        });
        cachedPendingRefills = filtered;
        setPendingRefills(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch pending refills in modal:', err);
    }
  };

  const fetchReconOrders = async () => {
    try {
      const data = await api.getReconciliationList();
      if (Array.isArray(data)) {
        // Only show unresolved / missing reconcile items and filter ignored words
        const filtered = data
          .filter((r: LocalReconOrder) => !r.is_saved && r.status !== 'Matched')
          .map((r: LocalReconOrder) => ({
            ...r,
            medicine_names: r.medicine_names ? r.medicine_names.filter((m: string) => !isMedicineIgnored(m, cachedIgnoredWords)) : []
          }))
          .filter((r: LocalReconOrder) => r.medicine_names && r.medicine_names.length > 0);
        cachedReconOrders = filtered;
        setReconOrders(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch reconcile orders in modal:', err);
    }
  };

  const getRefillItemInCart = (refill: Refill) => {
    const refillName = refill.medicine_name || '';
    if (!refillName) return null;
    const { matchedItem, result } = findBestCartMatchForOrder({ product: refillName }, cartDistributors);
    if (result && result.isMatch) {
      return matchedItem;
    }
    return null;
  };

  const getOrderCartMatch = (order: SpecialOrder) => {
    const { matchedItem, result } = findBestCartMatchForOrder(order, cartDistributors);
    if (result && result.isMatch) {
      return { item: matchedItem, result };
    }
    return null;
  };

  const autocompleteRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const ignoreNextSearchRef = useRef(false);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  // Find the minimum effective rate among all suggestions to identify the best rate option
  const minEffectiveRate = React.useMemo(() => {
    let min = Infinity;
    suggestions.forEach(item => {
      if (item.isErrorMessage || !item.rate) return;
      const eff = getEffectiveRate(item.rate, item.scheme, qty);
      if (eff < min) {
        min = eff;
      }
    });
    return min;
  }, [suggestions, qty]);

  // fetchCart logic
  const fetchCart = async (silent?: boolean) => {
    const isSilent = typeof silent === 'boolean' ? silent : false;
    if (!isSilent) {
      setCartLoading(true);
    }
    setCartError(null);
    try {
      const data = await api.getPharmarackCart();
      if (data && (data.success || Array.isArray(data.distributors))) {
        cachedCartDistributors = data.distributors || [];
        setCartDistributors(cachedCartDistributors);
      } else {
        if (cachedCartDistributors.length === 0) {
          setCartError(data?.error || 'Failed to retrieve cart details.');
        }
      }
    } catch (err) {
      const e = err as LocalApiError;
      console.error('Failed to fetch Pharmarack cart in modal:', err);
      if (cachedCartDistributors.length === 0) {
        setCartError(e.response?.data?.error || e.message || 'Error fetching cart');
      }
    } finally {
      setCartLoading(false);
    }
  };

  const fetchLiveCartSummary = async (silent?: boolean) => {
    const isSilent = typeof silent === 'boolean' ? silent : false;
    if (!isSilent && cachedCartDistributors.length === 0) {
      setCartLoading(true);
    }
    try {
      const summary = await api.getPharmarackLiveCartSummary();
      if (summary && summary.success) {
        if (summary.cart?.distributors && summary.cart.distributors.length > 0) {
          cachedCartDistributors = summary.cart.distributors;
          setCartDistributors(summary.cart.distributors);
        } else {
          await fetchCart(true);
        }

        if (Array.isArray(summary.orders)) {
          const filteredOrders = summary.orders.filter((o: SpecialOrder) => !isMedicineIgnored(o.product, cachedIgnoredWords));
          cachedPendingOrders = filteredOrders;
          setPendingOrders(filteredOrders);
        }
        if (Array.isArray(summary.autoRefills)) {
          const filteredRefills = summary.autoRefills.filter((a: LocalAutoRefillItem) => !isMedicineIgnored(a.medicine_name, cachedIgnoredWords));
          cachedAutoRefillItems = filteredRefills;
          setAutoRefillItems(filteredRefills);
        }
      } else {
        await fetchCart(true);
      }
    } catch (err: unknown) {
      console.warn('Live cart summary fetch error, falling back to fetchCart:', err);
      await fetchCart(true);
    } finally {
      setCartLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        fetchLiveCartSummary(false),
        fetchPendingRefills(),
        fetchReconOrders()
      ]);
      toastEvent.trigger('Cart & pending lists refreshed!', 'success');
    } catch (err: unknown) {
      console.error('Failed to refresh modal cart:', err);
      toastEvent.trigger('Failed to refresh cart data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const freshSkipped = loadInitialSkippedKeys();
      cachedSkippedItemKeys = freshSkipped;
      setSkippedItemKeys(new Set(freshSkipped));

      const hasCache = cachedCartDistributors.length > 0;
      // Fetch consolidated live cart summary immediately without 350ms delay
      fetchLiveCartSummary(hasCache);
      api.checkPharmarackSession().then(data => {
        cachedPrMode = data.mode || 'Live';
        setPrMode(cachedPrMode);
      }).catch(() => setPrMode('Live'));

      // Also run secondary background refills & recon concurrently immediately
      Promise.allSettled([
        fetchPendingRefills(),
        fetchReconOrders(),
        fetchIgnoredWords()
      ]);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleRefresh = () => {
      if (isOpen) {
        Promise.allSettled([
          fetchLiveCartSummary(true),
          fetchPendingRefills(),
          fetchReconOrders(),
          fetchIgnoredWords()
        ]);
      }
    };
    window.addEventListener('refresh-pharmarack-cart', handleRefresh);
    return () => window.removeEventListener('refresh-pharmarack-cart', handleRefresh);
  }, [isOpen]);

  // Instant Autofocus on mount (<10ms)
  useEffect(() => {
    productInputRef.current?.focus();
    const timer = setTimeout(() => {
      productInputRef.current?.focus();
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  // Listen to Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle clicking outside to dismiss search results
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Live Query autocomplete with instant memory cache & request aborting
  useEffect(() => {
    if (ignoreNextSearchRef.current) {
      ignoreNextSearchRef.current = false;
      return;
    }

    const cleanQuery = product.replace(/\s*\([^)]*\)$/, '').trim();

    if (cleanQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const cacheKey = cleanQuery.toLowerCase();
    const cachedResults = clientSearchCache.get(cacheKey);
    if (cachedResults && cachedResults.length > 0) {
      setSuggestions(cachedResults);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
    }

    const delayDebounce = setTimeout(async () => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
      searchAbortControllerRef.current = new AbortController();

      if (!cachedResults) {
        setSearchLoading(true);
      }

      try {
        // Search Pharmarack catalog only (no local inventory cross-check)
        const prData = await api.searchPharmarack(cleanQuery).catch((err: unknown): LocalPrSearchOutcome => {
          const apiErr = err as LocalApiError;
          const errMsg = apiErr?.response?.data?.error || 'Connection error, please check internet or reconnect';
          return { isError: true, message: errMsg };
        }) as LocalPrSearchOutcome;

        const mergedList: SuggestionMedicine[] = [];

        if (prData && !(prData as LocalPrSearchFallback).isError && Array.isArray(prData) && prData.length > 0) {
          prData.forEach((item) => {
            const displayName = item.shortName || item.name;
            mergedList.push({
              medicine_name: displayName,
              shortName: item.shortName || item.name,
              fullName: item.fullName || item.name,
              mrp: item.mrp,
              isPharmarack: true,
              distributor: item.distributor,
              rate: item.rate,
              mapped: item.mapped,
              packaging: item.packaging,
              stock: item.stock,
              scheme: item.scheme,
              productId: item.productId,
              storeId: item.storeId,
              productCode: item.productCode,
              company: item.company
            });
          });

          // Sort suggestions placing last added medicine distributor on top of the list
          const lastDist = (lastAddedDistributor || localStorage.getItem('pharmarack_last_added_distributor') || '').toLowerCase().trim();
          if (lastDist && mergedList.length > 1) {
            mergedList.sort((a, b) => {
              if (a.isErrorMessage || b.isErrorMessage) return 0;
              const aMatch = (a.distributor || '').toLowerCase().includes(lastDist);
              const bMatch = (b.distributor || '').toLowerCase().includes(lastDist);
              if (aMatch && !bMatch) return -1;
              if (!aMatch && bMatch) return 1;
              return 0;
            });
          }
        } else if (prData && (prData as LocalPrSearchFallback).isError) {
          mergedList.push({
            medicine_name: `⚠️ ${(prData as LocalPrSearchFallback).message}`,
            isPharmarack: true,
            isErrorMessage: true
          });
        } else {
          mergedList.push({
            medicine_name: `No distributor matches found for "${cleanQuery}"`,
            isPharmarack: true,
            isErrorMessage: true
          });
        }

        // Cache valid response in client-side memory
        if (mergedList.length > 0 && !mergedList[0].isErrorMessage) {
          if (clientSearchCache.size >= MAX_CLIENT_SEARCH_CACHE) {
            const firstKey = clientSearchCache.keys().next().value;
            if (firstKey) clientSearchCache.delete(firstKey);
          }
          clientSearchCache.set(cacheKey, mergedList);
        }

        setSuggestions(mergedList);
        setShowSuggestions(mergedList.length > 0);
        setActiveSuggestionIndex(-1);
      } catch (err) {
        console.error('Error searching Pharmarack catalog:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(delayDebounce);
    };
  }, [product, lastAddedDistributor]);

  const handleProductChange = (val: string) => {
    setProduct(val);
    if (selectedProductId) {
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(null);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
      setSelectedMedicineName('');
    }
  };

  const selectSuggestion = (med: SuggestionMedicine) => {
    if (med.isErrorMessage) return;
    setIgnoreNextSearchRef(ignoreNextSearchRef, true);
    
    // Save current suggestions candidate list for cheaper option cross-checking
    setCandidateOptions(suggestions.filter(s => !s.isErrorMessage));
    
    setProduct(med.medicine_name);
    setSelectedDistributor(med.distributor || '');
    setSelectedRate(med.rate !== undefined && med.rate !== null ? med.rate : '');
    setSelectedMrp(med.mrp !== undefined && med.mrp !== null ? med.mrp : '');
    setSelectedMapped(med.mapped !== undefined ? med.mapped : null);
    setSelectedScheme(med.scheme || '');
    setSelectedProductId(med.productId || '');
    setSelectedStoreId(med.storeId || '');
    setSelectedProductCode(med.productCode || '');
    setSelectedCompany(med.company || '');
    setSelectedPackaging(med.packaging || '');
    setSelectedMedicineName(med.medicine_name || '');

    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);

    // Apply last order / pending target quantity upon selecting a medicine from suggestions
    if (pendingTargetQty && pendingTargetQty > 0) {
      setQty(pendingTargetQty);
      setPendingTargetQty(null);
    }

    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  };

  const handleProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        selectSuggestion(suggestions[activeSuggestionIndex]);
      } else {
        handleSubmit(e);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let storeIdToUse = selectedStoreId;
    let productIdToUse = selectedProductId;
    let rateToUse = selectedRate;
    let mappedToUse = selectedMapped;
    let schemeToUse = selectedScheme;
    let productCodeToUse = selectedProductCode;
    let companyToUse = selectedCompany;
    let packagingToUse = selectedPackaging;
    let distributorToUse = selectedDistributor;
    let productNameToUse = product.trim();

    // Auto-select top valid suggestion if user pressed Enter without manually clicking
    if ((!storeIdToUse || !productIdToUse) && suggestions.length > 0) {
      const topValid = suggestions.find(s => !s.isErrorMessage && s.productId && s.storeId);
      if (topValid) {
        storeIdToUse = topValid.storeId || '';
        productIdToUse = topValid.productId || '';
        rateToUse = topValid.rate !== undefined && topValid.rate !== null ? topValid.rate : '';
        mappedToUse = topValid.mapped !== undefined ? topValid.mapped : null;
        schemeToUse = topValid.scheme || '';
        productCodeToUse = topValid.productCode || '';
        companyToUse = topValid.company || '';
        packagingToUse = topValid.packaging || '';
        distributorToUse = topValid.distributor || '';
        productNameToUse = `${topValid.medicine_name} (${topValid.packaging})`;
      }
    }

    if (!productIdToUse || !storeIdToUse) {
      toastEvent.trigger('Please search and select a matching distributor product from the dropdown list.', 'error');
      return;
    }

    if (qty < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.addPharmarackCart([{
        productId: productIdToUse,
        storeId: storeIdToUse,
        qty,
        rate: rateToUse !== '' ? Number(rateToUse) : undefined,
        scheme: schemeToUse || undefined,
        productCode: productCodeToUse,
        company: companyToUse,
        productName: productNameToUse,
        storeName: distributorToUse,
        packaging: packagingToUse,
        mapped: mappedToUse === false ? false : true
      }]);

      toastEvent.trigger(`Added "${productNameToUse}" directly to live Pharmarack cart!`, 'success');

      if (distributorToUse) {
        localStorage.setItem('pharmarack_last_added_distributor', distributorToUse);
        setLastAddedDistributor(distributorToUse);
      }

      // Automatically update source order status if opened from pending requests or refills
      if (activeSourceOrderId) {
        try {
          await api.updateOrder(activeSourceOrderId, { status: 'Ordered' });
          await fetchPendingOrders();
        } catch (e) {
          console.warn('Failed to update source order status:', e);
        }
      }
      if (activeSourceRefillId) {
        try {
          await fetchPendingRefills();
        } catch (e) {
          console.warn('Failed to refresh source refill status:', e);
        }
      }
      
      // Reset form and keep open
      setProduct('');
      setQty(1);
      setPendingTargetQty(null);
      setActiveSourceOrderId(undefined);
      setActiveSourceRefillId(undefined);
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(null);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
      setSelectedMedicineName('');
      
      // Refresh cart preview immediately
      await fetchCart();

      // Focus back to search input so user can add another medicine
      setTimeout(() => {
        productInputRef.current?.focus();
      }, 100);
      
      // Refresh any active cart indicators in the header/sidebar
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
    } catch (cartErr: unknown) {
      console.error('Failed to add live cart item:', cartErr);
      const apiErr = cartErr as LocalApiError;
      const detailedError = apiErr?.response?.data?.details || apiErr?.response?.data?.error || apiErr?.message || 'Unknown error';
      toastEvent.trigger(`Live addition failed: ${detailedError}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedCartDistributors = React.useMemo(() => {
    if (!cartDistributors || cartDistributors.length === 0) return [];
    const lastDist = (lastAddedDistributor || localStorage.getItem('pharmarack_last_added_distributor') || '').toLowerCase().trim();
    if (!lastDist) return cartDistributors;

    return [...cartDistributors].sort((a, b) => {
      const aMatch = (a.storeName || '').toLowerCase().includes(lastDist);
      const bMatch = (b.storeName || '').toLowerCase().includes(lastDist);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }, [cartDistributors, lastAddedDistributor]);

  // ─── Structured Active vs Skipped Pending Item Calculations ─────────────────
  const isItemSkipped = useCallback((itemKey: string, medicineName: string) => {
    const norm = (medicineName || '').trim().toLowerCase();
    return skippedItemKeys.has(itemKey) || (norm ? skippedItemKeys.has(`med-${norm}`) : false);
  }, [skippedItemKeys]);

  const bouncedRows = useMemo(() => {
    return reconOrders.flatMap((recon, reconIdx) => {
      const reconUid = recon.email_uid || recon.uid || recon.id || `recon-${reconIdx}`;
      const addedList = addedReconMedicines[reconUid] || [];
      const medNames: string[] = recon.medicine_names && recon.medicine_names.length > 0 ? recon.medicine_names : [recon.subject || 'Recon Medicine'];

      return medNames.map((medName: string) => {
        const normName = medName.trim().toLowerCase();
        const itemKey = `recon-${reconUid}-${normName}`;
        const isSkipped = isItemSkipped(itemKey, medName);
        const isAdded = addedList.includes(medName);

        return {
          category: 'bounced' as const,
          recon,
          reconUid,
          medName,
          itemKey,
          isSkipped,
          isAdded
        };
      });
    });
  }, [reconOrders, addedReconMedicines, isItemSkipped]);

  const specialOrderRows = useMemo(() => {
    return pendingOrders.map(order => {
      const itemKey = `order-${order.id}`;
      const isSkipped = isItemSkipped(itemKey, order.product);
      const cartMatch = getOrderCartMatch(order);
      const inCart = Boolean(cartMatch?.item);
      const matchScore = cartMatch?.result?.score || 0;
      return {
        category: 'order' as const,
        order,
        itemKey,
        isSkipped,
        inCart,
        matchScore
      };
    });
  }, [pendingOrders, isItemSkipped, cartDistributors]);

  const refillRows = useMemo(() => {
    return pendingRefills.map(refill => {
      const itemKey = `refill-${refill.id}`;
      const isSkipped = isItemSkipped(itemKey, refill.medicine_name || '');
      const inCart = Boolean(getRefillItemInCart(refill));
      const refillQty = Math.max(1, Number(refill.quantity_needed) || 1);
      return {
        category: 'refill' as const,
        refill,
        itemKey,
        isSkipped,
        inCart,
        refillQty
      };
    });
  }, [pendingRefills, isItemSkipped, cartDistributors]);

  const minStockRows = useMemo(() => {
    return autoRefillItems.map(item => {
      const itemKey = `minstock-${item.medicine_id}`;
      const isSkipped = isItemSkipped(itemKey, item.medicine_name);
      return {
        category: 'minstock' as const,
        item,
        itemKey,
        isSkipped
      };
    });
  }, [autoRefillItems, isItemSkipped]);

  const activeBounced = useMemo(() => bouncedRows.filter(r => !r.isSkipped), [bouncedRows]);
  const activeOrders = useMemo(() => specialOrderRows.filter(r => !r.isSkipped), [specialOrderRows]);
  const activeRefills = useMemo(() => refillRows.filter(r => !r.isSkipped), [refillRows]);
  const activeMinStock = useMemo(() => minStockRows.filter(r => !r.isSkipped), [minStockRows]);

  const skippedBounced = useMemo(() => bouncedRows.filter(r => r.isSkipped), [bouncedRows]);
  const skippedOrders = useMemo(() => specialOrderRows.filter(r => r.isSkipped), [specialOrderRows]);
  const skippedRefills = useMemo(() => refillRows.filter(r => r.isSkipped), [refillRows]);
  const skippedMinStock = useMemo(() => minStockRows.filter(r => r.isSkipped), [minStockRows]);

  const activeAllCount = activeBounced.length + activeOrders.length + activeRefills.length + activeMinStock.length;
  const totalSkippedCount = skippedBounced.length + skippedOrders.length + skippedRefills.length + skippedMinStock.length;

  const renderBouncedRow = (row: typeof bouncedRows[0]) => {
    const { recon, medName, itemKey, isSkipped, isAdded } = row;
    return (
      <tr
        key={itemKey}
        className={`transition-colors cursor-pointer border-l-2 border-border ${
          isAdded ? 'bg-bg3/30' : 'hover:bg-bg3/40'
        }`}
        onClick={() => !isAdded && !isSkipped && handleTransferToSearch(medName, 1, undefined, undefined)}
      >
        <td className="py-2 px-1 align-top">
          <span className="text-xs p-1 rounded bg-bg2 border border-border inline-flex items-center justify-center" title={recon.status === 'Bounced' ? 'Bounced Email Order' : 'Reconciliation Order'}>
            ⚠️
          </span>
        </td>
        <td className="py-2 px-1 min-w-0 align-top">
          <div className="flex items-center justify-between gap-1">
            <div className={`text-xs font-bold truncate max-w-[180px] ${isAdded || isSkipped ? 'line-through opacity-50 text-muted' : 'text-text'}`} title={medName}>
              {medName}
            </div>
            <span className="text-[10px] text-muted font-mono font-bold shrink-0">Qty: 1</span>
          </div>
          
          <div className="text-[10px] text-muted font-medium truncate mt-0.5 max-w-[240px]">
            {recon.extracted_distributor && isValidDistributorName(recon.extracted_distributor) ? (
              <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.25 rounded bg-bg2 text-muted border border-border border-l-2 ${getDistributorColor(recon.extracted_distributor)} truncate max-w-[230px]`}>
                {recon.extracted_distributor}
              </span>
            ) : (
              <span>{recon.subject || 'Email Order'}</span>
            )}
          </div>

          {isSkipped ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUnskipItem(itemKey, medName);
              }}
              className="mt-1.5 text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
            >
              <RotateCcw size={9} /> Un-skip
            </button>
          ) : isAdded ? (
            <span className="mt-1.5 text-[9px] font-semibold text-muted inline-block">✓ Added</span>
          ) : (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransferToSearch(medName, 1, undefined, undefined);
                }}
                className="text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Search "${medName}" in search box`}
              >
                <Plus size={10} className="text-muted" /> Add
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSkipItem(itemKey, medName);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Skip "${medName}" for this order run`}
              >
                <EyeOff size={10} className="text-muted" /> Skip
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleIgnoreWord(medName);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Permanently ignore non-medicine word "${medName}" in OCR`}
              >
                <Ban size={10} className="text-muted" /> Ignore
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderSpecialOrderRow = (row: typeof specialOrderRows[0]) => {
    const { order, itemKey, isSkipped, inCart, matchScore } = row;
    return (
      <tr
        key={itemKey}
        className={`transition-colors cursor-pointer ${
          inCart ? 'bg-bg3/30' : 'hover:bg-bg3/40'
        }`}
        onClick={() => !inCart && !isSkipped && handleTransferToSearch(order.product, order.qty, order.id, undefined)}
      >
        <td className="py-2 px-1 align-top">
          <span className="text-xs p-1 rounded bg-bg2 text-muted border border-border inline-flex items-center justify-center" title="Special Customer Order">
            <ShoppingCart size={13} className="text-muted" />
          </span>
        </td>
        <td className="py-2 px-1 min-w-0 align-top">
          <div className="flex items-center justify-between gap-1">
            <div className={`text-xs font-bold truncate max-w-[180px] ${inCart || isSkipped ? 'line-through opacity-50 text-muted' : 'text-text'}`} title={order.product}>
              {order.product}
            </div>
            <span className="text-[10px] text-muted font-mono font-bold shrink-0">Qty: {order.qty}</span>
          </div>
          
          <div className="text-[10px] text-muted truncate max-w-[240px] mt-0.5">{order.requester}</div>

          {isSkipped ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUnskipItem(itemKey, order.product);
              }}
              className="mt-1.5 text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
            >
              <RotateCcw size={9} /> Un-skip
            </button>
          ) : inCart ? (
            <span className="mt-1.5 text-[9px] font-semibold text-muted inline-block" title={`Fuzzy match score: ${matchScore}%`}>
              ✓ Added ({matchScore}%)
            </span>
          ) : (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransferToSearch(order.product, order.qty, order.id, undefined);
                }}
                className="text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Search "${order.product}" in Live Cart`}
              >
                <Plus size={10} className="text-muted" /> Add
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSkipItem(itemKey, order.product);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Skip "${order.product}" for this order run`}
              >
                <EyeOff size={10} className="text-muted" /> Skip
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleIgnoreWord(order.product);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Permanently ignore word "${order.product}"`}
              >
                <Ban size={10} className="text-muted" /> Ignore
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderRefillRow = (row: typeof refillRows[0]) => {
    const { refill, itemKey, isSkipped, inCart, refillQty } = row;
    const medName = refill.medicine_name || '';
    return (
      <tr
        key={itemKey}
        className={`transition-colors cursor-pointer ${
          inCart ? 'bg-bg3/30' : 'hover:bg-bg3/40'
        }`}
        onClick={() => !inCart && !isSkipped && handleTransferToSearch(medName, refillQty, undefined, refill.id)}
      >
        <td className="py-2 px-1 align-top">
          <span className="text-xs p-1 rounded bg-bg2 text-muted border border-border inline-flex items-center justify-center" title="Patient Refill">
            <RefreshCw size={13} className="text-muted" />
          </span>
        </td>
        <td className="py-2 px-1 min-w-0 align-top">
          <div className="flex items-center justify-between gap-1">
            <div className={`text-xs font-bold truncate max-w-[180px] ${inCart || isSkipped ? 'line-through opacity-50 text-muted' : 'text-text'}`} title={medName}>
              {medName}
            </div>
            <span className="text-[10px] text-muted font-mono font-bold shrink-0">Qty: {refillQty}</span>
          </div>
          
          <div className="text-[10px] text-muted truncate max-w-[240px] mt-0.5">Patient: {refill.patient_name}</div>

          {isSkipped ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUnskipItem(itemKey, medName);
              }}
              className="mt-1.5 text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
            >
              <RotateCcw size={9} /> Un-skip
            </button>
          ) : inCart ? (
            <span className="mt-1.5 text-[9px] font-semibold text-muted inline-block">✓ Added</span>
          ) : (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransferToSearch(medName, refillQty, undefined, refill.id);
                }}
                className="text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Search "${medName}" in Live Cart`}
              >
                <Plus size={10} className="text-muted" /> Add
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSkipItem(itemKey, medName);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Skip "${medName}" for this order run`}
              >
                <EyeOff size={10} className="text-muted" /> Skip
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (medName) handleIgnoreWord(medName);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Permanently ignore word "${medName}"`}
              >
                <Ban size={10} className="text-muted" /> Ignore
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderMinStockRow = (row: typeof minStockRows[0]) => {
    const { item, itemKey, isSkipped } = row;
    return (
      <tr
        key={itemKey}
        className="transition-colors hover:bg-bg3/40 cursor-pointer"
        onClick={() => !isSkipped && handleTransferToSearch(item.medicine_name, item.recommended_qty, undefined, undefined)}
      >
        <td className="py-2 px-1 align-top">
          <span className="text-xs p-1 rounded bg-bg2 text-muted border border-border inline-flex items-center justify-center" title="Low Stock Auto-Refill">
            <Sparkles size={13} className="text-muted" />
          </span>
        </td>
        <td className="py-2 px-1 min-w-0 align-top">
          <div className="flex items-center justify-between gap-1">
            <div className={`text-xs font-bold truncate max-w-[180px] ${isSkipped ? 'line-through opacity-50 text-muted' : 'text-text'}`} title={item.medicine_name}>
              {item.medicine_name}
            </div>
            <span className="text-[10px] text-muted font-mono font-bold shrink-0">Qty: {item.recommended_qty}</span>
          </div>
          
          <div className="text-[10px] text-muted font-mono truncate max-w-[240px] mt-0.5">Stock: {item.current_stock} • 🔥 {item.sales_30d}/mo</div>

          {isSkipped ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUnskipItem(itemKey, item.medicine_name);
              }}
              className="mt-1.5 text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
            >
              <RotateCcw size={9} /> Un-skip
            </button>
          ) : (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTransferToSearch(item.medicine_name, item.recommended_qty, undefined, undefined);
                }}
                className="text-[9px] font-semibold text-text hover:bg-bg3 transition-colors bg-bg2 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Search "${item.medicine_name}" in search box`}
              >
                <Plus size={10} className="text-muted" /> Add
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSkipItem(itemKey, item.medicine_name);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Skip low stock item "${item.medicine_name}" for this order run`}
              >
                <EyeOff size={10} className="text-muted" /> Skip
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleIgnoreWord(item.medicine_name);
                }}
                className="text-[9px] font-semibold text-muted hover:text-text transition-colors bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border cursor-pointer flex items-center gap-1"
                title={`Permanently ignore word "${item.medicine_name}"`}
              >
                <Ban size={10} className="text-muted" /> Ignore
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const totalProducts = sortedCartDistributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = sortedCartDistributors.reduce((s, d) => s + d.items.reduce((q, i) => q + i.qty, 0), 0);
  const totalAmount = sortedCartDistributors.reduce((s, d) => s + d.items.reduce((a, i) => a + i.amount, 0), 0);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
      {/* ponytail: fix height to h-[85vh] to prevent modal size from jumping when cart preview loads */}
      <div className="glass-panel max-w-5xl lg:max-w-6xl xl:max-w-7xl w-full h-[85vh] max-h-[85vh] p-3.5 md:p-4.5 relative border border-glass-border/60 shadow-[0_0_60px_rgba(59,130,246,0.25)] bg-bg2 text-text animate-in fade-in zoom-in-95 duration-200 flex flex-col">
        
        {/* Header Action Buttons (Side-by-side flex container prevents button overlaps) */}
        <div className="absolute top-3.5 right-3.5 flex items-center gap-2 z-20">
          <button 
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing || cartLoading}
            className="p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-all flex items-center gap-1.5 text-xs font-semibold border border-glass-border/50 bg-bg3/60 hover:bg-bg3 disabled:opacity-50"
            title="Refresh Cart & Pending Lists"
          >
            <RefreshCw size={14} className={isRefreshing || cartLoading ? 'animate-spin text-emerald-400' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button 
            type="button"
            onClick={handleClose}
            className="p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-all border border-glass-border/50 bg-bg3/60 hover:bg-bg3"
            title="Close Modal (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 flex-1 overflow-hidden">
          
          {/* Left Column: Unified Pending Table */}
          <div className="flex flex-col h-full overflow-hidden bg-bg3/15 rounded-2xl p-3.5 border border-glass-border/20">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 shrink-0 border-b border-glass-border/30 gap-1.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-widest text-muted">
                  Pending ({activeAllCount})
                </span>
              </div>
              <div className="flex gap-1 text-[8.5px] font-bold uppercase select-none flex-wrap">
                <button
                  type="button"
                  onClick={() => setPendingFilterTab('all')}
                  className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${pendingFilterTab === 'all' ? 'bg-bg3 text-text border-glass-border font-extrabold shadow-sm' : 'bg-bg2 text-muted border-border hover:bg-bg3'}`}
                >
                  All ({activeAllCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingFilterTab('bounced')}
                  className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${pendingFilterTab === 'bounced' ? 'bg-bg3 text-text border-glass-border font-extrabold shadow-sm' : 'bg-bg2 text-muted border-border hover:bg-bg3'}`}
                >
                  Bounced ({activeBounced.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingFilterTab('orders')}
                  className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${pendingFilterTab === 'orders' ? 'bg-bg3 text-text border-glass-border font-extrabold shadow-sm' : 'bg-bg2 text-muted border-border hover:bg-bg3'}`}
                >
                  Orders ({activeOrders.length + activeRefills.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingFilterTab('minstock')}
                  className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${pendingFilterTab === 'minstock' ? 'bg-bg3 text-text border-glass-border font-extrabold shadow-sm' : 'bg-bg2 text-muted border-border hover:bg-bg3'}`}
                >
                  MinStock ({activeMinStock.length})
                </button>
                {totalSkippedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPendingFilterTab('skipped')}
                    className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${pendingFilterTab === 'skipped' ? 'bg-bg3 text-text border-glass-border font-extrabold shadow-sm' : 'bg-bg2 text-muted border-border hover:bg-bg3'}`}
                  >
                    Skipped ({totalSkippedCount})
                  </button>
                )}
              </div>
            </div>

            {/* Inline New Special Request Form */}
            {showNewRequestForm && (
              <form onSubmit={handleCreateSpecialRequest} className="my-2 p-2.5 bg-bg3/60 border border-glass-border/30 rounded-xl space-y-2 animate-in fade-in zoom-in-95 duration-150 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-text flex items-center gap-1">
                    <Sparkles size={11} className="text-muted" /> New Special Medicine Request
                  </span>
                  <button type="button" onClick={() => setShowNewRequestForm(false)} className="text-muted hover:text-text text-xs">✕</button>
                </div>
                <input
                  type="text"
                  value={newReqProduct}
                  onChange={e => setNewReqProduct(e.target.value)}
                  placeholder="Medicine Name (e.g. Augmentin 625)"
                  className="w-full premium-input px-2.5 py-1 text-xs font-medium"
                  autoFocus
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="1"
                    value={newReqQty}
                    onChange={e => setNewReqQty(parseInt(e.target.value) || 1)}
                    placeholder="Qty"
                    className="w-full premium-input px-2.5 py-1 text-xs"
                  />
                  <input
                    type="text"
                    value={newReqRequester}
                    onChange={e => setNewReqRequester(e.target.value)}
                    placeholder="Customer / Phone"
                    className="w-full premium-input px-2.5 py-1 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingNewReq}
                  className="w-full py-1 bg-bg3 hover:bg-bg2 text-text border border-border font-bold text-xs rounded-lg flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                >
                  {isSavingNewReq ? <Loader2 size={12} className="animate-spin text-muted" /> : 'Save Request'}
                </button>
              </form>
            )}

            {/* Table */}
            <div className="flex-1 overflow-y-auto scrollbar-thin mt-1">
              {pendingFilterTab === 'all' && (
                activeAllCount === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                    <CheckCircle2 size={28} className="opacity-30 mb-2 text-emerald-400" />
                    <p className="text-xs font-bold text-text">All Clear</p>
                    <p className="text-[11px] max-w-[200px] mx-auto mt-0.5 text-muted">
                      {totalSkippedCount > 0
                        ? `All active items handled. ${totalSkippedCount} item(s) are in the Skipped tab.`
                        : 'No pending orders, refills, or unreconciled items.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-muted border-b border-glass-border/20 text-[10px]">
                        <th className="text-left py-1 px-1 font-semibold w-7">Tag</th>
                        <th className="text-left py-1 px-1 font-semibold">Product & Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/10">
                      {activeBounced.map(renderBouncedRow)}
                      {activeOrders.map(renderSpecialOrderRow)}
                      {activeRefills.map(renderRefillRow)}
                      {activeMinStock.map(renderMinStockRow)}
                    </tbody>
                  </table>
                )
              )}

              {pendingFilterTab === 'bounced' && (
                activeBounced.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                    <CheckCircle2 size={28} className="opacity-30 mb-2 text-emerald-400" />
                    <p className="text-xs font-bold text-text">No Bounced Orders</p>
                    <p className="text-[11px] max-w-[200px] mx-auto mt-0.5 text-muted">
                      {skippedBounced.length > 0
                        ? `${skippedBounced.length} bounced item(s) are currently skipped.`
                        : 'All distributor email orders are reconciled.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-muted border-b border-glass-border/20 text-[10px]">
                        <th className="text-left py-1 px-1 font-semibold w-7">Tag</th>
                        <th className="text-left py-1 px-1 font-semibold">Product & Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/10">
                      {activeBounced.map(renderBouncedRow)}
                    </tbody>
                  </table>
                )
              )}

              {pendingFilterTab === 'orders' && (
                activeOrders.length + activeRefills.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                    <CheckCircle2 size={28} className="opacity-30 mb-2 text-emerald-400" />
                    <p className="text-xs font-bold text-text">No Pending Special Orders</p>
                    <p className="text-[11px] max-w-[200px] mx-auto mt-0.5 text-muted">
                      {skippedOrders.length + skippedRefills.length > 0
                        ? `${skippedOrders.length + skippedRefills.length} customer order(s)/refill(s) are currently skipped.`
                        : 'No customer special requests or chronic refills due.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-muted border-b border-glass-border/20 text-[10px]">
                        <th className="text-left py-1 px-1 font-semibold w-7">Tag</th>
                        <th className="text-left py-1 px-1 font-semibold">Product & Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/10">
                      {activeOrders.map(renderSpecialOrderRow)}
                      {activeRefills.map(renderRefillRow)}
                    </tbody>
                  </table>
                )
              )}

              {pendingFilterTab === 'minstock' && (
                activeMinStock.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                    <CheckCircle2 size={28} className="opacity-30 mb-2 text-emerald-400" />
                    <p className="text-xs font-bold text-text">Stock Levels Healthy</p>
                    <p className="text-[11px] max-w-[200px] mx-auto mt-0.5 text-muted">
                      {skippedMinStock.length > 0
                        ? `${skippedMinStock.length} min stock item(s) are currently skipped.`
                        : 'No medicines currently below safety stock levels.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-muted border-b border-glass-border/20 text-[10px]">
                        <th className="text-left py-1 px-1 font-semibold w-7">Tag</th>
                        <th className="text-left py-1 px-1 font-semibold">Product & Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/10">
                      {activeMinStock.map(renderMinStockRow)}
                    </tbody>
                  </table>
                )
              )}

              {pendingFilterTab === 'skipped' && (
                totalSkippedCount === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                    <EyeOff size={28} className="opacity-30 mb-2" />
                    <p className="text-xs font-bold text-text">No Skipped Medicines</p>
                    <p className="text-[11px] max-w-[200px] mx-auto mt-0.5 text-muted">
                      Items skipped from pending lists will appear here for easy un-skipping.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between p-1.5 bg-bg2/80 rounded-lg border border-border">
                      <span className="text-[10px] text-muted font-semibold">{totalSkippedCount} item(s) skipped</span>
                      <button
                        type="button"
                        onClick={handleUnskipAll}
                        className="text-[9px] font-bold text-text hover:text-muted transition-colors cursor-pointer flex items-center gap-1 bg-bg3/80 px-1.5 py-0.5 rounded border border-border"
                      >
                        <RotateCcw size={10} /> Un-skip All
                      </button>
                    </div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-muted border-b border-glass-border/20 text-[10px]">
                          <th className="text-left py-1 px-1 font-semibold w-7">Tag</th>
                          <th className="text-left py-1 px-1 font-semibold">Product & Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-glass-border/10">
                        {skippedBounced.map(renderBouncedRow)}
                        {skippedOrders.map(renderSpecialOrderRow)}
                        {skippedRefills.map(renderRefillRow)}
                        {skippedMinStock.map(renderMinStockRow)}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            {/* Ignored Words Accordion */}
            <div className="mt-3 border-t border-border pt-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowIgnoredList(!showIgnoredList)}
                className="w-full flex items-center justify-between text-[11px] font-semibold text-muted hover:text-text px-2 py-1 rounded bg-bg2/40 hover:bg-bg3/40 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Ban size={12} className="text-muted" />
                  <span>Ignored Words ({ignoredWords.length})</span>
                </span>
                <span className="text-[9px]">{showIgnoredList ? '▲' : '▼'}</span>
              </button>

              {showIgnoredList && (
                <div className="mt-1.5 p-2 bg-bg2/60 rounded border border-border max-h-36 overflow-y-auto space-y-1.5 scrollbar-thin">
                  {ignoredWords.length === 0 ? (
                    <div className="text-[11px] text-muted italic text-center py-1">No permanently ignored words</div>
                  ) : (
                    ignoredWords.map((iw) => (
                      <div key={iw.id} className="flex items-center justify-between text-xs px-2 py-1 bg-bg3/40 rounded border border-border/50">
                        <span className="font-semibold text-text truncate max-w-[150px]" title={iw.word}>
                          {iw.word}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUnignoreWord(iw.id, iw.word)}
                          className="text-[10px] font-bold text-muted hover:text-red transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10 border border-transparent hover:border-red-500/20 cursor-pointer shrink-0"
                          title="Remove from ignore list"
                        >
                          ✕ Un-ignore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>


          {/* Middle Column: Form */}
          <div className="flex flex-col h-full justify-between bg-bg3/15 rounded-2xl p-3.5 border border-glass-border/20 relative z-30 overflow-visible">
            <div className="space-y-4">
              {/* Title */}
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/10 rounded-xl text-primary border border-primary/20 shadow-sm">
                  <ShoppingCart size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                    Add to Live Cart
                    <span className="text-[10px] bg-bg3 border border-border text-muted px-1.5 py-0.5 rounded font-mono">Alt + L</span>
                    {prMode !== 'Unknown' && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border leading-none bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        ● LIVE
                      </span>
                    )}
                  </h3>

                </div>
              </div>

              {/* Form Body */}
              <form id="live-cart-add-form" onSubmit={handleSubmit} className="space-y-4">
                
                {/* Autocomplete Search Input */}
                <div className="relative z-50 animate-in fade-in duration-200" ref={autocompleteRef}>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">Medicine Search</label>
                  <div className="relative">
                    <span className="absolute left-3 top-[11.5px] text-muted">
                      {searchLoading ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} />}
                    </span>
                    <input
                      ref={productInputRef}
                      type="text"
                      value={product}
                      onChange={(e) => handleProductChange(e.target.value)}
                      onKeyDown={handleProductKeyDown}
                      className="w-full premium-input pl-9 pr-4 py-2 text-sm font-medium"
                      placeholder="Search Pharmarack catalog..."
                      autoComplete="off"
                    />
                  </div>
                  
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute z-[9999] left-0 right-0 mt-1 max-h-[400px] overflow-y-auto bg-bg2 border-2 border-primary/40 backdrop-blur-2xl rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] divide-y divide-border/30 py-1 scrollbar-thin">
                      {suggestions.map((med, index) => (
                        <li
                          key={index}
                          onClick={() => selectSuggestion(med)}
                          className={`px-3.5 py-2 text-xs cursor-pointer flex justify-between items-center transition-all ${
                            med.isErrorMessage
                              ? 'bg-red-500/10 text-red border-l-2 border-red cursor-default'
                              : index === activeSuggestionIndex 
                              ? 'bg-primary/20 text-text font-semibold border-l-2 border-primary' 
                              : 'text-muted hover:text-text hover:bg-bg3/60'
                          }`}
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            {/* Line 1: Exact Raw Product Title + Scheme & Best Rate Badges */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-text truncate text-sm">
                                {med.medicine_name}
                              </span>
                              {med.scheme && !med.isErrorMessage && (
                                <span className="text-[10px] bg-bg3 text-muted border border-border px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                                  {med.scheme}
                                </span>
                              )}
                              {med.rate !== undefined && med.rate !== null && !med.isErrorMessage && getEffectiveRate(med.rate, med.scheme, qty) === minEffectiveRate && (
                                <span className="text-[9px] bg-bg3 text-text border border-border px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-0.5 shrink-0 select-none">
                                  <Sparkles size={8} className="text-text animate-pulse" /> Best Rate
                                </span>
                              )}
                            </div>

                            {/* Line 2: Exact Raw Distributor Name & Company Name */}
                            {!med.isErrorMessage && (
                              <div className="flex items-center gap-2 flex-wrap mt-0.5 text-xs">
                                <span className={`font-semibold text-text px-1.5 py-0.5 rounded bg-bg2 border border-border border-l-2 ${getDistributorColor(med.distributor)} inline-block`}>
                                  {med.distributor || 'No Distributor'}
                                </span>
                                {med.company && (
                                  <span className="text-[10px] text-muted/70 font-semibold uppercase tracking-wider">
                                    {med.company}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Line 3: PTR, MRP, Packaging & Stock (Official Site Icon Layout) */}
                            {!med.isErrorMessage && (
                              <div className="flex items-center gap-2.5 text-[11px] mt-0.5 flex-wrap">
                                {med.rate !== undefined && med.rate !== null && (
                                  <span className="font-bold text-text font-mono">PTR: ₹{med.rate}</span>
                                )}
                                {med.mrp !== undefined && med.mrp !== null && (
                                  <span className="text-muted font-mono">MRP: ₹{med.mrp}</span>
                                )}
                                {med.packaging && (
                                  <span className="text-muted font-mono font-semibold">{med.packaging}</span>
                                )}
                                {med.stock !== undefined && (
                                  <span className="font-bold font-mono px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 bg-bg3 text-muted border border-border">
                                    <Package size={10} /> {med.stock}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Selected Pharmarack preview */}
                {selectedDistributor && (
                  <div className={`p-3 rounded-xl bg-bg3 border border-border border-l-4 ${getDistributorColor(selectedDistributor)} text-xs text-text flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200`}>
                    <div className="truncate pr-2">
                      <div className="font-bold text-muted text-[9px] uppercase tracking-wider mb-1">Distributor / Supplier</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-text font-bold truncate text-sm">{selectedDistributor}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg2 text-muted border border-border">
                          {selectedMapped ? 'Mapped' : 'Non-mapped'}
                        </span>
                        {selectedCompany && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg2 text-muted border border-border uppercase tracking-wide">
                            {selectedCompany}
                          </span>
                        )}
                        {selectedScheme && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg2 text-muted border border-border uppercase">
                            {selectedScheme}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="font-mono font-bold whitespace-nowrap flex flex-col items-end gap-0.5 text-right shrink-0">
                        {selectedRate !== '' && <span className="text-text text-sm font-bold">PTR: ₹{selectedRate}</span>}
                        {selectedMrp !== '' && <span className="text-muted text-[10px]">MRP: ₹{selectedMrp}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDistributor('');
                          setSelectedRate('');
                          setSelectedMrp('');
                          setSelectedMapped(null);
                          setSelectedScheme('');
                          setSelectedProductId('');
                          setSelectedStoreId('');
                          setSelectedProductCode('');
                          setSelectedCompany('');
                          setSelectedPackaging('');
                          setProduct('');
                          setSelectedMedicineName('');
                          setTimeout(() => productInputRef.current?.focus(), 50);
                        }}
                        className="p-1.5 text-muted hover:text-red hover:bg-bg2 rounded-xl transition-all ml-2"
                        title="Cancel distributor selection"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                )}



                {/* Quantity Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">Quantity</label>
                  <div className="flex items-center justify-between bg-bg3 border border-border rounded-xl h-9 px-1.5 max-w-[150px]">
                    <button
                      type="button"
                      onClick={() => setQty(prev => Math.max(1, prev - 1))}
                      className="w-7.5 h-7.5 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      ref={qtyInputRef}
                      type="number"
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-transparent text-center text-sm font-bold outline-none text-text focus:ring-0 border-0 p-0"
                      min="1"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setQty(prev => prev + 1)}
                      className="w-7.5 h-7.5 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {/* Overstock & Duplicate Inventory Cross-Check Card */}
                {overstockInfo && (
                  <div className="p-3 rounded-xl border border-border bg-bg3 text-xs text-text shadow-md transition-all duration-300 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-text">
                        <AlertCircle size={14} className="text-muted" />
                        <span>{overstockInfo.isOverstock ? '⚠️ Overstock Warning' : 'ℹ️ Inventory Stock & Cart Cross-Check'}</span>
                      </div>
                      {overstockInfo.matchedLocalMedicineName && (
                        <span className="text-[9px] bg-bg2 text-muted border border-border px-1.5 py-0.5 rounded font-mono truncate max-w-[150px]" title={overstockInfo.matchedLocalMedicineName}>
                          Matched: {overstockInfo.matchedLocalMedicineName}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 text-center py-1.5 my-1 bg-bg2/60 rounded-lg border border-border/50 font-mono text-[10px]">
                      <div className="p-1">
                        <div className="text-muted text-[8px] uppercase">In Store Stock</div>
                        <div className="font-bold text-xs text-text">
                          {overstockInfo.currentStock} units
                        </div>
                      </div>
                      <div className="p-1 border-l border-border/30">
                        <div className="text-muted text-[8px] uppercase">In Cart</div>
                        <div className="font-bold text-xs text-text">
                          {overstockInfo.cartQty} units
                        </div>
                      </div>
                      <div className="p-1 border-l border-border/30">
                        <div className="text-muted text-[8px] uppercase">Rec. Cap</div>
                        <div className="font-bold text-xs text-text">
                          {overstockInfo.maxLimit} units
                        </div>
                      </div>
                      <div className="p-1 border-l border-border/30">
                        <div className="text-muted text-[8px] uppercase">Last Paid PTR</div>
                        <div className="font-bold text-xs text-text">
                          {overstockInfo.lastPurchasePTR ? `₹${overstockInfo.lastPurchasePTR.toFixed(2)}` : 'N/A'}
                        </div>
                      </div>
                    </div>

                    {/* Historical Rate Variance Audit */}
                    {(() => {
                      if (!selectedRate || !overstockInfo.lastPurchasePTR) return null;
                      const current = Number(selectedRate);
                      const last = Number(overstockInfo.lastPurchasePTR);
                      const diff = current - last;
                      const pct = Math.abs((diff / last) * 100).toFixed(1);
                      if (Math.abs(diff) < 0.05) {
                        return (
                          <div className="text-[10px] font-bold text-text my-1 flex items-center gap-1 bg-bg2 px-2 py-1 rounded border border-border">
                            <span>✓ Offered PTR ₹{current.toFixed(2)} matches last purchase PTR (₹{last.toFixed(2)})</span>
                          </div>
                        );
                      }
                      if (diff < 0) {
                        return (
                          <div className="text-[10px] font-bold text-text my-1 flex items-center gap-1 bg-bg2 px-2 py-1 rounded border border-border">
                            <span>📉 Offered PTR ₹{current.toFixed(2)} is ₹{Math.abs(diff).toFixed(2)} ({pct}% cheaper) than last paid PTR (₹{last.toFixed(2)})</span>
                          </div>
                        );
                      }
                      return (
                        <div className="text-[10px] font-bold text-text my-1 flex items-center gap-1 bg-bg2 px-2 py-1 rounded border border-border">
                          <span>📈 Offered PTR ₹{current.toFixed(2)} is ₹{diff.toFixed(2)} (+{pct}%) higher than last paid PTR (₹{last.toFixed(2)})</span>
                        </div>
                      );
                    })()}

                    {overstockInfo.warningMessage && (
                      <p className="text-[10px] text-text/80 my-1 leading-tight">
                        {overstockInfo.warningMessage}
                      </p>
                    )}

                    {overstockInfo.isOverstock && overstockInfo.recommendedQty !== qty && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetQty = overstockInfo.recommendedQty > 0 ? overstockInfo.recommendedQty : 1;
                          setQty(targetQty);
                          toastEvent.trigger(`Adjusted order quantity to recommended cap (${targetQty} units)`, 'success');
                        }}
                        className="w-full mt-2 py-1.5 px-3 rounded-lg bg-bg2 hover:bg-bg3 text-text border border-border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                      >
                        <Sparkles size={12} className="text-muted" />
                        ✨ Adjust Qty to Recommended ({overstockInfo.recommendedQty > 0 ? overstockInfo.recommendedQty : 1} units)
                      </button>
                    )}
                  </div>
                )}
              </form>
            </div>

            {/* Action Row */}
            <div className="pt-4 border-t border-glass-border flex justify-end gap-3 mt-4 flex-row flex-nowrap shrink-0 whitespace-nowrap">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-bg3 border border-border text-muted hover:text-text text-xs font-bold rounded-xl transition-all shrink-0 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="live-cart-add-form"
                disabled={isSubmitting || !selectedProductId}
                className="px-5 py-2 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center gap-1.5 shrink-0 whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Adding...
                  </>
                ) : (
                  <>
                    <ShoppingCart size={14} /> Add to Live Cart
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Mini Cart Preview */}
          {/* ponytail: show simple mini-cart preview side-by-side */}
          <div className="flex flex-col h-full overflow-hidden bg-bg3/15 rounded-2xl p-3.5 border border-glass-border/20">
            <div className="flex items-center justify-between pb-3 border-b border-glass-border/30 shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-emerald-400" />
                <h4 className="text-xs font-bold text-text uppercase tracking-wider">Cart Preview</h4>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 py-3 space-y-3 scrollbar-thin">
              {cartLoading && sortedCartDistributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                  <Loader2 size={24} className="animate-spin text-emerald-400" />
                  <span className="text-xs text-muted font-mono">Loading cart...</span>
                </div>
              ) : cartError ? (
                <div className="text-center py-4 text-xs text-red/80 bg-red-500/5 rounded-xl border border-red-500/10 p-3">
                  <p className="font-semibold">Failed to load cart</p>
                  <p className="text-[10px] opacity-70 mt-1">{cartError}</p>
                </div>
              ) : sortedCartDistributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                  <ShoppingCart size={32} className="opacity-25 mb-2 text-emerald-400" />
                  <p className="text-xs font-bold text-text">Cart Preview is Empty</p>
                  <p className="text-[11px] max-w-[200px] mx-auto mt-1 leading-relaxed text-muted">
                    Search for a medicine on the left and select a distributor to add items to your Pharmarack cart.
                  </p>
                </div>
              ) : (
                sortedCartDistributors.map((dist, distIdx) => (
                  <div key={dist.storeId} className={`bg-bg3/40 border border-glass-border/30 border-l-4 ${getDistributorColor(dist.storeName)} hover:border-glass-border/60 rounded-xl overflow-hidden p-2.5 space-y-2 transition-all`}>
                    {/* Distributor Header */}
                    <div className="flex items-center justify-between border-b border-glass-border/20 pb-1.5">
                      <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                        <span className="text-[11px] font-bold text-text uppercase tracking-wide truncate" title={dist.storeName}>
                          {dist.storeName}
                        </span>
                        {distIdx === 0 && lastAddedDistributor && dist.storeName.toLowerCase().includes(lastAddedDistributor.toLowerCase()) && (
                          <span className="text-[8px] font-extrabold uppercase px-1 py-0.2 rounded bg-bg2 text-muted border border-border shrink-0">
                            Recent
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-bold text-muted bg-bg2 px-1.5 py-0.5 rounded-full border border-border">
                        {dist.items.length} item{dist.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Distributor Items */}
                    <div className="space-y-1.5">
                      {dist.items.map((item, idx) => (
                        <div key={`${item.productCode}-${idx}`} className="flex justify-between items-start text-[11px] gap-2.5 hover:bg-bg2/60 p-1 rounded transition-colors">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-text block truncate" title={item.productName}>
                              {item.productName}
                            </span>
                            <span className="text-[9px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                              {item.company && (
                                <span className="text-muted font-bold uppercase text-[8px] bg-bg2 border border-border px-1 rounded">
                                  {item.company}
                                </span>
                              )}
                              {item.packaging && <span className="font-mono">{item.packaging}</span>}
                              {item.scheme && (
                                <span className="text-muted font-bold uppercase text-[8px] bg-bg2 border border-border px-1 rounded">
                                  {item.scheme}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end">
                            <span className="font-bold text-text">Qty: {item.qty}</span>
                            {item.ptr > 0 && <span className="text-[9px] text-muted font-mono mt-0.5">₹{(item.ptr * item.qty).toFixed(2)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Subtotal */}
                    {dist.lineTotal > 0 && (
                      <div className="flex justify-between items-center pt-1.5 border-t border-glass-border/15 text-[11px]">
                        <span className="text-muted uppercase tracking-wider font-bold">Subtotal</span>
                        <span className="font-bold text-text font-mono">₹{dist.lineTotal.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Cart Preview Footer Summary */}
            {cartDistributors.length > 0 && (
              <div className="mt-auto pt-2.5 border-t border-glass-border/20 bg-bg3/30 rounded-xl p-2 space-y-1.5 shrink-0">
                <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Items</span>
                    <span className="font-bold text-text font-mono">{totalProducts}</span>
                  </div>
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Total Qty</span>
                    <span className="font-bold text-text font-mono">{totalQty}</span>
                  </div>
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Est. Total</span>
                    <span className="font-bold text-text font-mono text-xs">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer info hints */}
        <div className="mt-2.5 pt-2 border-t border-glass-border/30 flex justify-between text-[9px] text-muted/60 font-semibold font-mono shrink-0">
          <span>[Esc] Close</span>
          <span>[Alt + L] Toggle modal</span>
          <span>[Enter] Add to Live Cart</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
