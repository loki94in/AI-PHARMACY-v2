import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useLocation } from 'react-router-dom';
import { api, apiClient } from '../../services/api';
import { RotateCcw, Plus, Trash2, Search, FileText, AlertTriangle, Package, Camera, X, Loader2, Edit, Wand2 } from 'lucide-react';
import AICamera from '../../components/AICamera';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Expiry from '../Expiry';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import CustomerReturn from '../CustomerReturn';
import CustomerReturnHistory from '../CustomerReturnHistory';
import { CalendarDays, Users, History } from 'lucide-react';

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

const getInitialReturnsActiveTabId = (initialTabs: any[]) => {
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



let cachedReturnHistory: any[] | null = null;

const Returns: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'returns';
  const location = useLocation();

  const initialTabs = getInitialReturnsTabs();
  const initialActiveTabId = getInitialReturnsActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [tabs, setTabs] = useState<any[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  const [items, setItems] = useState<ReturnItem[]>(initialActiveTab.items || []);
  const [saving, setSaving] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
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
  const [groupedReturns, setGroupedReturns] = useState<GroupedReturn[]>([]);

  const [selectedHistoryReturn, setSelectedHistoryReturn] = useState<any | null>(null);
  const [historyReturnItems, setHistoryReturnItems] = useState<any[]>([]);
  const [loadingHistoryItems, setLoadingHistoryItems] = useState(false);

  const handleSelectHistoryReturn = async (ret: any) => {
    setSelectedHistoryReturn(ret);
    setLoadingHistoryItems(true);
    setIsEditingHistory(false);
    try {
      const response = await api.getReturnItems(ret.id);
      const mapped = (response || []).map((item: any) => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity,
        cost_price: item.cost_price,
        mrp: item.mrp || 0,
        // Prefer the invoice_no joined from purchases; fall back to parent return's original_invoice_id
        invoice_no: item.invoice_no || (ret.original_invoice_id ? String(ret.original_invoice_id) : 'N/A'),
        purchase_date: item.purchase_date || '',
        // Prefer distributor from the joined row; fall back to parent return
        distributor_name: item.distributor_name || ret.distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || ret.distributor_id,
      }));
      setHistoryReturnItems(mapped);
      setEditingItems(mapped.map((i: any) => ({ ...i })));
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

  const handleDeleteReturn = async (ret: any, e: React.MouseEvent) => {
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

  const handleEditHistoryReturn = async (ret: any, e: React.MouseEvent) => {
    e.stopPropagation();
    await handleSelectHistoryReturn(ret);
    setIsEditingHistory(true);
  };

  const handleSaveHistoryEdit = async () => {
    if (!selectedHistoryReturn) return;
    setSaving(true);
    try {
      const validItems = editingItems.filter(i => i.medicine_id && (parseFloat(i.quantity) || 0) > 0);
      const total = validItems.reduce((s, i) => s + (Number(i.cost_price) || 0) * (Number(i.quantity) || 0), 0);
      await api.updateReturn(selectedHistoryReturn.id, { items: validItems, total_amount: total });
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
      const mapped = (response || []).map((item: any) => ({
        id: String(item.id),
        medicine_id: item.medicine_id,
        medicine_name: item.medicine_name || 'Unknown Medicine',
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? formatExpiryToMMYY(item.expiry_date) : '',
        quantity: item.quantity,
        cost_price: item.cost_price,
        mrp: item.mrp || 0,
        invoice_no: item.invoice_no || item.ret_invoice_no || 'N/A',
        purchase_date: item.purchase_date || item.ret_purchase_date || '',
        distributor_name: item.distributor_name || item.ret_distributor_name || 'Unknown Distributor',
        distributor_id: item.distributor_id || item.ret_distributor_id,
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

  const groupGivenItemsByInvoice = (itemsToGroup: ReturnItem[]): GroupedReturn[] => {
    const validItems = itemsToGroup.filter(item => {
      const qty = parseFloat(item.quantity as any) || 0;
      return qty > 0;
    });
    
    const grouped: { [key: string]: GroupedReturn } = {};
    
    validItems.forEach(item => {
      const key = `${item.distributor_id || 0}_${item.invoice_no || 'N/A'}`;
      const qty = parseFloat(item.quantity as any) || 0;
      const costPrice = parseFloat(item.cost_price as any) || 0;
      
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

  // Sync items to active tab
  useEffect(() => {
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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('returns_draft_tabs', JSON.stringify(tabs));
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
    const newId = 'tab_' + Date.now();
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
  const { data: returnHistory = [], isLoading: loading } = useApiQuery(
    returnHistoryKey,
    async () => {
      const params = {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        min_amount: minAmount ? parseFloat(minAmount) : undefined,
        max_amount: maxAmount ? parseFloat(maxAmount) : undefined,
      };
      const response = await api.getReturns(params);
      return Array.isArray(response) ? response : (response.data || []);
    }
  );
  const [showCamera, setShowCamera] = useState(false);
  const [cameraTargetIndex, setCameraTargetIndex] = useState<number | null>(null);


  // Edit history state
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [isResolving, setIsResolving] = useState(false);

  // True when any loaded history item has null/zero batch, expiry, or cost
  const hasMissingData = historyReturnItems.some(
    i => !i.batch_no || !i.expiry_date || !(i.cost_price)
  );

  useEffect(() => {
    if (!manualToDate) {
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

  const handleCameraScanResult = (result: any) => {
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
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length > 0) {
          const purchase = list[0];
          item.medicine_id = purchase.medicine_id;
          item.medicine_name = purchase.medicine_name;
          item.batch_no = purchase.batch_no;
          item.expiry_date = formatExpiryToMMYY(purchase.expiry_date || '');
          item.cost_price = purchase.cost_price;
          item.mrp = purchase.mrp;
          item.purchase_item_id = purchase.purchase_item_id;
          item.invoice_no = purchase.invoice_no;
          item.purchase_date = purchase.purchase_date;
          item.distributor_name = purchase.distributor_name;
          item.distributor_id = purchase.distributor_id;
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
    // Auto-prefill from Expiry page navigation - group by distributor into separate draft cards
    const prefilledItems = location.state?.prefilledReturnItems;
    if (prefilledItems && prefilledItems.length > 0) {
      const groups: Record<string, any[]> = {};
      prefilledItems.forEach((item: any) => {
        const distName = item.distributor_name ? item.distributor_name.trim() : 'Unknown Supplier';
        if (!groups[distName]) groups[distName] = [];
        groups[distName].push({
          id: generateUUID(),
          medicine_id: item.medicine_id ?? null,
          medicine_name: item.medicine_name || '',
          batch_no: item.batch_no || '',
          expiry_date: formatExpiryToMMYY(item.expiry_date || ''),
          quantity: item.quantity || '',
          cost_price: item.purchase_cost_price ?? item.cost_price ?? item.mrp ?? '',
          mrp: item.mrp || '',
          purchase_item_id: item.purchase_item_id || undefined,
          invoice_no: item.purchase_invoice_no || '',
          distributor_name: item.distributor_name || '',
          distributor_id: item.distributor_id || undefined,
        });
      });

      const distNames = Object.keys(groups);
      const newTabs: any[] = distNames.map(distName => ({
        id: generateUUID(),
        name: `Ret: ${distName}`,
        items: groups[distName]
      }));

      if (newTabs.length > 0) {
        setTabs(newTabs);
        setActiveTabId(newTabs[0].id);
        setItems(newTabs[0].items);
      }
    }
  }, []);

  // RQ re-fetches automatically when returnHistoryKey changes (dateFrom/dateTo/minAmount/maxAmount)

  const searchTimeoutRef = React.useRef<any>(null);

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
          setSearchResults(Array.isArray(response) ? response : (response?.data || []));
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
        setSearchResults(Array.isArray(response) ? response : (response?.data || []));
        setSearchHighlightIndex(-1);
      } catch (error) {
        console.error('Error searching medicines:', error);
      }
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const selectMedicine = (purchase: any, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const newItems = [...items];
    const item = newItems[index];

    item.medicine_id = purchase.medicine_id;
    item.medicine_name = purchase.medicine_name;
    item.batch_no = purchase.batch_no;
    item.expiry_date = formatExpiryToMMYY(purchase.expiry_date || '');
    item.cost_price = purchase.cost_price;
    item.mrp = purchase.mrp;
    item.purchase_item_id = purchase.purchase_item_id;
    item.invoice_no = purchase.invoice_no;
    item.purchase_date = purchase.purchase_date;
    item.distributor_name = purchase.distributor_name;
    item.distributor_id = purchase.distributor_id;

    setItems(newItems);
    setSearchResults([]);
    setActiveSearchIndex(null);
    setSearchHighlightIndex(-1);
  };

  const updateItem = (index: number, field: keyof ReturnItem, value: any, format = false) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'quantity' || field === 'cost_price' || field === 'mrp') {
      (item as any)[field] = value;
    } else if (field === 'expiry_date') {
      (item as any)[field] = format ? formatExpiryToMMYY(value) : value;
    } else {
      (item as any)[field] = value;
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

  // Group items by distributor + invoice
  const groupItemsByInvoice = (): GroupedReturn[] => {
    const validItems = items.filter(item => {
      const qty = parseFloat(item.quantity as any) || 0;
      return item.medicine_id && qty > 0;
    });
    
    const grouped: { [key: string]: GroupedReturn } = {};
    
    validItems.forEach(item => {
      // Create key from distributor + invoice to group
      const key = `${item.distributor_id}_${item.invoice_no}`;
      const qty = parseFloat(item.quantity as any) || 0;
      const costPrice = parseFloat(item.cost_price as any) || 0;
      
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
        const qty = parseFloat(item.quantity as any) || 0;
        return item.medicine_id && qty > 0;
      })
      .reduce((sum, item) => {
        const qty = parseFloat(item.quantity as any) || 0;
        const costPrice = parseFloat(item.cost_price as any) || 0;
        return sum + (costPrice * qty);
      }, 0);
  };

  const handlePreviewGrouped = () => {
    const grouped = groupItemsByInvoice();
    setGroupedReturns(grouped);
  };

  const processReturn = async () => {
    const grouped = groupItemsByInvoice();
    
    if (grouped.length === 0) {
      alert('Please add at least one medicine with quantity');
      return;
    }

    setSaving(true);
    try {
      // Process each group separately (one return per distributor/invoice)
      for (const group of grouped) {
        await api.processReturns(group.items.map(item => ({
          medicine_id: item.medicine_id,
          batch_no: item.batch_no,
          quantity: parseFloat(item.quantity as any) || 0,
          cost_price: parseFloat(item.cost_price as any) || 0,
          mrp: parseFloat(item.mrp as any) || 0,
          distributor_id: group.distributor_id,
          invoice_no: group.invoice_no,
        })));
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
          quantity: parseFloat(item.quantity as any) || 0,
          cost_price: parseFloat(item.cost_price as any) || 0,
          mrp: parseFloat(item.mrp as any) || 0
        }));
        const blob = await api.exportReturnsPDF(parsedItemsForExport);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `return-${group.distributor_name}-${group.invoice_no}-${Date.now()}.pdf`;
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
    <div className="h-full flex flex-col fade-in relative overflow-hidden gap-3 p-4 bg-bg text-text">
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
            { id: 'customer', label: 'Customer Returns', icon: Users },
            { id: 'customer-history', label: 'Return History', icon: History, count: returnHistory.length },
          ].map(t => {
            const Icon = t.icon;
            const isActive = currentTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSearchParams({ tab: t.id })}
                className={`flex items-center gap-2 px-3.5 py-1.5 font-bold text-xs rounded-lg transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-black shadow-md border border-border ring-1 ring-primary/20'
                    : 'text-muted hover:text-text hover:bg-bg3/90 border border-transparent'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-primary animate-pulse' : 'text-muted'} />
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-extrabold ${
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
      ) : currentTab === 'customer' ? (
        <div className="flex-1 flex flex-col overflow-y-auto relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-5 custom-scrollbar">
          <CustomerReturn />
        </div>
      ) : currentTab === 'customer-history' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-bg2/50 border border-border/60 rounded-2xl p-5">
          <CustomerReturnHistory />
        </div>
      ) : (
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden text-text relative">
          {/* Left Sidebar Panel: w-96 */}
          <div className="w-96 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-hidden bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-4 shadow-sm">
            
            {/* Header & New Return button */}
            <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-black uppercase tracking-wider text-text">Returns & Drafts Hub</h2>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-muted border border-border/40 font-mono">
                  {tabs.length + returnHistory.length}
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

            {/* Unified Quick Search Input */}
            <div className="relative flex-shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search medicine, supplier or bill..."
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
              <div className="flex gap-1.5">
                <select
                  value={distributorFilter}
                  onChange={e => setDistributorFilter(e.target.value)}
                  className="flex-1 px-2 py-1 bg-bg border border-border/60 rounded-lg text-[10px] text-text font-semibold focus:outline-none focus:border-primary/60"
                >
                  <option value="">All Distributors</option>
                  {[...new Set(returnHistory.map((r: any) => r.distributor_name).filter(Boolean))].map((d: any) => (
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

            {/* Scrollable Lists Area (Active Drafts + Finalized History) */}
            <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
              
              {/* Section A: Active Drafts */}
              <div className="flex-shrink-0 flex flex-col min-h-0">
                <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-muted mb-2 flex items-center justify-between">
                  <span>Active Drafts</span>
                  <span className="text-[9px] font-bold text-primary font-mono">{tabs.length}</span>
                </h3>
                <div className="space-y-2">
                  {tabs.filter(t => {
                    if (!searchFilterText) return true;
                    const q = searchFilterText.toLowerCase();
                    const nameMatch = t.name.toLowerCase().includes(q);
                    const itemMatch = (t.items || []).some((i: any) => 
                      (i.medicine_name || '').toLowerCase().includes(q) ||
                      (i.distributor_name || '').toLowerCase().includes(q) ||
                      (i.invoice_no || '').toLowerCase().includes(q)
                    );
                    return nameMatch || itemMatch;
                  }).map((t) => {
                    const isActive = t.id === activeTabId && !selectedHistoryReturn;
                    const count = t.items ? t.items.length : 0;
                    const firstDistributor = t.items ? t.items.find((item: any) => item.distributor_name)?.distributor_name : null;
                    const displayName = firstDistributor ? `Ret: ${firstDistributor}` : t.name;
                    
                    const tabTotal = (t.items || []).reduce((sum: number, item: any) => {
                      const qty = parseFloat(item.quantity as any) || 0;
                      const costPrice = parseFloat(item.cost_price as any) || 0;
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
              </div>

              {/* Section B: Finalized Return History */}
              <div className="flex-1 flex flex-col min-h-0 border-t border-border/60 pt-3">
                <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-muted mb-2 flex items-center justify-between">
                  <span>Return History</span>
                  <span className="text-[9px] font-bold text-primary font-mono">{returnHistory.length}</span>
                </h3>

                <div className="space-y-1.5 flex-1 overflow-y-auto scrollbar-thin pr-0.5">
                  {loading ? (
                    <div className="flex items-center justify-center py-6 text-xs text-muted font-semibold gap-2">
                      <Loader2 size={16} className="animate-spin text-primary" />
                      Fetching History...
                    </div>
                  ) : returnHistory.filter((ret: any) => {
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
                    <div className="text-center py-6 text-xs text-muted/70 italic font-medium bg-bg3/20 rounded-xl border border-border/30 p-3">
                      No matching return entries found.
                    </div>
                  ) : (
                    returnHistory.filter((ret: any) => {
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
                    }).map((ret: any) => {
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
            </div>
          </div>

          {/* Column 2: Full-Width Right Content Workspace */}
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
                              const blob = await api.exportReturnsPDF(historyReturnItems);
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
                              alert('Failed to export PDF');
                            }
                          }}
                          className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                        >
                          <FileText size={13} /> Export PDF
                        </button>
                        <button
                          onClick={() => { setEditingItems(historyReturnItems.map(i => ({ ...i }))); setIsEditingHistory(true); }}
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
                                ₹{((item.cost_price || 0) * (item.quantity || 0)).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-bg2 border-t border-border/60">
                        <tr>
                          <td colSpan={6} className="p-3 text-xs font-bold text-text text-right">Updated Claim Total:</td>
                          <td className="p-3 text-sm font-black text-emerald-500 font-mono text-right">
                            ₹{editingItems.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0).toFixed(2)}
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
                              {item.cost_price != null ? `₹${(item.cost_price || 0).toFixed(2)}` : '—'}
                            </td>
                            <td className="p-3.5 text-xs text-text font-extrabold font-mono text-right">
                              {item.cost_price != null && item.quantity != null
                                ? `₹${((item.cost_price || 0) * (item.quantity || 0)).toFixed(2)}`
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
              /* Draft Editor Workspace — Full Width */
              <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden p-5">
                {/* Workspace Header */}
                <div className="flex justify-between items-center pb-2 border-b border-border/60">
                  <div>
                    <h2 className="text-base font-bold text-text flex items-center gap-2">
                      <span>{items.some(i => i.distributor_name) 
                        ? `Return to: ${[...new Set(items.map(i => i.distributor_name).filter(Boolean))].join(', ')}`
                        : 'New Supplier Return Bill'}</span>
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {items.length} Row{items.length !== 1 ? 's' : ''}
                      </span>
                    </h2>
                    <p className="text-xs text-muted font-medium mt-0.5">
                      Search medicines below. Line items will automatically split into separate distributor return bills when processed.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addItem}
                      className="bg-primary hover:bg-primary/95 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                      <Plus size={14} />
                      <span>Add Medicine Row</span>
                    </button>
                  </div>
                </div>

                {/* Table Editor - 100% Width */}
                <div className="flex-1 overflow-auto bg-bg/40 rounded-2xl border border-border/60 shadow-inner">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 bg-bg2/95 backdrop-blur-sm border-b border-border/60 shadow-sm">
                      <tr className="text-left text-muted border-b border-border/60">
                        <th className="p-3.5 text-xs font-bold w-12">#</th>
                        <th className="p-3.5 text-xs font-bold min-w-[260px]">Medicine Name</th>
                        <th className="p-3.5 text-xs font-bold w-32">Batch No</th>
                        <th className="p-3.5 text-xs font-bold w-32">Expiry Date</th>
                        <th className="p-3.5 text-xs font-bold w-24 text-center">Qty</th>
                        <th className="p-3.5 text-xs font-bold w-28 text-right">Cost Price</th>
                        <th className="p-3.5 text-xs font-bold w-28 text-right">Total</th>
                        <th className="p-3.5 text-xs font-bold w-36 text-center">Invoice Ref</th>
                        <th className="p-3.5 text-xs font-bold min-w-[160px]">Distributor</th>
                        <th className="p-3.5 text-xs font-bold w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={item.id} className="border-b border-border/40 hover:bg-bg3/40 transition-colors">
                          <td className="p-3.5 text-xs text-muted font-mono">{index + 1}</td>
                          
                          {/* Medicine Select / Search */}
                          <td className="p-3">
                            <div ref={activeSearchIndex === index ? activeSearchRef : null} className="relative">
                              <div className="flex gap-1.5 items-center">
                                <input
                                  type="text"
                                  value={item.medicine_name}
                                  onChange={(e) => {
                                    updateItem(index, 'medicine_name', e.target.value);
                                    searchMedicines(e.target.value, index);
                                  }}
                                  onKeyDown={e => {
                                    if (activeSearchIndex !== index || searchResults.length === 0) return;
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setSearchHighlightIndex(i => Math.min(i + 1, searchResults.length - 1));
                                    } else if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setSearchHighlightIndex(i => Math.max(i - 1, 0));
                                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                                      if (searchHighlightIndex >= 0 && searchHighlightIndex < searchResults.length) {
                                        e.preventDefault();
                                        selectMedicine(searchResults[searchHighlightIndex], index);
                                      }
                                    } else if (e.key === 'Escape') {
                                      setActiveSearchIndex(null);
                                      setSearchResults([]);
                                      setSearchHighlightIndex(-1);
                                    }
                                  }}
                                  className="w-full bg-bg3 border border-border/60 rounded-xl px-3.5 py-2 text-text font-bold text-xs focus:ring-1 focus:ring-primary focus:outline-none transition-all shadow-inner"
                                  placeholder="Type 2+ chars to search purchase history..."
                                />
                                <button
                                  onClick={() => {
                                    setCameraTargetIndex(index);
                                    setShowCamera(true);
                                  }}
                                  className="bg-sky/15 hover:bg-sky/30 border border-sky/30 text-sky w-9 h-9 rounded-xl text-xs flex-shrink-0 flex items-center justify-center transition-all cursor-pointer shadow-sm"
                                  title="Scan drug package using AI Camera"
                                >
                                  <Camera size={16} />
                                </button>
                              </div>
                              {activeSearchIndex === index && searchResults.length > 0 && (
                                <div ref={searchResultsRef} className="absolute z-30 w-full mt-1.5 bg-bg2 border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                  {searchResults.map((result, idx) => (
                                    <button
                                      key={result.purchase_item_id}
                                      type="button"
                                      data-highlighted={idx === searchHighlightIndex ? "true" : "false"}
                                      onClick={() => selectMedicine(result, index)}
                                      className={`w-full text-left px-3.5 py-2.5 hover:bg-bg3 text-text text-xs border-b border-border/30 last:border-0 cursor-pointer transition-colors ${idx === searchHighlightIndex ? 'bg-primary/10 border-l-4 border-primary' : ''}`}
                                    >
                                      <div className="font-bold text-text">{result.medicine_name}</div>
                                      <div className="text-[10px] text-muted font-mono mt-0.5">
                                        Batch: <span className="font-bold text-text">{result.batch_no}</span> | Cost: ₹{result.cost_price} | {result.distributor_name} | Inv: {result.invoice_no}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Batch */}
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.batch_no}
                              onChange={(e) => updateItem(index, 'batch_no', e.target.value)}
                              className="w-full bg-bg3 border border-border/60 rounded-xl px-3 py-2 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                              placeholder="Batch No"
                            />
                          </td>

                          {/* Expiry */}
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.expiry_date}
                              onChange={(e) => updateItem(index, 'expiry_date', e.target.value, false)}
                              onBlur={(e) => updateItem(index, 'expiry_date', e.target.value, true)}
                              className="w-full bg-bg3 border border-border/60 rounded-xl px-3 py-2 text-text font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                              placeholder="MM/YY"
                            />
                          </td>

                          {/* Qty */}
                          <td className="p-3">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                              className="w-full bg-bg3 border border-border/60 rounded-xl px-3 py-2 text-text font-mono text-xs text-center focus:ring-1 focus:ring-primary focus:outline-none"
                              min="0"
                            />
                          </td>

                          {/* Cost Price */}
                          <td className="p-3">
                            <input
                              type="number"
                              value={item.cost_price}
                              onChange={(e) => updateItem(index, 'cost_price', e.target.value)}
                              className="w-full bg-bg3 border border-border/60 rounded-xl px-3 py-2 text-text font-mono text-xs text-right focus:ring-1 focus:ring-primary focus:outline-none"
                              min="0"
                            />
                          </td>

                          {/* Total */}
                          <td className="p-3 text-text font-extrabold text-xs font-mono text-right">
                            ₹{((parseFloat(item.cost_price as any) || 0) * (parseFloat(item.quantity as any) || 0)).toFixed(2)}
                          </td>

                          {/* Invoice Ref */}
                          <td className="p-3 text-center">
                            <span className="px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg text-[10px] font-bold font-mono block truncate text-center max-w-[120px] mx-auto">
                              {item.invoice_no || 'N/A'}
                            </span>
                          </td>

                          {/* Distributor */}
                          <td className="p-3">
                            <span className="px-2.5 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg text-[10px] font-bold block truncate text-center max-w-[150px]" title={item.distributor_name}>
                              {item.distributor_name || 'N/A'}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3 text-center">
                            <button
                              onClick={() => removeItem(index)}
                              className="text-red/80 hover:text-red p-1.5 hover:bg-red/10 rounded-lg transition-all cursor-pointer"
                              title="Remove Row"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Sticky Action Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg3/60 p-3.5 px-5 rounded-2xl border border-border/70 shadow-sm shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted font-bold">Total Claim:</span>
                      <span className="text-xl font-black text-emerald-500 font-mono">
                        ₹{calculateGrandTotal().toFixed(2)}
                      </span>
                    </div>
                    <div className="h-4 w-[1px] bg-border/60 hidden sm:block" />
                    <span className="text-[11px] text-muted font-semibold hidden sm:block">
                      {items.filter(i => (parseFloat(i.quantity as any) || 0) > 0).length} valid items across {groupItemsByInvoice().length} supplier{groupItemsByInvoice().length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={exportPDF}
                      disabled={groupItemsByInvoice().length === 0}
                      className="flex-1 sm:flex-none bg-purple-600/90 hover:bg-purple-600 text-white px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                    >
                      <FileText size={14} />
                      <span>Export PDF Statements</span>
                    </button>
                    <button
                      onClick={processReturn}
                      disabled={saving || groupItemsByInvoice().length === 0}
                      className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 active:scale-95 shadow-sm cursor-pointer"
                    >
                      <RotateCcw size={14} />
                      <span>{saving ? 'Processing Returns…' : 'Process All Returns'}</span>
                    </button>
                  </div>
                </div>

              </div>
            )}
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
