import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useLocation } from 'react-router-dom';
import { api } from '../../services/api';
import { RotateCcw, Plus, Trash2, Search, FileText, Camera, X, Loader2, Edit, Wand2, ChevronDown, ChevronUp, Building2, Layers } from 'lucide-react';
import AICamera from '../../components/AICamera';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Expiry from '../Expiry';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import CustomerReturn from '../CustomerReturn';
import CustomerReturnHistory from '../CustomerReturnHistory';
import ExpiryReturnReview from './ExpiryReturnReview';
import { CalendarDays, Users, History, ShieldAlert } from 'lucide-react';
import { rankAndSortMedicines } from '../../utils/searchRanker';

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

interface ReturnItem {
  id: string;
  medicine_id: number | null;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number | string;
  cost_price: number | string;
  mrp: number | string;
  purchase_item_id?: number;
  invoice_no?: string;
  purchase_date?: string;
  distributor_name?: string;
  distributor_id?: number;
}

interface GroupedReturn {
  distributor_id: number;
  distributor_name: string;
  invoice_no: string;
  purchase_date: string;
  items: ReturnItem[];
  total_amount: number;
}

interface LocalReturnsTab {
  id: string;
  name: string;
  items: ReturnItem[];
}

type LocalEditableReturnItem = ReturnItem & { _resolved_fields?: string[] };

type LocalHistoryReturnDetail = Omit<ReturnItem, 'quantity' | 'cost_price' | 'mrp'> & {
  quantity: number | string | null;
  cost_price: number | string | null;
  mrp: number | string | null;
};

interface LocalPurchaseLookupRow {
  medicine_id: number;
  medicine_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  cost_price: number | null;
  mrp: number | null;
  purchase_item_id?: number | null;
  invoice_no: string | null;
  purchase_date: string | null;
  distributor_name: string | null;
  distributor_id: number | null;
}

interface LocalReturnItemRow {
  id: number;
  medicine_id: number | null;
  medicine_name?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  quantity?: number | string | null;
  cost_price?: number | null;
  mrp?: number | null;
  invoice_no?: string | null;
  purchase_date?: string | null;
  distributor_name?: string | null;
  distributor_id?: number | null;
  ret_invoice_no?: string | null;
  ret_purchase_date?: string | null;
  ret_distributor_name?: string | null;
  ret_distributor_id?: number | null;
  _resolved_fields?: string[];
}

interface LocalReturnHistoryRow {
  id: number;
  return_no?: string | null;
  date?: string | null;
  type?: string | null;
  total_amount?: number | null;
  original_invoice_id?: number | string | null;
  distributor_id?: number | null;
  distributor_name?: string | null;
}

interface LocalExpiryPrefillRow {
  id?: number | null;
  medicine_id?: number | null;
  medicine_name?: string | null;
  name?: string | null;
  item_name?: string | null;
  batch_no?: string | null;
  batch?: string | null;
  expiry_date?: string | null;
  expiry?: string | null;
  quantity?: number | null;
  pack_quantity?: number | null;
  current_stock?: number | null;
  stock_quantity?: number | null;
  cost_price?: number | null;
  purchase_cost_price?: number | null;
  purchase_cost?: number | null;
  mrp?: number | null;
  purchase_item_id?: number | null;
  invoice_no?: string | null;
  purchase_invoice_no?: string | null;
  purchase_date?: string | null;
  distributor_name?: string | null;
  supplier_name?: string | null;
  distributor?: string | null;
  supplier_id?: number | null;
  distributor_id?: number | null;
}

interface LocalCameraMedicineInfo {
  potentialName?: string;
  batchNumber?: string;
  expiryDate?: string;
  mrp?: number | string;
}

interface LocalMasterDistributor {
  id?: number;
  name?: string | null;
}

const numOr0 = (v: unknown): number => parseFloat(String(v ?? '')) || 0;

const getInitialReturnsTabs = () => {
  const saved = localStorage.getItem('returns_draft_tabs');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.error('Failed to parse saved Returns tabs:', e);
    }
  }
  return [
    {
      id: 'default',
      name: 'Return 1',
      items: [
        {
          id: generateUUID(),
          medicine_id: null,
          medicine_name: '',
          batch_no: '',
          expiry_date: '',
          quantity: 0,
          cost_price: 0,
          mrp: 0,
        }
      ]
    }
  ];
};

const getInitialReturnsActiveTabId = (initialTabs: LocalReturnsTab[]) => {
  const saved = localStorage.getItem('returns_active_tab_id');
  if (saved && initialTabs.some(t => t.id === saved)) return saved;
  return initialTabs[0]?.id || 'default';
};

const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  val = val.trim().replace(/\s+/g, '');
  if (/^\d{4}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yy = val.substring(2, 4);
    return `${mm}/${yy}`;
  }
  if (/^\d{6}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yyyy = val.substring(2, 6);
    return `${mm}/${yyyy.substring(2, 4)}`;
  }
  if (/^\d{2}\/\d{4}$/.test(val)) {
    const mm = val.substring(0, 2);
    const yyyy = val.substring(3, 7);
    return `${mm}/${yyyy.substring(2, 4)}`;
  }
  if (/^\d{2}\/\d{2}$/.test(val)) {
    return val;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
    const parts = val.substring(0, 10).split('-');
    return `${parts[1]}/${parts[0].substring(2, 4)}`;
  }
  return val;
};

const getExpiryUrgencyStatus = (expiryStr: string): { label: string; className: string; rank: number } | null => {
  if (!expiryStr) return null;
  let expDate: Date | null = null;
  if (expiryStr.includes('/')) {
    const parts = expiryStr.split('/');
    let year = parseInt(parts[1], 10);
    const month = parseInt(parts[0], 10) - 1;
    if (year < 100) year += 2000;
    expDate = new Date(year, month + 1, 0);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(expiryStr)) {
    expDate = new Date(expiryStr);
  }
  if (!expDate || isNaN(expDate.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (expDate < today) {
    return { label: 'EXPIRED', className: 'bg-red-500/10 text-red-500 border-red-500/20', rank: 1 };
  }
  const sixtyDaysFromNow = new Date();
  sixtyDaysFromNow.setDate(today.getDate() + 60);
  if (expDate <= sixtyDaysFromNow) {
    return { label: 'NEAR EXPIRY', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20', rank: 2 };
  }
  return { label: 'VALID', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', rank: 3 };
};

let cachedReturnHistory: LocalReturnHistoryRow[] | null = null;
const nowStamp = () => Date.now();

const Returns: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'returns';
  const location = useLocation();

  const initialTabs = getInitialReturnsTabs();
  const initialActiveTabId = getInitialReturnsActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [tabs, setTabs] = useState<LocalReturnsTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);
  const [historySubTab, setHistorySubTab] = useState<'supplier' | 'customer'>('supplier');

  const [items, setItems] = useState<ReturnItem[]>(initialActiveTab.items || []);
  const [saving, setSaving] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  useEffect(() => {
    api.getExpiryReviews({ status: 'pending' }).then(res => {
      if (res?.stats) setPendingReviewCount(res.stats.pendingCount || 0);
    }).catch(() => {});
  }, []);
  const [searchResults, setSearchResults] = useState<LocalPurchaseLookupRow[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchHighlightIndex >= 0 && searchResultsRef.current) {
      const highlighted = searchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [searchHighlightIndex]);
  
  const activeSearchRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(activeSearchRef, () => {
    setActiveSearchIndex(null);
    setSearchResults([]);
    setSearchHighlightIndex(-1);
  });
  const [, setGroupedReturns] = useState<GroupedReturn[]>([]);

  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<LocalReturnHistoryRow | null>(null);
  const [historyReturnItems, setHistoryReturnItems] = useState<LocalHistoryReturnDetail[]>([]);
  const [loadingHistoryItems, setLoadingHistoryItems] = useState(false);

  const handleSelectHistoryReturn = async (ret: LocalReturnHistoryRow) => {
    setSelectedHistoryReturn(ret);
    setLoadingHistoryItems(true);
    setIsEditingHistory(false);
    try {
      const response = await api.getReturnItems(ret.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map((item): LocalHistoryReturnDetail => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity ?? null,
        cost_price: item.cost_price ?? null,
        mrp: item.mrp || 0,
        // Prefer the invoice_no joined from purchases; fall back to parent return's original_invoice_id
        invoice_no: item.invoice_no || (ret.original_invoice_id ? String(ret.original_invoice_id) : 'N/A'),
        purchase_date: item.purchase_date || '',
        // Prefer distributor from the joined row; fall back to parent return
        distributor_name: item.distributor_name || ret.distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || ret.distributor_id || undefined,
      }));
      setHistoryReturnItems(mapped);
      const toEditable = (i: LocalHistoryReturnDetail): LocalEditableReturnItem => ({
        ...i,
        quantity: i.quantity ?? '',
        cost_price: i.cost_price ?? '',
        mrp: i.mrp ?? 0,
      });
      setEditingItems(mapped.map(toEditable));
    } catch (error) {
      console.error('Error fetching return items:', error);
    } finally {
      setLoadingHistoryItems(false);
    }
  };

  const handleClearHistorySelection = () => {
    setSelectedHistoryReturn(null);
    setHistoryReturnItems([]);
  };

  const handleDeleteReturn = async (ret: LocalReturnHistoryRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete return ${ret.return_no}? This cannot be undone.`)) return;
    try {
      await api.deleteReturn(ret.id);
      if (selectedHistoryReturn?.id === ret.id) handleClearHistorySelection();
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});
    } catch (err) {
      console.error('Failed to delete return:', err);
      alert('Failed to delete return');
    }
  };

  const handleEditHistoryReturn = async (ret: LocalReturnHistoryRow, e: React.MouseEvent) => {
    e.stopPropagation();
    await handleSelectHistoryReturn(ret);
    setIsEditingHistory(true);
  };

  const handleSaveHistoryEdit = async () => {
    if (!selectedHistoryReturn) return;
    setSaving(true);
    try {
      const validItems = editingItems.filter(i => i.medicine_id && (parseFloat(String(i.quantity)) || 0) > 0);
      const total = validItems.reduce((s, i) => s + (Number(i.cost_price) || 0) * (Number(i.quantity) || 0), 0);
      await api.updateReturn(selectedHistoryReturn.id, { items: validItems as unknown as Array<Record<string, unknown>>, total_amount: total });
      setIsEditingHistory(false);
      await handleSelectHistoryReturn(selectedHistoryReturn);
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});
    } catch (err) {
      console.error('Failed to save return:', err);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveMissing = async () => {
    if (!selectedHistoryReturn) return;
    setIsResolving(true);
    try {
      const response = await api.resolveReturnMissing(selectedHistoryReturn.id);
      const mapped = ((response || []) as LocalReturnItemRow[]).map((item): LocalEditableReturnItem => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity ?? '',
        cost_price: item.cost_price ?? '',
        mrp: item.mrp || 0,
        invoice_no: item.invoice_no || item.ret_invoice_no || 'N/A',
        purchase_date: item.purchase_date || item.ret_purchase_date || '',
        distributor_name: item.distributor_name || item.ret_distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || item.ret_distributor_id || undefined,
        _resolved_fields: item._resolved_fields || [],
      }));
      setEditingItems(mapped);
      setIsEditingHistory(true);
    } catch (err) {
      console.error('Failed to resolve missing data:', err);
      alert('Failed to auto-fill missing data');
    } finally {
      setIsResolving(false);
    }
  };

  // Sync items to active tab
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror active draft items into its tab
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      if (idx === -1) return prev;
      const t = prev[idx];
      if (t.items !== items) {
        const next = [...prev];
        next[idx] = {
          ...t,
          items: items
        };
        return next;
      }
      return prev;
    });
  }, [items, activeTabId]);

  // Persist to localStorage & dispatch real-time event for Expiry synchronization
  useEffect(() => {
    localStorage.setItem('returns_draft_tabs', JSON.stringify(tabs));
    window.dispatchEvent(new CustomEvent('returns-draft-changed'));
  }, [tabs]);

  // Clean up any potential legacy conflicting local storage keys to ensure robust cache
  useEffect(() => {
    localStorage.removeItem('returns_tabs');
    localStorage.removeItem('return_draft_tabs');
    localStorage.removeItem('returns_active_tab');
  }, []);

  useEffect(() => {
    localStorage.setItem('returns_active_tab_id', activeTabId);
  }, [activeTabId]);

  const switchTab = (newTabId: string) => {
    if (newTabId === activeTabId && !selectedHistoryReturn) return;
    const target = tabs.find(t => t.id === newTabId);
    if (target) {
      setItems(target.items || [createEmptyItem()]);
      setActiveTabId(newTabId);
      setSelectedHistoryReturn(null); // Clear selected history return!
    }
  };

  const addNewTab = () => {
    const nextNum = tabs.length + 1;
    const newId = 'tab_' + nowStamp();
    const newTab = {
      id: newId,
      name: `Return ${nextNum}`,
      items: [createEmptyItem()]
    };

    setTabs(prev => [...prev, newTab]);
    setItems([createEmptyItem()]);
    setActiveTabId(newId);
    setSelectedHistoryReturn(null); // Clear selected history return!
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    const filtered = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
      const fallback = filtered[filtered.length - 1];
      setItems(fallback.items || [createEmptyItem()]);
      setActiveTabId(fallback.id);
    }
    setTabs(filtered.map((t, idx) => ({
      ...t,
      name: t.name.startsWith('Return ') ? `Return ${idx + 1}` : t.name
    })));
  };

  // Filters
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [distributorFilter, setDistributorFilter] = useState('');
  const [searchFilterText, setSearchFilterText] = useState('');
  const queryClient = useQueryClient();
  const returnHistoryKey = ['return-history', dateFrom, dateTo, minAmount, maxAmount] as const;
  const { data: returnHistory = [], isLoading: loading, refetch: refetchHistory } = useApiQuery<LocalReturnHistoryRow[]>(
    returnHistoryKey,
    async () => {
      const params = {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        min_amount: minAmount ? parseFloat(minAmount) : undefined,
        max_amount: maxAmount ? parseFloat(maxAmount) : undefined,
      };
      const response = await api.getReturns(params);
      const list = (Array.isArray(response) ? response : (response.data || [])) as LocalReturnHistoryRow[];
      cachedReturnHistory = list;
      return list;
    },
    {
      initialData: cachedReturnHistory || undefined,
      staleTime: 10000,
    }
  );

  // Master active distributors directory
  const { data: masterDistributors = [] } = useApiQuery<LocalMasterDistributor[]>(
    ['distributors-list'],
    async () => {
      const res = await api.getDistributors();
      return (Array.isArray(res) ? res : (res?.data || [])) as LocalMasterDistributor[];
    },
    { staleTime: 30000 }
  );

  // P1 "events, not timers": history refetches ONLY when a return actually
  // happened (window events + SSE push) — no 10s polling of unchanged data.
  useEffect(() => {
    const handleStockWrite = () => {
      refetchHistory().catch(() => {});
    };

    window.addEventListener('stock-write-completed', handleStockWrite);
    window.addEventListener('sse-return-created', handleStockWrite);

    return () => {
      window.removeEventListener('stock-write-completed', handleStockWrite);
      window.removeEventListener('sse-return-created', handleStockWrite);
    };
  }, [refetchHistory]);

  const [showCamera, setShowCamera] = useState(false);
  const [cameraTargetIndex, setCameraTargetIndex] = useState<number | null>(null);


  // Edit history state
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [editingItems, setEditingItems] = useState<LocalEditableReturnItem[]>([]);
  const [isResolving, setIsResolving] = useState(false);

  // True when any loaded history item has null/zero batch, expiry, or cost
  const hasMissingData = historyReturnItems.some(
    i => !i.batch_no || !i.expiry_date || !(i.cost_price)
  );

  useEffect(() => {
    if (!manualToDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- default date-to only until user overrides
      setDateTo(getTodayString());
    }
  }, [manualToDate]);

  const handleDateFromChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateFrom('2020-01-01');
    } else {
      setDateFrom(val);
    }
  };

  const handleDateToChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateTo('2020-01-01');
    } else {
      setDateTo(val);
    }
  };

  const handleCameraScanResult = (result: { medicineInfo?: LocalCameraMedicineInfo }) => {
    if (cameraTargetIndex === null) return;
    const info = result.medicineInfo || {};
    const newItems = [...items];
    const item = newItems[cameraTargetIndex];

    if (info.potentialName) {
      item.medicine_name = info.potentialName;
    }
    if (info.batchNumber) {
      item.batch_no = info.batchNumber;
    }
    if (info.expiryDate) {
      item.expiry_date = formatExpiryToMMYY(info.expiryDate);
    }
    if (info.mrp) {
      item.mrp = info.mrp;
    }
    
    // Attempt auto-reconciliation/fetching distributor details from purchase history
    const resolveDetails = async () => {
      try {
        const res = await api.lookupPurchases(item.medicine_name, item.batch_no || undefined);
        const list = (Array.isArray(res) ? res : (res?.data || [])) as LocalPurchaseLookupRow[];
        if (list.length > 0) {
          const purchase = list[0];

          const existingIndex = items.findIndex(
            (it, idx) => idx !== cameraTargetIndex &&
              it.medicine_id === purchase.medicine_id &&
              (it.batch_no || '').trim().toLowerCase() === (purchase.batch_no || '').trim().toLowerCase()
          );

          if (existingIndex !== -1) {
            alert(`Scanned drug "${purchase.medicine_name}" (Batch: ${purchase.batch_no}) is already in your return cart!\n\nIncrementing quantity of the existing line.`);
            const updatedItems = [...items];
            const existingQty = numOr0(updatedItems[existingIndex].quantity);
            updatedItems[existingIndex].quantity = (existingQty + 1).toString();
            if (updatedItems.length > 1) {
              updatedItems.splice(cameraTargetIndex, 1);
            } else {
              updatedItems[cameraTargetIndex] = createEmptyItem();
            }
            setItems(updatedItems);
            return;
          }

          item.medicine_id = purchase.medicine_id;
          item.medicine_name = purchase.medicine_name;
          item.batch_no = purchase.batch_no || '';
          item.expiry_date = formatExpiryToMMYY(purchase.expiry_date || '');
          item.cost_price = purchase.cost_price ?? '';
          item.mrp = purchase.mrp ?? '';
          item.purchase_item_id = purchase.purchase_item_id || undefined;
          item.invoice_no = purchase.invoice_no || undefined;
          item.purchase_date = purchase.purchase_date || undefined;
          item.distributor_name = purchase.distributor_name || undefined;
          item.distributor_id = purchase.distributor_id || undefined;
        }
        setItems(newItems);
      } catch (err) {
        console.error('Failed to look up matching purchases for returns scan:', err);
      }
    };
    
    resolveDetails();
    setShowCamera(false);
    setCameraTargetIndex(null);
  };

  function createEmptyItem(): ReturnItem {
    return {
      id: generateUUID(),
      medicine_id: null,
      medicine_name: '',
      batch_no: '',
      expiry_date: '',
      quantity: '',
      cost_price: '',
      mrp: '',
    };
  }

  useEffect(() => {
    // Auto-prefill from Expiry page navigation or location state with robust property fallbacks
    const prefilledItems = location.state?.prefilledReturnItems;
    if (prefilledItems && Array.isArray(prefilledItems) && prefilledItems.length > 0) {
      const mappedItems: ReturnItem[] = prefilledItems.map((item: LocalExpiryPrefillRow) => ({
        id: String(item.id || item.medicine_id || generateUUID()),
        medicine_id: item.medicine_id || item.id || null,
        medicine_name: item.medicine_name || item.name || item.item_name || '',
        batch_no: item.batch_no || item.batch || '',
        expiry_date: formatExpiryToMMYY(item.expiry_date || item.expiry || ''),
        quantity: (item.quantity ?? item.pack_quantity ?? item.current_stock ?? item.stock_quantity ?? 1).toString(),
        cost_price: (item.cost_price ?? item.purchase_cost_price ?? item.purchase_cost ?? item.mrp ?? 0).toString(),
        mrp: (item.mrp ?? 0).toString(),
        purchase_item_id: item.purchase_item_id || undefined,
        invoice_no: item.invoice_no || item.purchase_invoice_no || undefined,
        purchase_date: item.purchase_date || undefined,
        distributor_name: item.distributor_name || item.supplier_name || item.distributor || undefined,
        distributor_id: item.distributor_id || item.supplier_id || undefined,
      }));

      // Append prefilled items without duplicating existing batch IDs
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot navigation hand-off prefill merge
      setItems(prev => {
        const existingKeys = new Set(prev.map(i => `${i.medicine_id}_${i.batch_no}`));
        const newUnique = mappedItems.filter(i => !existingKeys.has(`${i.medicine_id}_${i.batch_no}`));
        const nonEmptyExisting = prev.filter(i => i.medicine_name || i.medicine_id);
        return [...nonEmptyExisting, ...(newUnique.length > 0 ? newUnique : mappedItems)];
      });
    }
  }, [location.state]);

  // RQ re-fetches automatically when returnHistoryKey changes (dateFrom/dateTo/minAmount/maxAmount)

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchMedicines = useCallback((term: string, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (term.length < 2) {
      setSearchResults([]);
      setActiveSearchIndex(null);
      setSearchHighlightIndex(-1);
      return;
    }

    if (term.length === 2) {
      // Prefetch 2 characters in background, no dropdown
      setActiveSearchIndex(null);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await api.lookupPurchases(term);
          const raw = (Array.isArray(response) ? response : (response?.data || [])) as LocalPurchaseLookupRow[];
          setSearchResults(rankAndSortMedicines(raw, term));
          setSearchHighlightIndex(-1);
        } catch (error) {
          console.error('Error prefetching medicines:', error);
        }
      }, 150);
      return;
    }

    // >= 3 characters: show dropdown immediately
    setActiveSearchIndex(index);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await api.lookupPurchases(term);
        const raw = (Array.isArray(response) ? response : (response?.data || [])) as LocalPurchaseLookupRow[];
        setSearchResults(rankAndSortMedicines(raw, term));
        setSearchHighlightIndex(-1);
      } catch (error) {
        console.error('Error searching medicines:', error);
      }
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const selectMedicine = (purchase: LocalPurchaseLookupRow, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Check if this medicine batch is already in the return cart at another row
    const existingIndex = items.findIndex(
      (it, idx) => idx !== index && 
        it.medicine_id === purchase.medicine_id && 
        (it.batch_no || '').trim().toLowerCase() === (purchase.batch_no || '').trim().toLowerCase()
    );

    if (existingIndex !== -1) {
      alert(`"${purchase.medicine_name}" (Batch: ${purchase.batch_no}) is already in your return cart!\n\nIncrementing the quantity of the existing line.`);
      
      const newItems = [...items];
      const existingQty = numOr0(newItems[existingIndex].quantity);
      newItems[existingIndex].quantity = (existingQty + 1).toString();
      
      if (newItems.length > 1) {
        newItems.splice(index, 1);
      } else {
        newItems[index] = createEmptyItem();
      }

      setItems(newItems);
      setSearchResults([]);
      setActiveSearchIndex(null);
      setSearchHighlightIndex(-1);
      return;
    }

    const newItems = [...items];
    const item = newItems[index];

    item.medicine_id = purchase.medicine_id;
    item.medicine_name = purchase.medicine_name;
    item.batch_no = purchase.batch_no || '';
    item.expiry_date = formatExpiryToMMYY(purchase.expiry_date || '');
    item.cost_price = purchase.cost_price ?? '';
    item.mrp = purchase.mrp ?? '';
    item.purchase_item_id = purchase.purchase_item_id || undefined;
    item.invoice_no = purchase.invoice_no || undefined;
    item.purchase_date = purchase.purchase_date || undefined;
    item.distributor_name = purchase.distributor_name || undefined;
    item.distributor_id = purchase.distributor_id || undefined;

    setItems(newItems);
    setSearchResults([]);
    setActiveSearchIndex(null);
    setSearchHighlightIndex(-1);
  };

  const updateItem = (index: number, field: 'medicine_name' | 'batch_no' | 'expiry_date' | 'quantity' | 'cost_price', value: string, format = false) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'expiry_date') {
      item[field] = format ? formatExpiryToMMYY(value) : value;
    } else {
      item[field] = value;
    }

    setItems(newItems);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) {
      setItems([createEmptyItem()]);
      return;
    }
    setItems(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems([...items, createEmptyItem()]);
  };

  interface DraftGroup {
    key: string;
    distributor_id: number | null;
    distributor_name: string;
    invoice_no: string;
    purchase_date: string;
    items: { item: ReturnItem; originalIndex: number }[];
    total_amount: number;
  }

  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [distributorSidebarSearch, setDistributorSidebarSearch] = useState('');
  const [focusedDistributorKey, setFocusedDistributorKey] = useState<string | null>(null);

  const toggleCardCollapse = (key: string) => {
    setCollapsedCards(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const collapseAllCards = () => {
    const all = groupAllItemsByDistributor();
    const map: Record<string, boolean> = {};
    all.forEach(g => { map[g.key] = true; });
    setCollapsedCards(map);
  };

  const expandAllCards = () => {
    setCollapsedCards({});
  };

  const groupAllItemsByDistributor = (): DraftGroup[] => {
    const grouped: { [key: string]: DraftGroup } = {};

    items.forEach((item, index) => {
      const hasDist = Boolean(item.distributor_name || item.distributor_id);
      const key = hasDist
        ? `${item.distributor_id || 'name_' + item.distributor_name}_${item.invoice_no || 'N/A'}`
        : 'unassigned';

      const distName = hasDist ? (item.distributor_name || 'Unknown Supplier') : 'New / Unassigned Items';
      const invNo = hasDist ? (item.invoice_no || 'N/A') : 'Draft';
      const purchaseDate = item.purchase_date || '';

      const qty = numOr0(item.quantity);
      const costPrice = numOr0(item.cost_price);

      if (!grouped[key]) {
        grouped[key] = {
          key,
          distributor_id: item.distributor_id || null,
          distributor_name: distName,
          invoice_no: invNo,
          purchase_date: purchaseDate,
          items: [],
          total_amount: 0,
        };
      }

      grouped[key].items.push({ item, originalIndex: index });
      grouped[key].total_amount += costPrice * qty;
    });

    const result = Object.values(grouped);
    // Auto-Sort items in each distributor card by Expiry Urgency Rank then Expiry Date
    result.forEach(group => {
      group.items.sort((a, b) => {
        const statusA = getExpiryUrgencyStatus(a.item.expiry_date);
        const statusB = getExpiryUrgencyStatus(b.item.expiry_date);
        const rankA = statusA ? statusA.rank : 99;
        const rankB = statusB ? statusB.rank : 99;
        if (rankA !== rankB) return rankA - rankB;
        return (a.item.expiry_date || '').localeCompare(b.item.expiry_date || '');
      });
    });

    return result;
  };

  const processSingleGroup = async (group: DraftGroup) => {
    const validItems = group.items.filter(entry => {
      const qty = numOr0(entry.item.quantity);
      return entry.item.medicine_id && qty > 0;
    });

    if (validItems.length === 0) {
      alert(`Please add at least one valid medicine with quantity for ${group.distributor_name}`);
      return;
    }

    let lossPercentage: number | undefined = undefined;
    if (group.distributor_id) {
      const lossInput = window.prompt(
        `Enter agreed Distributor Return Loss / Deduction % for ${group.distributor_name} (0% to 100%, enter 0 for 100% full credit note claim):`,
        '0'
      );
      if (lossInput === null) return;
      lossPercentage = parseFloat(lossInput);
      if (isNaN(lossPercentage) || lossPercentage < 0 || lossPercentage > 100) {
        alert('Return percentage required: Please enter a valid number between 0 and 100.');
        return;
      }
    }

    setSaving(true);
    try {
      await api.processReturns(validItems.map(entry => ({
        medicine_id: entry.item.medicine_id,
        batch_no: entry.item.batch_no,
        quantity: numOr0(entry.item.quantity),
        cost_price: numOr0(entry.item.cost_price),
        mrp: numOr0(entry.item.mrp),
        distributor_id: group.distributor_id,
        invoice_no: group.invoice_no,
      })), lossPercentage);

      alert(`Successfully processed return for ${group.distributor_name} (${validItems.length} item(s))!`);
      
      const processedIndices = new Set(validItems.map(e => e.originalIndex));
      const remainingItems = items.filter((_, idx) => !processedIndices.has(idx));
      setItems(remainingItems.length > 0 ? remainingItems : [createEmptyItem()]);

      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
    } catch (error) {
      console.error('Error processing single return:', error);
      alert('Failed to process return for ' + group.distributor_name);
    } finally {
      setSaving(false);
    }
  };

  const exportSingleGroupPDF = async (group: DraftGroup) => {
    const validItems = group.items
      .map(e => e.item)
      .filter(item => numOr0(item.quantity) > 0);

    if (validItems.length === 0) {
      alert('No valid items with quantity to export for ' + group.distributor_name);
      return;
    }

    try {
      const parsedItemsForExport = validItems.map(item => ({
        ...item,
        quantity: numOr0(item.quantity),
        cost_price: numOr0(item.cost_price),
        mrp: numOr0(item.mrp)
      }));
      const blob = await api.exportReturnsPDF(parsedItemsForExport as unknown as ReadonlyArray<Record<string, unknown>>);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
        a.href = url;
        a.download = `return-${group.distributor_name}-${group.invoice_no}-${nowStamp()}.pdf`;
        document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF');
    }
  };

  const addItemToDistributorGroup = (group: DraftGroup) => {
    const newItem = createEmptyItem();
    if (group.distributor_name !== 'New / Unassigned Items') {
      newItem.distributor_name = group.distributor_name;
      newItem.distributor_id = group.distributor_id || undefined;
      newItem.invoice_no = group.invoice_no !== 'N/A' ? group.invoice_no : undefined;
    }
    setItems(prev => [...prev, newItem]);
  };

  const handleSelectDistributorFromSidebar = (dist: { id?: number; name: string }) => {
    const allGroups = groupAllItemsByDistributor();
    const existing = allGroups.find(g => 
      (dist.id && g.distributor_id === dist.id) || 
      g.distributor_name.toLowerCase() === dist.name.toLowerCase()
    );

    if (existing) {
      setCollapsedCards(prev => ({ ...prev, [existing.key]: false }));
      setFocusedDistributorKey(existing.key);
      setTimeout(() => {
        const elem = document.getElementById(`dist-card-${existing.key}`);
        if (elem) {
          elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    } else {
      // Automatically generate a new dedicated return card for this distributor!
      const newItem = createEmptyItem();
      newItem.distributor_id = dist.id || undefined;
      newItem.distributor_name = dist.name;
      newItem.invoice_no = 'N/A';

      const emptyUnassignedIdx = items.findIndex(i => !i.medicine_name && !i.distributor_name && !i.distributor_id);
      if (emptyUnassignedIdx !== -1 && items.length === 1) {
        setItems([newItem]);
      } else {
        setItems(prev => [...prev, newItem]);
      }

      const newKey = `${dist.id || 'name_' + dist.name}_N/A`;
      setCollapsedCards(prev => ({ ...prev, [newKey]: false }));
      setFocusedDistributorKey(newKey);
      setTimeout(() => {
        const elem = document.getElementById(`dist-card-${newKey}`);
        if (elem) {
          elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  };

  // Group items by distributor + invoice
  const groupItemsByInvoice = (): GroupedReturn[] => {
    const validItems = items.filter(item => {
      const qty = numOr0(item.quantity);
      return item.medicine_id && qty > 0;
    });
    
    const grouped: { [key: string]: GroupedReturn } = {};
    
    validItems.forEach(item => {
      // Create key from distributor + invoice to group
      const key = `${item.distributor_id}_${item.invoice_no}`;
      const qty = numOr0(item.quantity);
      const costPrice = numOr0(item.cost_price);
      
      if (!grouped[key]) {
        grouped[key] = {
          distributor_id: item.distributor_id || 0,
          distributor_name: item.distributor_name || 'Unknown',
          invoice_no: item.invoice_no || 'N/A',
          purchase_date: item.purchase_date || '',
          items: [],
          total_amount: 0,
        };
      }
      
      grouped[key].items.push(item);
      grouped[key].total_amount += costPrice * qty;
    });
    
    return Object.values(grouped);
  };

  const calculateGrandTotal = () => {
    return items
      .filter(item => {
        const qty = numOr0(item.quantity);
        return item.medicine_id && qty > 0;
      })
      .reduce((sum, item) => {
        const qty = numOr0(item.quantity);
        const costPrice = numOr0(item.cost_price);
        return sum + (costPrice * qty);
      }, 0);
  };

  const processReturn = async () => {
    const grouped = groupItemsByInvoice();
    
    if (grouped.length === 0) {
      alert('Please add at least one medicine with quantity');
      return;
    }

    const lossInput = window.prompt(
      'Enter agreed Distributor Return Loss / Deduction % (0% to 100%, enter 0 for 100% full credit note claim):',
      '0'
    );
    if (lossInput === null) return;
    const lossPercentage = parseFloat(lossInput);
    if (isNaN(lossPercentage) || lossPercentage < 0 || lossPercentage > 100) {
      alert('Return percentage required: Please enter a valid number between 0 and 100.');
      return;
    }

    setSaving(true);
    try {
      // Process each group separately (one return per distributor/invoice)
      for (const group of grouped) {
        await api.processReturns(group.items.map(item => ({
          medicine_id: item.medicine_id,
          batch_no: item.batch_no,
          quantity: numOr0(item.quantity),
          cost_price: numOr0(item.cost_price),
          mrp: numOr0(item.mrp),
          distributor_id: group.distributor_id,
          invoice_no: group.invoice_no,
        })), lossPercentage);
      }

      alert(`Successfully processed ${grouped.length} return(s)!`);
      setItems([createEmptyItem()]);
      setGroupedReturns([]);
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});
    } catch (error) {
      console.error('Error processing return:', error);
      alert('Failed to process return');
    } finally {
      setSaving(false);
    }
  };

  const exportPDF = async () => {
    const grouped = groupItemsByInvoice();
    if (grouped.length === 0) {
      alert('No items to export');
      return;
    }

    try {
      // Export each group as separate PDF
      for (const group of grouped) {
        const parsedItemsForExport = group.items.map(item => ({
          ...item,
          quantity: numOr0(item.quantity),
          cost_price: numOr0(item.cost_price),
          mrp: numOr0(item.mrp)
        }));
        const blob = await api.exportReturnsPDF(parsedItemsForExport);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
      a.download = `return-${group.distributor_name}-${group.invoice_no}-${nowStamp()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF');
    }
  };

  return (
    <div className="h-full flex flex-col fade-in relative overflow-hidden gap-3 p-4 text-text">
      {/* Premium Glassmorphic Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-3 px-5 shadow-sm shrink-0">
        {/* Title & Quick Stats */}
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm shrink-0">
            <RotateCcw size={22} className="animate-in spin-in-180 duration-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-text tracking-tight leading-none">Returns & Expiry Command Center</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                LIVE HUB
              </span>
            </div>
            <p className="text-[11px] text-muted font-medium mt-1">Manage supplier debit notes, near-expiry inventory alerts & customer claim processing</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/60 p-1.5 rounded-xl border border-border/60 overflow-x-auto scrollbar-none shadow-inner">
          {[
            { id: 'returns', label: 'Supplier Returns', icon: RotateCcw, count: tabs.length },
            { id: 'expiry', label: 'Expiry Monitor', icon: CalendarDays },
            { id: 'expiry-review', label: 'Expiry Return Review', icon: ShieldAlert, count: pendingReviewCount },
            { id: 'customer', label: 'Customer Returns', icon: Users },
            { id: 'customer-history', label: 'Return History', icon: History, count: returnHistory.length },
          ].map(t => {
            const Icon = t.icon;
            const isActive = currentTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSearchParams({ tab: t.id })}
                className={`flex items-center gap-2 px-3.5 py-1.5 font-bold text-sm rounded-lg transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-black shadow-md border border-border ring-1 ring-primary/20'
                    : 'text-muted hover:text-text hover:bg-bg3/90 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-primary animate-pulse' : 'text-muted'} />
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className={`text-xs px-1.5 py-0.2 rounded-full font-mono font-extrabold ${
                    isActive ? 'bg-primary/20 text-primary' : 'bg-bg/50 text-muted'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {currentTab === 'expiry' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4">
          <Expiry />
        </div>
      ) : currentTab === 'expiry-review' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4">
          <ExpiryReturnReview onPendingCountChange={setPendingReviewCount} />
        </div>
      ) : currentTab === 'customer' ? (
        <div className="flex-1 flex flex-col overflow-y-auto relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-5 custom-scrollbar">
          <CustomerReturn />
        </div>
      ) : currentTab === 'customer-history' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-4 gap-3">
          {/* Subtabs for Return History: Supplier Returns vs Customer Returns */}
          <div className="flex items-center justify-between pb-2 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-sm font-extrabold text-text uppercase tracking-wider">Return History Center</h2>
            </div>
            <div className="flex items-center gap-1 bg-bg3/80 p-1 rounded-xl border border-border/60">
              <button
                onClick={() => setHistorySubTab('supplier')}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  historySubTab === 'supplier'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
              >
                <RotateCcw size={13} />
                <span>Supplier Returns ({returnHistory.length})</span>
              </button>
              <button
                onClick={() => setHistorySubTab('customer')}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  historySubTab === 'customer'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Users size={13} />
                <span>Customer Returns</span>
              </button>
            </div>
          </div>

          {historySubTab === 'customer' ? (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <CustomerReturnHistory />
            </div>
          ) : (
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text relative">
              {/* Left Column: Supplier Return History List & Filters */}
              <div className="w-96 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-text">Finalized Supplier Returns</h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-primary border border-border/40 font-mono">
                      {returnHistory.length}
                    </span>
                  </div>
                </div>

                {/* Quick Search */}
                <div className="relative flex-shrink-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search return no, supplier..."
                    value={searchFilterText}
                    onChange={e => setSearchFilterText(e.target.value)}
                    className="w-full pl-8 pr-7 py-2 bg-bg3/80 border border-border/70 rounded-xl text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary/60 font-medium transition-all shadow-inner"
                  />
                  {searchFilterText && (
                    <button
                      onClick={() => setSearchFilterText('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-full"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Bar (Date, Distributor & Amount) */}
                <div className="p-2.5 bg-bg3/50 rounded-xl border border-border/60 space-y-2 text-[10px] flex-shrink-0 shadow-inner">
                  <div className="flex items-center gap-1.5">
                    <label className="text-muted font-semibold w-7">From</label>
                    <input
                      type="date"
                      value={toDateInputValue(dateFrom)}
                      min="2020-01-01"
                      max={getTodayString()}
                      onChange={e => handleDateFromChange(e.target.value)}
                      className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-mono focus:outline-none focus:border-primary/60"
                    />
                    <label className="text-muted font-semibold w-4 text-center">To</label>
                    <input
                      type="date"
                      value={toDateInputValue(dateTo)}
                      min="2020-01-01"
                      max={getTodayString()}
                      onChange={e => { setManualToDate(true); handleDateToChange(e.target.value); }}
                      className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-mono focus:outline-none focus:border-primary/60"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-muted font-semibold w-7">Min ₹</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="0"
                      value={minAmount}
                      onChange={e => setMinAmount(e.target.value)}
                      className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-mono focus:outline-none focus:border-primary/60"
                    />
                    <label className="text-muted font-semibold w-4 text-center">Max</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="∞"
                      value={maxAmount}
                      onChange={e => setMaxAmount(e.target.value)}
                      className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-mono focus:outline-none focus:border-primary/60"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <select
                      value={distributorFilter}
                      onChange={e => setDistributorFilter(e.target.value)}
                      className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-semibold focus:outline-none focus:border-primary/60"
                    >
                      <option value="">All Distributors</option>
                      {[...new Set(returnHistory.map(r => r.distributor_name).filter(Boolean))].map(d => (
                        <option key={String(d)} value={String(d)}>{String(d)}</option>
                      ))}
                    </select>
                    {(distributorFilter || minAmount || maxAmount || searchFilterText) && (
                      <button
                        onClick={() => { setDistributorFilter(''); setMinAmount(''); setMaxAmount(''); setSearchFilterText(''); }}
                        className="text-[9px] text-red hover:underline font-bold px-2 bg-red-500/10 border border-red-500/20 rounded-lg flex-shrink-0"
                      >✕ Clear</button>
                    )}
                  </div>
                </div>

                {/* Returns List */}
                <div className="space-y-1.5 flex-1 overflow-y-auto scrollbar-thin pr-0.5">
                  {loading ? (
                    <div className="flex items-center justify-center py-6 text-xs text-muted font-semibold gap-2">
                      <Loader2 size={16} className="animate-spin text-primary" />
                      Fetching History...
                    </div>
                  ) : returnHistory.filter(ret => {
                      const itemDate = ret.date ? ret.date.substring(0, 10) : '';
                      const matchesDate = (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
                      const matchesMin = !minAmount || (ret.total_amount || 0) >= Number(minAmount);
                      const matchesMax = !maxAmount || (ret.total_amount || 0) <= Number(maxAmount);
                      const matchesDist = !distributorFilter || ret.distributor_name === distributorFilter;
                      
                      let matchesText = true;
                      if (searchFilterText) {
                        const q = searchFilterText.toLowerCase();
                        const retNoMatch = (ret.return_no || '').toLowerCase().includes(q);
                        const distMatch = (ret.distributor_name || '').toLowerCase().includes(q);
                        matchesText = retNoMatch || distMatch;
                      }

                      return matchesDate && matchesMin && matchesMax && matchesDist && matchesText;
                    }).length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted/70 italic font-medium bg-bg3/20 rounded-xl border border-border/30 p-4">
                      No matching finalized supplier return entries found.
                    </div>
                  ) : (
                    returnHistory.filter(ret => {
                      const itemDate = ret.date ? ret.date.substring(0, 10) : '';
                      const matchesDate = (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
                      const matchesMin = !minAmount || (ret.total_amount || 0) >= Number(minAmount);
                      const matchesMax = !maxAmount || (ret.total_amount || 0) <= Number(maxAmount);
                      const matchesDist = !distributorFilter || ret.distributor_name === distributorFilter;

                      let matchesText = true;
                      if (searchFilterText) {
                        const q = searchFilterText.toLowerCase();
                        const retNoMatch = (ret.return_no || '').toLowerCase().includes(q);
                        const distMatch = (ret.distributor_name || '').toLowerCase().includes(q);
                        matchesText = retNoMatch || distMatch;
                      }

                      return matchesDate && matchesMin && matchesMax && matchesDist && matchesText;
                    }).map(ret => {
                      const isSelected = selectedHistoryReturn?.id === ret.id;
                      return (
                        <div 
                          key={ret.id} 
                          onClick={() => handleSelectHistoryReturn(ret)}
                          className={`p-2.5 rounded-xl border transition-all duration-200 flex flex-col gap-1 text-[10px] font-medium cursor-pointer select-none group/hist ${
                            isSelected 
                              ? 'bg-primary/10 border-primary text-text font-bold shadow-sm ring-1 ring-primary/30' 
                              : 'border-border/50 bg-bg3/30 hover:bg-bg3/70 hover:border-border'
                          }`}
                        >
                          <div className="flex justify-between items-center text-text font-bold">
                            <span className="font-mono text-xs text-text">{ret.return_no}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-emerald-500 font-extrabold font-mono text-xs">₹{ret.total_amount?.toFixed(2) || '0.00'}</span>
                              <button
                                onClick={(e) => handleEditHistoryReturn(ret, e)}
                                className="p-1 rounded-lg hover:bg-primary/20 text-muted hover:text-primary transition-colors flex-shrink-0"
                                title="Edit this return claim"
                                aria-label={`Edit return ${ret.return_no}`}
                              >
                                <Edit size={11} />
                              </button>
                              <button
                                onClick={(e) => handleDeleteReturn(ret, e)}
                                className="p-1 rounded-lg hover:bg-red/20 text-muted hover:text-red transition-colors flex-shrink-0"
                                title="Delete this return entry"
                                aria-label={`Delete return ${ret.return_no}`}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          {ret.distributor_name && (
                            <div className="text-[10px] text-muted truncate font-semibold flex items-center gap-1">
                              <span>🏭</span>
                              <span className="truncate">{ret.distributor_name}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-muted text-[9px] mt-0.5 font-medium">
                            <span className="font-mono">{ret.date ? ret.date.substring(0, 10) : 'N/A'}</span>
                            <span className="capitalize px-1.5 py-0.2 rounded-full text-[8px] bg-blue-500/10 text-blue-500 border border-blue-500/20 font-bold">
                              {ret.type || 'supplier'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Historical Return Inspector & Editor */}
              <div className="flex-1 flex flex-col gap-0 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl shadow-sm">
                {selectedHistoryReturn !== null ? (
                  <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden p-5">
                    {/* History Header */}
                    <div className="flex justify-between items-center border-b border-border/60 pb-3">
                      <div>
                        <h2 className="text-base font-bold text-text flex items-center gap-2">
                          {isEditingHistory && <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-lg font-bold">Editing</span>}
                          <span className="font-mono">{isEditingHistory ? 'Edit Return: ' : 'Finalized Return: '}{selectedHistoryReturn.return_no}</span>
                        </h2>
                        <p className="text-xs text-muted font-medium mt-0.5">
                          {isEditingHistory
                            ? 'Modify return quantities or purchase cost prices below, then click Save.'
                            : `Read-only return statement for ${selectedHistoryReturn.distributor_name || 'supplier'}.`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {isEditingHistory ? (
                          <>
                            <button
                              onClick={handleSaveHistoryEdit}
                              disabled={saving}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
                            >
                              {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                            <button
                              onClick={() => setIsEditingHistory(false)}
                              className="bg-bg3 border border-border/60 hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {hasMissingData && !isEditingHistory && (
                              <button
                                onClick={handleResolveMissing}
                                disabled={isResolving}
                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-60 cursor-pointer"
                                title="Auto-fill missing batch, expiry, cost from purchase history"
                              >
                                {isResolving
                                  ? <><Loader2 size={13} className="animate-spin" /> Resolving…</>
                                  : <><Wand2 size={13} /> Auto-fill Missing</>}
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                try {
                                  const blob = await api.exportReturnsPDF(historyReturnItems as unknown as ReadonlyArray<Record<string, unknown>>);
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `return-${selectedHistoryReturn.return_no}-${Date.now()}.pdf`;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                } catch (error) {
                                  console.error('Error exporting PDF:', error);
                                  toastEvent.trigger('Failed to export PDF.', 'error', '/returns');
                                }
                              }}
                              className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                            >
                              <FileText size={13} /> Export PDF
                            </button>
                            <button
                              onClick={() => { setEditingItems(historyReturnItems.map(i => ({ ...i, quantity: i.quantity ?? '', cost_price: i.cost_price ?? '', mrp: i.mrp ?? 0 }))); setIsEditingHistory(true); }}
                              className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Edit size={13} /> Edit
                            </button>
                            <button
                              onClick={handleClearHistorySelection}
                              className="bg-bg3 border border-border/60 hover:bg-bg3/80 text-text font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <span>Back</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Table Viewer / Editor */}
                    <div className="flex-1 overflow-auto bg-bg/40 rounded-2xl border border-border/60">
                      {loadingHistoryItems ? (
                        <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-muted">
                          <Loader2 className="animate-spin text-primary" size={32} />
                          <span className="text-xs font-bold">Loading finalized items...</span>
                        </div>
                      ) : isEditingHistory ? (
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 z-20 bg-bg2 border-b border-border/60 shadow-sm">
                            <tr className="text-left text-muted border-b border-border/60">
                              <th className="p-3 text-xs font-bold w-10">#</th>
                              <th className="p-3 text-xs font-bold min-w-[260px]">Medicine</th>
                              <th className="p-3 text-xs font-bold w-32">Batch</th>
                              <th className="p-3 text-xs font-bold w-32">Expiry</th>
                              <th className="p-3 text-xs font-bold w-24 text-center">Qty</th>
                              <th className="p-3 text-xs font-bold w-28 text-right">Cost Price</th>
                              <th className="p-3 text-xs font-bold w-28 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {editingItems.map((item, idx) => {
                              const rf: string[] = item._resolved_fields || [];
                              const hi = (f: string) => rf.includes(f)
                                ? 'ring-1 ring-amber-400 bg-amber-400/10'
                                : '';
                              return (
                                <tr key={item.id} className="border-b border-border/40 hover:bg-bg3/30 transition-colors">
                                  <td className="p-3 text-xs text-muted font-mono">{idx + 1}</td>
                                  <td className="p-3 text-xs font-bold text-text">{item.medicine_name}</td>
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      value={item.batch_no}
                                      onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, batch_no: e.target.value } : it))}
                                      className={`w-full bg-bg3 border border-border/60 rounded-lg px-2.5 py-1 text-xs text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary ${hi('batch_no')}`}
                                      placeholder="—"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      value={item.expiry_date}
                                      onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, expiry_date: e.target.value } : it))}
                                      className={`w-full bg-bg3 border border-border/60 rounded-lg px-2.5 py-1 text-xs text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary ${hi('expiry_date')}`}
                                      placeholder="MM/YY"
                                    />
                                  </td>
                                  <td className="p-2 text-center">
                                    <input
                                      type="number"
                                      min="0"
                                      value={item.quantity}
                                      onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))}
                                      className="w-20 bg-bg3 border border-border/60 rounded-lg px-2 py-1 text-xs text-text text-center font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                  </td>
                                  <td className="p-2 text-right">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={item.cost_price}
                                      onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, cost_price: parseFloat(e.target.value) || 0 } : it))}
                                      className={`w-24 bg-bg3 border border-border/60 rounded-lg px-2 py-1 text-xs text-text font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary ${hi('cost_price')}`}
                                    />
                                  </td>
                                  <td className="p-3 text-xs text-text font-bold font-mono text-right">
                                    ₹{(Number(item.cost_price || 0) * Number(item.quantity || 0)).toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="sticky bottom-0 bg-bg2 border-t border-border/60">
                            <tr>
                              <td colSpan={6} className="p-3 text-xs font-bold text-text text-right">Updated Claim Total:</td>
                              <td className="p-3 text-sm font-black text-emerald-500 font-mono text-right">
                                ₹{editingItems.reduce((s, i) => s + Number(i.cost_price || 0) * Number(i.quantity || 0), 0).toFixed(2)}
                              </td>
                            </tr>
                            {editingItems.some(i => (i._resolved_fields || []).length > 0) && (
                              <tr>
                                <td colSpan={7} className="px-3 py-1.5 bg-amber-500/10 border-t border-amber-500/20">
                                  <div className="flex items-center gap-2 text-[10px] text-amber-500 font-bold">
                                    <span className="inline-block w-3 h-3 rounded bg-amber-400/40 ring-1 ring-amber-400 flex-shrink-0" />
                                    Highlighted cells were auto-resolved from purchase history. Please verify before saving.
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tfoot>
                        </table>
                      ) : historyReturnItems.length === 0 ? (
                        <div className="text-center py-12 text-muted text-xs italic font-medium">No items recorded for this return claim.</div>
                      ) : (
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 z-20 bg-bg2 border-b border-border/60 shadow-sm">
                            <tr className="text-left text-muted border-b border-border/60">
                              <th className="p-3.5 text-xs font-bold w-12">#</th>
                              <th className="p-3.5 text-xs font-bold min-w-[240px]">Medicine Name</th>
                              <th className="p-3.5 text-xs font-bold w-32">Batch</th>
                              <th className="p-3.5 text-xs font-bold w-28">Expiry</th>
                              <th className="p-3.5 text-xs font-bold w-20 text-center">Qty</th>
                              <th className="p-3.5 text-xs font-bold w-28 text-right">Cost Price</th>
                              <th className="p-3.5 text-xs font-bold w-28 text-right">Total</th>
                              <th className="p-3.5 text-xs font-bold w-36 text-center">Invoice Ref</th>
                              <th className="p-3.5 text-xs font-bold min-w-[160px]">Distributor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyReturnItems.map((item, index) => (
                              <tr key={item.id} className="border-b border-border/40 hover:bg-bg3/30 transition-colors">
                                <td className="p-3.5 text-xs text-muted font-mono">{index + 1}</td>
                                <td className="p-3.5 text-xs font-bold text-text">{item.medicine_name}</td>
                                <td className="p-3.5 text-xs font-mono text-muted font-semibold">{item.batch_no || '—'}</td>
                                <td className="p-3.5 text-xs font-mono text-muted">{item.expiry_date || '—'}</td>
                                <td className="p-3.5 text-xs font-bold text-text text-center font-mono">{item.quantity ?? '—'}</td>
                                <td className="p-3.5 text-xs text-text font-mono text-right">
                                  {item.cost_price != null ? `₹${Number(item.cost_price || 0).toFixed(2)}` : '—'}
                                </td>
                                <td className="p-3.5 text-xs text-text font-extrabold font-mono text-right">
                                  {item.cost_price != null && item.quantity != null
                                    ? `₹${(Number(item.cost_price || 0) * Number(item.quantity || 0)).toFixed(2)}`
                                    : '—'}
                                </td>
                                <td className="p-3.5 text-center">
                                  <span className="px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg text-[10px] font-bold font-mono">
                                    {item.invoice_no || 'N/A'}
                                  </span>
                                </td>
                                <td className="p-3.5 text-xs text-muted font-semibold truncate max-w-[180px]">
                                  {item.distributor_name || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      <History size={28} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-text">Select a Return Claim</h3>
                      <p className="text-xs text-muted mt-1 max-w-sm">
                        Choose any finalized supplier return from the left list to review returned medicines, batches, quantities, reprint debit notes, or edit.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text relative">
          {/* Left Sidebar Panel: Returns & Drafts Hub (Focused purely on active return creation) */}
          <div className="w-80 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm">
            
            {/* Header & New Return button */}
            <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-wider text-text">Returns & Drafts Hub</h2>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-primary border border-border/40 font-mono">
                  {tabs.length}
                </span>
              </div>
              <button
                onClick={addNewTab}
                className="flex items-center justify-center px-2.5 py-1.5 rounded-xl border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-all bg-primary/5 active:scale-95 shadow-sm cursor-pointer"
                title="Add New Supplier Return Draft"
              >
                <Plus size={14} className="mr-1" />
                <span className="text-[11px] font-bold">New Draft</span>
              </button>
            </div>

            {/* Quick Search Input for Draft Items */}
            <div className="relative flex-shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Filter draft items..."
                value={searchFilterText}
                onChange={e => setSearchFilterText(e.target.value)}
                className="w-full pl-8 pr-7 py-2 bg-bg3/80 border border-border/70 rounded-xl text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary/60 font-medium transition-all shadow-inner"
              />
              {searchFilterText && (
                <button
                  onClick={() => setSearchFilterText('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-full"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Active Drafts Tabs List */}
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1 scrollbar-thin space-y-2">
              {tabs.filter(t => {
                if (!searchFilterText) return true;
                const q = searchFilterText.toLowerCase();
                const nameMatch = t.name.toLowerCase().includes(q);
                const itemMatch = (t.items || []).some(i => 
                  (i.medicine_name || '').toLowerCase().includes(q) ||
                  (i.distributor_name || '').toLowerCase().includes(q) ||
                  (i.invoice_no || '').toLowerCase().includes(q)
                );
                return nameMatch || itemMatch;
              }).map((t) => {
                const isActive = t.id === activeTabId;
                const count = t.items ? t.items.length : 0;
                const firstDistributor = t.items ? t.items.find(item => item.distributor_name)?.distributor_name : null;
                const displayName = firstDistributor ? `Ret: ${firstDistributor}` : t.name;
                
                const tabTotal = (t.items || []).reduce((sum, item) => {
                  const qty = numOr0(item.quantity);
                  const costPrice = numOr0(item.cost_price);
                  return sum + (costPrice * qty);
                }, 0);

                return (
                  <div
                    key={t.id}
                    onClick={() => switchTab(t.id)}
                    className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all duration-200 select-none cursor-pointer relative shadow-sm ${
                      isActive 
                        ? 'bg-primary/10 border-primary text-text font-bold ring-1 ring-primary/30' 
                        : 'bg-bg3/40 border-border/50 text-muted hover:text-text hover:bg-bg3/80 hover:border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-1 rounded-md ${isActive ? 'bg-primary/20 text-primary' : 'bg-bg/60 text-muted'}`}>
                          <RotateCcw size={12} />
                        </div>
                        <span className="truncate text-xs font-bold text-text">{displayName}</span>
                      </div>
                      {tabs.length > 1 && (
                        <button 
                          onClick={(e) => closeTab(t.id, e)}
                          className="hover:bg-red/10 rounded-lg p-1 transition-all text-muted hover:text-red flex-shrink-0"
                          title="Close Tab"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-semibold mt-0.5">
                      <span className="px-2 py-0.5 rounded-full bg-bg3/80 border border-border/40 text-muted font-mono">
                        {count} {count === 1 ? 'item' : 'items'}
                      </span>
                      <span className="text-emerald-500 font-extrabold text-xs font-mono">₹{tabTotal.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Link to Return History */}
            <div className="border-t border-border/60 pt-2.5 mt-auto">
              <button
                onClick={() => {
                  setSearchParams({ tab: 'customer-history' });
                  setHistorySubTab('supplier');
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-bg3/60 hover:bg-bg3 border border-border/70 text-text transition-all text-xs font-bold cursor-pointer group shadow-sm"
                title="Open Return History Center"
              >
                <div className="flex items-center gap-2">
                  <History size={14} className="text-primary group-hover:scale-110 transition-transform" />
                  <span>Supplier Return History</span>
                </div>
                <span className="text-[10px] text-primary font-mono font-bold bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                  {returnHistory.length}
                </span>
              </button>
            </div>
          </div>

          {/* Right Content Workspace: Active Draft Editor — Multi-Distributor Auto-Cards + Right Sidebar Navigation */}
          <div className="flex-1 flex gap-0 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl shadow-sm">
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text p-4">
              {/* Center / Left: Cards List Workspace */}
              <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
                  
                  {/* Workspace Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg3/40 p-4 rounded-2xl border border-border/70 shrink-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-extrabold text-text uppercase tracking-wider flex items-center gap-2">
                          <Layers size={16} className="text-primary" />
                          <span>Supplier Return Cards Workspace</span>
                        </h2>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 font-mono">
                          {groupAllItemsByDistributor().length} Card{groupAllItemsByDistributor().length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-xs text-muted font-medium mt-1">
                        Medicines are automatically grouped into separate distributor cards. Review or process each supplier card independently below.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={expandAllCards}
                        className="px-2.5 py-1.5 rounded-xl bg-bg border border-border/70 text-text hover:bg-bg3 text-[11px] font-semibold transition-all cursor-pointer"
                        title="Expand all cards"
                      >
                        Expand All
                      </button>
                      <button
                        onClick={collapseAllCards}
                        className="px-2.5 py-1.5 rounded-xl bg-bg border border-border/70 text-text hover:bg-bg3 text-[11px] font-semibold transition-all cursor-pointer"
                        title="Collapse all cards"
                      >
                        Collapse All
                      </button>
                      <button
                        onClick={addItem}
                        className="bg-primary hover:bg-primary/95 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                      >
                        <Plus size={14} />
                        <span>Add Row</span>
                      </button>
                    </div>
                  </div>

                  {/* Multi-Distributor Auto-Cards Render */}
                  {groupAllItemsByDistributor()
                    .filter(group => {
                      if (!focusedDistributorKey) return true;
                      return group.key === focusedDistributorKey;
                    })
                    .map(group => {
                      const isCollapsed = Boolean(collapsedCards[group.key]);
                      const validCount = group.items.filter(e => (numOr0(e.item.quantity)) > 0).length;

                      return (
                        <div
                          key={group.key}
                          id={`dist-card-${group.key}`}
                          className={`flex flex-col rounded-2xl border transition-all duration-300 shadow-sm overflow-hidden ${
                            focusedDistributorKey === group.key
                              ? 'bg-bg border-primary ring-2 ring-primary/40'
                              : 'bg-bg border-border/80 hover:border-border'
                          }`}
                        >
                          {/* Card Top Banner Header */}
                          <div
                            onClick={() => toggleCardCollapse(group.key)}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-bg3/40 border-b border-border/60 cursor-pointer select-none hover:bg-bg3/70 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                className="p-1 rounded-lg bg-bg border border-border/60 text-muted hover:text-text transition-colors"
                              >
                                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                              </button>
                              
                              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                <Building2 size={18} />
                              </div>

                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-extrabold text-text tracking-tight">
                                    {group.distributor_name}
                                  </h3>
                                  {group.invoice_no && group.invoice_no !== 'N/A' && (
                                    <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[10px] font-extrabold">
                                      Invoice #{group.invoice_no}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-muted font-medium mt-0.5">
                                  <span>{group.items.length} Row{group.items.length !== 1 ? 's' : ''} ({validCount} valid)</span>
                                  {group.purchase_date && (
                                    <>
                                      <span>•</span>
                                      <span>Date: {group.purchase_date.substring(0, 10)}</span>
                                    </>
                                  )}
                                </div>
                                {(() => {
                                  const medNames = group.items.map(i => i.item.medicine_name).filter(Boolean);
                                  return medNames.length > 0 ? (
                                    <div className="text-[11px] text-primary font-semibold mt-1 flex items-center gap-1 truncate max-w-lg">
                                      <span>💊 Medicines:</span>
                                      <span className="truncate font-medium text-text">{medNames.join(', ')}</span>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-muted/60 italic font-medium mt-0.5">
                                      No medicines added yet — type or scan to add medicines
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>

                            {/* Card Header Actions & Subtotal */}
                            <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                              <div className="text-right mr-1">
                                <div className="text-[10px] text-muted uppercase font-bold tracking-wider">Subtotal Claim</div>
                                <div className="text-base font-black text-emerald-500 font-mono">
                                  ₹{group.total_amount.toFixed(2)}
                                </div>
                              </div>

                              <button
                                onClick={() => exportSingleGroupPDF(group)}
                                disabled={validCount === 0}
                                className="p-2 px-3 rounded-xl bg-purple-600/10 border border-purple-500/30 text-purple-400 hover:bg-purple-600 hover:text-white transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                title="Export PDF debit note for this distributor"
                              >
                                <FileText size={13} />
                                <span className="hidden md:inline">PDF</span>
                              </button>

                              <button
                                onClick={() => processSingleGroup(group)}
                                disabled={saving || validCount === 0}
                                className="p-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-40 cursor-pointer active:scale-95"
                                title="Process return for this supplier only"
                              >
                                <RotateCcw size={13} />
                                <span>Process Card</span>
                              </button>
                            </div>
                          </div>

                          {/* Card Items Table Body */}
                          {!isCollapsed && (
                            <div className="flex-1 flex flex-col p-4 gap-3 bg-bg/30">
                              <div className="overflow-x-auto rounded-xl border border-border/60 shadow-inner">
                                <table className="w-full text-left border-collapse min-w-[700px]">
                                  <thead className="bg-bg2/90 border-b border-border/60">
                                    <tr className="text-muted text-[11px] font-bold">
                                      <th className="p-2.5 w-10 text-center">#</th>
                                      <th className="p-2.5 min-w-[220px]">Medicine Name</th>
                                      <th className="p-2.5 w-28">Batch No</th>
                                      <th className="p-2.5 w-28">Expiry</th>
                                      <th className="p-2.5 w-20 text-center">Qty</th>
                                      <th className="p-2.5 w-24 text-right">Cost Price</th>
                                      <th className="p-2.5 w-24 text-right">Total</th>
                                      <th className="p-2.5 w-10 text-center"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.items.map(({ item, originalIndex }, localIdx) => (
                                      <tr key={item.id} className="border-b border-border/40 hover:bg-bg3/30 transition-colors text-xs">
                                        <td className="p-2.5 text-center font-mono text-muted text-[10px]">{localIdx + 1}</td>
                                        
                                        {/* Medicine Name Search */}
                                        <td className="p-2">
                                          <div ref={activeSearchIndex === originalIndex ? activeSearchRef : null} className="relative">
                                            <div className="flex gap-1 items-center">
                                              <input
                                                type="text"
                                                value={item.medicine_name}
                                                onChange={(e) => {
                                                  updateItem(originalIndex, 'medicine_name', e.target.value);
                                                  searchMedicines(e.target.value, originalIndex);
                                                }}
                                                className="w-full bg-bg3 border border-border/60 rounded-lg px-2.5 py-1.5 text-text font-bold text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                                placeholder="Type 2+ chars to search..."
                                              />
                                              <button
                                                onClick={() => {
                                                  setCameraTargetIndex(originalIndex);
                                                  setShowCamera(true);
                                                }}
                                                className="bg-sky/15 hover:bg-sky/30 border border-sky/30 text-sky w-7 h-7 rounded-lg text-xs flex-shrink-0 flex items-center justify-center transition-all cursor-pointer"
                                                title="Scan drug package using AI Camera"
                                              >
                                                <Camera size={13} />
                                              </button>
                                            </div>
                                            {activeSearchIndex === originalIndex && searchResults.length > 0 && (
                                              <div ref={searchResultsRef} className="absolute z-30 w-full mt-1 bg-bg2 border border-border rounded-xl shadow-xl max-h-56 overflow-y-auto">
                                                {searchResults.map((result, idx) => (
                                                  <button
                                                    key={result.purchase_item_id}
                                                    type="button"
                                                    data-highlighted={idx === searchHighlightIndex ? "true" : "false"}
                                                    onClick={() => selectMedicine(result, originalIndex)}
                                                    className={`w-full text-left px-3 py-2 hover:bg-bg3 text-text text-xs border-b border-border/30 last:border-0 cursor-pointer transition-colors ${idx === searchHighlightIndex ? 'bg-primary/10 border-l-4 border-primary' : ''}`}
                                                  >
                                                    <div className="font-bold text-text">{result.medicine_name}</div>
                                                    <div className="text-[10px] text-muted font-mono mt-0.5">
                                                      Batch: <span className="font-bold text-text">{result.batch_no}</span> | Cost: ₹{result.cost_price} | {result.distributor_name}
                                                    </div>
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </td>

                                        {/* Batch */}
                                        <td className="p-2">
                                          <input
                                            type="text"
                                            value={item.batch_no}
                                            onChange={(e) => updateItem(originalIndex, 'batch_no', e.target.value)}
                                            className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                            placeholder="Batch"
                                          />
                                        </td>

                                        {/* Expiry */}
                                        <td className="p-2">
                                          <div className="flex flex-col gap-1">
                                            <input
                                              type="text"
                                              value={item.expiry_date}
                                              onChange={(e) => updateItem(originalIndex, 'expiry_date', e.target.value, false)}
                                              onBlur={(e) => updateItem(originalIndex, 'expiry_date', e.target.value, true)}
                                              className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                                              placeholder="MM/YY"
                                            />
                                            {(() => {
                                              const st = getExpiryUrgencyStatus(item.expiry_date);
                                              return st ? (
                                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border text-center font-mono ${st.className}`}>
                                                  {st.label}
                                                </span>
                                              ) : null;
                                            })()}
                                          </div>
                                        </td>

                                        {/* Qty */}
                                        <td className="p-2">
                                          <div className="flex items-center gap-1 justify-center">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const current = numOr0(item.quantity);
                                                if (current > 0) updateItem(originalIndex, 'quantity', (current - 1).toString());
                                              }}
                                              className="w-6 h-7 rounded bg-bg3 border border-border/60 text-muted hover:text-text hover:bg-bg2 font-bold text-xs flex items-center justify-center cursor-pointer transition-colors"
                                              title="Decrease quantity"
                                            >
                                              -
                                            </button>
                                            <input
                                              type="number"
                                              value={item.quantity}
                                              onChange={(e) => updateItem(originalIndex, 'quantity', e.target.value)}
                                              className="w-14 bg-bg3 border border-border/60 rounded-lg px-1 py-1.5 text-text font-mono text-xs text-center focus:ring-1 focus:ring-primary focus:outline-none"
                                              min="0"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const current = numOr0(item.quantity);
                                                updateItem(originalIndex, 'quantity', (current + 1).toString());
                                              }}
                                              className="w-6 h-7 rounded bg-bg3 border border-border/60 text-muted hover:text-text hover:bg-bg2 font-bold text-xs flex items-center justify-center cursor-pointer transition-colors"
                                              title="Increase quantity"
                                            >
                                              +
                                            </button>
                                          </div>
                                        </td>

                                        {/* Cost */}
                                        <td className="p-2">
                                          <input
                                            type="number"
                                            value={item.cost_price}
                                            onChange={(e) => updateItem(originalIndex, 'cost_price', e.target.value)}
                                            className="w-full bg-bg3 border border-border/60 rounded-lg px-2 py-1.5 text-text font-mono text-xs text-right focus:ring-1 focus:ring-primary focus:outline-none"
                                            min="0"
                                          />
                                        </td>

                                        {/* Total */}
                                        <td className="p-2.5 text-text font-extrabold text-xs font-mono text-right">
                                          ₹{(numOr0(item.cost_price) * numOr0(item.quantity)).toFixed(2)}
                                        </td>

                                        {/* Remove */}
                                        <td className="p-2 text-center">
                                          <button
                                            onClick={() => removeItem(originalIndex)}
                                            className="text-red/80 hover:text-red p-1 hover:bg-red/10 rounded transition-all cursor-pointer"
                                            title="Remove Row"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="flex justify-between items-center pt-1">
                                <button
                                  onClick={() => addItemToDistributorGroup(group)}
                                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                                >
                                  <Plus size={13} /> Add item to {group.distributor_name}
                                </button>
                                <span className="text-[11px] text-muted font-medium">
                                  Card Subtotal: <strong className="text-emerald-500 font-mono">₹{group.total_amount.toFixed(2)}</strong>
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {/* Bottom Master Actions Bar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg3/60 p-4 rounded-2xl border border-border/70 shadow-sm shrink-0 mt-2">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted font-bold">Total Return Claim Across All Suppliers:</span>
                        <span className="text-xl font-black text-emerald-500 font-mono">
                          ₹{calculateGrandTotal().toFixed(2)}
                        </span>
                      </div>
                      <div className="h-4 w-[1px] bg-border/60 hidden sm:block" />
                      <span className="text-[11px] text-muted font-semibold hidden sm:block">
                        {items.filter(i => (numOr0(i.quantity)) > 0).length} items across {groupAllItemsByDistributor().length} supplier card{groupAllItemsByDistributor().length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        onClick={exportPDF}
                        disabled={groupItemsByInvoice().length === 0}
                        className="flex-1 sm:flex-none bg-purple-600/90 hover:bg-purple-600 text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                      >
                        <FileText size={14} />
                        <span>Export All PDF Statements</span>
                      </button>
                      <button
                        onClick={processReturn}
                        disabled={saving || groupItemsByInvoice().length === 0}
                        className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                      >
                        <RotateCcw size={14} />
                        <span>{saving ? 'Processing Returns…' : 'Process All Returns'}</span>
                      </button>
                    </div>
                  </div>

                </div>

                {/* Right-Side Sidebar: Distributor Navigation & Quick Actions */}
                <div className="w-72 flex-shrink-0 flex flex-col gap-3 min-h-0 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-primary" />
                      <h3 className="text-xs font-black uppercase tracking-wider text-text">Distributors Nav</h3>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                      {groupAllItemsByDistributor().length}
                    </span>
                  </div>

                  {/* Sidebar Distributor Search */}
                  <div className="relative flex-shrink-0">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      placeholder="Filter distributors..."
                      value={distributorSidebarSearch}
                      onChange={e => setDistributorSidebarSearch(e.target.value)}
                      className="w-full pl-7 pr-6 py-1.5 bg-bg3/80 border border-border/70 rounded-xl text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-primary font-medium"
                    />
                    {distributorSidebarSearch && (
                      <button
                        onClick={() => setDistributorSidebarSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Focused Filter Clear Badge */}
                  {focusedDistributorKey && (
                    <div className="flex items-center justify-between p-2 rounded-xl bg-primary/10 border border-primary/30 text-xs">
                      <span className="text-primary font-bold text-[10px] truncate">Focusing 1 Card</span>
                      <button
                        onClick={() => setFocusedDistributorKey(null)}
                        className="text-[10px] text-primary hover:underline font-extrabold cursor-pointer"
                      >
                        Show All
                      </button>
                    </div>
                  )}

                  {/* Distributors List Cards Nav (Master Active Directory + Active Draft Cards) */}
                  <div className="flex-1 overflow-y-auto pr-0.5 space-y-2 custom-scrollbar">
                    {(() => {
                      const activeGroups = groupAllItemsByDistributor();
                      const activeDistNames = new Set(activeGroups.map(g => g.distributor_name.toLowerCase()));

                      const sidebarEntries: Array<{
                        id: string;
                        distributor_id?: number;
                        distributor_name: string;
                        invoice_no?: string;
                        group?: DraftGroup;
                      }> = [];

                      // 1. Add ALL active card groups (each invoice card gets its own distinct entry!)
                      activeGroups.forEach(g => {
                        sidebarEntries.push({
                          id: `active_card_${g.key}`,
                          distributor_id: g.distributor_id || undefined,
                          distributor_name: g.distributor_name,
                          invoice_no: g.invoice_no,
                          group: g,
                        });
                      });

                      // 2. Add master active distributors from DB that have no active cards yet
                      masterDistributors.forEach(d => {
                        const distName = d.name || 'Unknown';
                        if (!activeDistNames.has(distName.toLowerCase())) {
                          sidebarEntries.push({
                            id: `master_dist_${d.id || distName}`,
                            distributor_id: d.id,
                            distributor_name: distName,
                            invoice_no: undefined,
                            group: undefined,
                          });
                        }
                      });

                      return sidebarEntries
                        .filter(entry => !distributorSidebarSearch || entry.distributor_name.toLowerCase().includes(distributorSidebarSearch.toLowerCase()))
                        .map(entry => {
                          const g = entry.group;
                          const isFocused = g && focusedDistributorKey === g.key;
                          const validItemCount = g ? g.items.filter(e => (numOr0(e.item.quantity)) > 0).length : 0;
                          
                          // Inline preview of medicine names inside this card
                          const medNames = g
                            ? g.items.map(it => it.item.medicine_name).filter(Boolean)
                            : [];
                          const medPreviewText = medNames.length > 0
                            ? medNames.slice(0, 2).join(', ') + (medNames.length > 2 ? '...' : '')
                            : '';

                          return (
                            <div
                              key={entry.id}
                              onClick={() => {
                                if (g) {
                                  setCollapsedCards(prev => ({ ...prev, [g.key]: false }));
                                  setFocusedDistributorKey(isFocused ? null : g.key);
                                  const elem = document.getElementById(`dist-card-${g.key}`);
                                  if (elem) {
                                    elem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                  }
                                } else {
                                  handleSelectDistributorFromSidebar({ id: entry.distributor_id, name: entry.distributor_name });
                                }
                              }}
                              className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-1.5 text-xs select-none ${
                                isFocused
                                  ? 'bg-primary/15 border-primary text-text font-bold ring-1 ring-primary/40'
                                  : g
                                    ? 'bg-bg3/60 border-primary/40 hover:bg-bg3 text-text shadow-sm'
                                    : 'bg-bg3/20 border-border/40 hover:bg-bg3/60 hover:border-border text-muted hover:text-text'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-extrabold text-text truncate text-xs flex items-center gap-1.5">
                                  <Building2 size={13} className={g ? "text-primary shrink-0" : "text-muted shrink-0"} />
                                  <span className="truncate">{entry.distributor_name}</span>
                                </div>
                                {g ? (
                                  <span className="text-[10px] font-mono text-emerald-500 font-extrabold shrink-0">
                                    ₹{g.total_amount.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 shrink-0 hover:bg-purple-500/20">
                                    + Open Card
                                  </span>
                                )}
                              </div>

                              {/* Medicine List Preview */}
                              {medPreviewText && (
                                <div className="text-[10px] text-primary/90 font-semibold truncate flex items-center gap-1">
                                  <span>💊</span>
                                  <span className="truncate">{medPreviewText}</span>
                                </div>
                              )}

                              <div className="flex items-center justify-between text-[10px] text-muted font-medium">
                                <span className="font-mono truncate">
                                  {entry.invoice_no && entry.invoice_no !== 'N/A' ? `Inv #${entry.invoice_no}` : (g ? 'Draft Card' : 'Active Supplier')}
                                </span>
                                {g ? (
                                  <span className="px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20 font-bold shrink-0">
                                    {validItemCount} item{validItemCount !== 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-muted font-medium italic">Click to create card</span>
                                )}
                              </div>
                            </div>
                          );
                        });
                    })()}
                  </div>

                  {/* Sidebar Bottom Quick Add */}
                  <div className="border-t border-border/60 pt-2.5">
                    <button
                      onClick={addItem}
                      className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 p-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Plus size={14} />
                      <span>Add New Draft Item</span>
                    </button>
                  </div>

                </div>
              </div>
          </div>
        </div>
      )}
      {showCamera && (
        <AICamera 
          onClose={() => { setShowCamera(false); setCameraTargetIndex(null); }}
          onScanResult={handleCameraScanResult}
        />
      )}
    </div>
  );
};

export default Returns;
