// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { api, apiClient } from '../../services/api';
import { RotateCcw, Plus, Trash2, Search, FileText, AlertTriangle, Package, Layers, Camera, X, Loader2, Edit, Wand2 } from 'lucide-react';
import AICamera from '../../components/AICamera';

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
  quantity: number;
  cost_price: number;
  mrp: number;
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

const getTodayString = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

let cachedReturnHistory: any[] | null = null;

const Returns: React.FC = () => {
  const location = useLocation();

  const initialTabs = getInitialReturnsTabs();
  const initialActiveTabId = getInitialReturnsActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [tabs, setTabs] = useState<any[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  const [items, setItems] = useState<ReturnItem[]>(initialActiveTab.items || []);
  const [returnHistory, setReturnHistory] = useState<any[]>(cachedReturnHistory || []);
  const [loading, setLoading] = useState(!cachedReturnHistory);
  const [saving, setSaving] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
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
      setEditingItems(mapped.map(i => ({ ...i })));
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
      fetchReturnHistory(dateFrom, dateTo, minAmount, maxAmount);
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
      const total = validItems.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
      await api.updateReturn(selectedHistoryReturn.id, { items: validItems, total_amount: total });
      setIsEditingHistory(false);
      await handleSelectHistoryReturn(selectedHistoryReturn);
      fetchReturnHistory(dateFrom, dateTo, minAmount, maxAmount);
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
  const [showGroupedPreview, setShowGroupedPreview] = useState(false);
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
    // Auto-prefill from Expiry page navigation
    const prefilledItems = location.state?.prefilledReturnItems;
    if (prefilledItems && prefilledItems.length > 0) {
      const mapped = prefilledItems.map((item: any) => ({
        id: generateUUID(),
        medicine_id: item.medicine_id ?? null,
        medicine_name: item.medicine_name || '',
        batch_no: item.batch_no || '',
        expiry_date: formatExpiryToMMYY(item.expiry_date || ''),
        quantity: item.quantity || '',
        cost_price: item.mrp || '',
        mrp: item.mrp || '',
      }));
      setItems(mapped);
    }
  }, []);

  const fetchReturnHistory = async (start = dateFrom, end = dateTo, min = minAmount, max = maxAmount, silent = false) => {
    if (!silent && !cachedReturnHistory) setLoading(true);
    try {
      const params = {
        date_from: start || undefined,
        date_to: end || undefined,
        min_amount: min ? parseFloat(min) : undefined,
        max_amount: max ? parseFloat(max) : undefined,
      };
      const response = await api.getReturns(params);
      const returns = Array.isArray(response) ? response : (response.data || []);
      setReturnHistory(returns);
      cachedReturnHistory = returns;
    } catch (error) {
      console.error('Error fetching returns:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturnHistory(dateFrom, dateTo, minAmount, maxAmount, !!cachedReturnHistory);
  }, [dateFrom, dateTo, minAmount, maxAmount]);

  const searchTimeoutRef = React.useRef<any>(null);

  const searchMedicines = useCallback((term: string, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (term.length < 2) {
      setSearchResults([]);
      setActiveSearchIndex(null);
      return;
    }

    if (term.length === 2) {
      // Prefetch 2 characters in background, no dropdown
      setActiveSearchIndex(null);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await api.lookupPurchases(term);
          setSearchResults(Array.isArray(response) ? response : (response?.data || []));
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
    setShowGroupedPreview(true);
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
      setShowGroupedPreview(false);
      fetchReturnHistory();
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
    <div className="h-full flex gap-4 p-4 animate-in fade-in duration-500 min-h-0 overflow-hidden text-text bg-bg">
      {/* Left Sidebar Panel: w-96 */}
      <div className="w-96 flex-shrink-0 flex flex-col gap-4 min-h-0 overflow-hidden bg-bg2 border border-border rounded-xl p-4">
        
        {/* Header & New Return button */}
        <div className="flex items-center justify-between border-b border-glass-border pb-3 flex-shrink-0">
          <h2 className="text-sm font-bold text-text">Returns & Drafts</h2>
          <button
            onClick={addNewTab}
            className="flex items-center justify-center p-1.5 rounded-lg border border-dashed border-glass-border text-muted hover:text-text hover:border-text transition-all bg-bg3 hover:bg-bg3/80"
            title="Add New Returns Draft"
          >
            <Plus size={14} />
            <span className="text-[10px] font-semibold ml-1">New Return</span>
          </button>
        </div>

        {/* Scrollable Lists Area (Drafts + History) */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
          {/* Section A: Draft returns */}
          <div className="flex-shrink-0 flex flex-col min-h-0">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Active Drafts</h3>
            <div className="space-y-2">
              {tabs.map((t) => {
                const isActive = t.id === activeTabId && !selectedHistoryReturn;
                const count = t.items ? t.items.length : 0;
                const firstDistributor = t.items ? t.items.find((item: any) => item.distributor_name)?.distributor_name : null;
                const displayName = firstDistributor ? `Ret: ${firstDistributor}` : t.name;
                
                // Calculate tab's total in real time
                const tabTotal = (t.items || []).reduce((sum: number, item: any) => {
                  const qty = parseFloat(item.quantity as any) || 0;
                  const costPrice = parseFloat(item.cost_price as any) || 0;
                  return sum + (costPrice * qty);
                }, 0);

                return (
                  <div
                    key={t.id}
                    onClick={() => switchTab(t.id)}
                    className={`flex flex-col gap-1 p-2.5 rounded-lg border transition-all select-none cursor-pointer relative ${
                      isActive 
                        ? 'bg-primary/10 border-primary text-text font-bold' 
                        : 'bg-bg3/50 border-glass-border text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <RotateCcw size={12} className={isActive ? 'text-primary' : 'text-muted'} />
                        <span className="truncate text-xs font-semibold">{displayName}</span>
                      </div>
                      {tabs.length > 1 && (
                        <button 
                          onClick={(e) => closeTab(t.id, e)}
                          className="hover:bg-bg3 rounded-full p-0.5 transition-all text-muted hover:text-red flex-shrink-0"
                          title="Close Tab"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-muted font-medium mt-1">
                      <span>{count} {count === 1 ? 'item' : 'items'}</span>
                      <span className="text-text font-semibold">₹{tabTotal.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section B: History */}
          <div className="flex-shrink-0 flex flex-col min-h-0 border-t border-glass-border pt-3">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Return History</h3>

            {/* Always-visible compact filters */}
            <div className="mb-2 p-2 bg-bg3/40 rounded-lg border border-glass-border space-y-1.5 text-[10px] flex-shrink-0">
              <div className="flex items-center gap-1">
                <label className="text-muted w-7">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  min="2020-01-01"
                  max={getTodayString()}
                  onChange={e => handleDateFromChange(e.target.value)}
                  className="flex-1 px-1.5 py-0.5 bg-bg border border-glass-border rounded text-[10px] text-text focus:outline-none"
                />
                <label className="text-muted w-4">To</label>
                <input
                  type="date"
                  value={dateTo}
                  min="2020-01-01"
                  max={getTodayString()}
                  onChange={e => { setManualToDate(true); handleDateToChange(e.target.value); }}
                  className="flex-1 px-1.5 py-0.5 bg-bg border border-glass-border rounded text-[10px] text-text focus:outline-none"
                />
              </div>
              <div>
                <select
                  value={distributorFilter}
                  onChange={e => setDistributorFilter(e.target.value)}
                  className="w-full px-1.5 py-0.5 bg-bg border border-glass-border rounded text-[10px] text-text focus:outline-none"
                >
                  <option value="">All Distributors</option>
                  {[...new Set(returnHistory.map(r => r.distributor_name).filter(Boolean))].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              {(distributorFilter || minAmount || maxAmount) && (
                <button
                  onClick={() => { setDistributorFilter(''); setMinAmount(''); setMaxAmount(''); }}
                  className="text-[9px] text-red hover:text-red/80 font-semibold"
                >✕ Clear filters</button>
              )}
            </div>

            <div className="space-y-1.5">
              {loading ? (
                <div className="text-center py-4 text-xs text-muted">Loading...</div>
              ) : returnHistory.filter(ret => {
                  const itemDate = ret.date ? ret.date.substring(0, 10) : '';
                  const matchesDate = (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
                  const matchesMin = !minAmount || (ret.total_amount || 0) >= Number(minAmount);
                  const matchesMax = !maxAmount || (ret.total_amount || 0) <= Number(maxAmount);
                  const matchesDist = !distributorFilter || ret.distributor_name === distributorFilter;
                  return matchesDate && matchesMin && matchesMax && matchesDist;
                }).length === 0 ? (
                <div className="text-center py-4 text-xs text-muted">No returns found.</div>
              ) : (
                returnHistory.filter(ret => {
                  const itemDate = ret.date ? ret.date.substring(0, 10) : '';
                  const matchesDate = (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
                  const matchesMin = !minAmount || (ret.total_amount || 0) >= Number(minAmount);
                  const matchesMax = !maxAmount || (ret.total_amount || 0) <= Number(maxAmount);
                  const matchesDist = !distributorFilter || ret.distributor_name === distributorFilter;
                  return matchesDate && matchesMin && matchesMax && matchesDist;
                }).map((ret) => {
                  const isSelected = selectedHistoryReturn?.id === ret.id;
                  return (
                    <div 
                      key={ret.id} 
                      onClick={() => handleSelectHistoryReturn(ret)}
                      className={`p-2 rounded-lg border transition-all flex flex-col gap-0.5 text-[10px] font-medium cursor-pointer select-none group/hist ${
                        isSelected 
                          ? 'bg-primary/10 border-primary text-text font-bold' 
                          : 'border-glass-border bg-bg3/30 hover:bg-bg3/60'
                      }`}
                    >
                      <div className="flex justify-between items-center text-text font-semibold">
                        <span>{ret.return_no}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-500 font-bold">₹{ret.total_amount?.toFixed(2) || '0.00'}</span>
                          <button
                            onClick={(e) => handleEditHistoryReturn(ret, e)}
                            className="p-0.5 rounded hover:bg-primary/20 text-muted hover:text-primary transition-colors flex-shrink-0"
                            title="Edit this return"
                            aria-label={`Edit return ${ret.return_no}`}
                          >
                            <Edit size={11} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteReturn(ret, e)}
                            className="p-0.5 rounded hover:bg-red/20 text-muted hover:text-red transition-colors flex-shrink-0"
                            title="Delete this return"
                            aria-label={`Delete return ${ret.return_no}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      {ret.distributor_name && (
                        <div className="text-[9px] text-muted truncate mt-0.5">
                          🏭 {ret.distributor_name}
                        </div>
                      )}
                      <div className="flex justify-between items-center text-muted text-[9px] mt-1">
                        <span>{ret.date ? ret.date.substring(0, 10) : 'N/A'}</span>
                        <span className="capitalize px-1 rounded text-[8px] bg-blue-500/10 text-blue-500 font-semibold">
                          {ret.type || 'purchase'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Section C: Summary Panel (Distributor breakdown, grand totals, and CTA actions) */}
        <div className="border-t border-glass-border pt-3 flex-shrink-0 flex flex-col min-h-0">
          {selectedHistoryReturn !== null ? (
            <div className="flex flex-col gap-3">
              <div className="border-b border-glass-border pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted">Invoice Summary</span>
                  <span className="px-2 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-500 font-bold uppercase">Finalized</span>
                </div>
                <h2 className="text-sm font-black text-text mt-1">{selectedHistoryReturn.return_no}</h2>
              </div>

              {/* Distributor details & breakdown */}
              <div className="max-h-40 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                <div className="p-2 bg-bg3/30 rounded-lg border border-glass-border">
                  <span className="text-[9px] uppercase font-bold text-muted block mb-0.5">Target Distributor</span>
                  <p className="text-xs font-semibold text-text">{selectedHistoryReturn.distributor_name || 'Unknown Distributor'}</p>
                </div>

                <div className="space-y-1.5">
                  {groupGivenItemsByInvoice(historyReturnItems).map((group, idx) => (
                    <div key={idx} className="p-2 rounded-lg border border-glass-border bg-bg3/50 flex flex-col gap-0.5">
                      <div className="flex justify-between items-start">
                        <p className="text-[10px] font-bold text-text truncate max-w-[170px]">{group.distributor_name}</p>
                        <p className="text-[10px] font-bold text-emerald-500">₹{group.total_amount.toFixed(2)}</p>
                      </div>
                      <div className="flex justify-between text-[8px] text-muted">
                        <span>Invoice Ref: {group.invoice_no}</span>
                        <span>{group.items.length} items</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-glass-border space-y-2">
                <div className="flex justify-between items-center bg-bg3/40 p-2.5 rounded-lg border border-glass-border">
                  <span className="text-xs text-muted">Total Claim</span>
                  <span className="text-base font-black text-emerald-500">₹{selectedHistoryReturn.total_amount?.toFixed(2) || '0.00'}</span>
                </div>
                
                <button
                  onClick={handleClearHistorySelection}
                  className="w-full bg-primary hover:bg-primary/95 text-white font-bold py-2 rounded-xl text-xs transition-all flex items-center justify-center gap-1 active:scale-95"
                >
                  <span>Back to Draft Editor</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="border-b border-glass-border pb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-muted">Active Draft Summary</span>
                <h2 className="text-sm font-black text-text mt-1">
                  {tabs.find(t => t.id === activeTabId)?.name || 'Return Draft'}
                </h2>
              </div>

              {/* Distributor Groups breakdown */}
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
                {groupItemsByInvoice().length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted">
                    No items in draft.
                  </div>
                ) : (
                  groupItemsByInvoice().map((group, idx) => (
                    <div key={idx} className="p-2 rounded-lg border border-glass-border bg-bg3/50 flex flex-col gap-0.5">
                      <div className="flex justify-between items-start">
                        <p className="text-[10px] font-bold text-text truncate max-w-[170px]">{group.distributor_name}</p>
                        <p className="text-[10px] font-bold text-primary">₹{group.total_amount.toFixed(2)}</p>
                      </div>
                      <div className="flex justify-between text-[8px] text-muted">
                        <span>Invoice Ref: {group.invoice_no}</span>
                        <span>{group.items.length} items</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-glass-border space-y-2">
                <div className="flex justify-between items-center bg-bg3/40 p-2.5 rounded-lg border border-glass-border">
                  <span className="text-xs text-muted">Grand Total</span>
                  <span className="text-base font-black text-text">₹{calculateGrandTotal().toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={exportPDF}
                    disabled={groupItemsByInvoice().length === 0}
                    className="bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1 transition-all disabled:opacity-50 active:scale-95"
                  >
                    <FileText size={12} />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={processReturn}
                    disabled={saving || groupItemsByInvoice().length === 0}
                    className="bg-green hover:bg-green/90 text-white py-2 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1 transition-all disabled:opacity-50 active:scale-95"
                  >
                    <RotateCcw size={12} />
                    <span>{saving ? 'Wait...' : 'Process'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Right Content Pane: Active Return Bill Editor OR History Viewer */}
      <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden bg-bg2 border border-border rounded-xl p-5">
        {selectedHistoryReturn !== null ? (
          <>
            {/* History Header */}
            <div className="flex justify-between items-center border-b border-glass-border pb-3">
              <div>
                <h2 className="text-base font-bold text-text flex items-center gap-2">
                  {isEditingHistory && <span className="text-xs px-2 py-0.5 bg-amber/20 text-amber rounded-lg font-semibold">Editing</span>}
                  <span>{isEditingHistory ? 'Edit Return: ' : 'Finalized Return: '}{selectedHistoryReturn.return_no}</span>
                </h2>
                <p className="text-xs text-muted">
                  {isEditingHistory
                    ? 'Edit quantities or cost prices below, then save.'
                    : `Read-only view of return items processed for ${selectedHistoryReturn.distributor_name || 'Unknown distributor'}.`}
                </p>
              </div>
              <div className="flex gap-2">
                {isEditingHistory ? (
                  <>
                    <button
                      onClick={handleSaveHistoryEdit}
                      disabled={saving}
                      className="bg-green hover:bg-green/90 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setIsEditingHistory(false)}
                      className="bg-bg3 border border-glass-border hover:bg-bg3/80 text-text font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all"
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
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all disabled:opacity-60"
                        title="Auto-fill missing batch, expiry, cost from purchase history"
                      >
                        {isResolving
                          ? <><Loader2 size={13} className="animate-spin" /> Resolving…</>
                          : <><Wand2 size={13} /> Auto-fill Missing</>}
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingItems(historyReturnItems.map(i => ({ ...i }))); setIsEditingHistory(true); }}
                      className="bg-primary/10 hover:bg-primary/20 text-primary font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all"
                    >
                      <Edit size={13} /> Edit
                    </button>
                    <button
                      onClick={handleClearHistorySelection}
                      className="bg-bg3 border border-glass-border hover:bg-bg3/80 text-text font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all"
                    >
                      <span>Back</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Table Viewer / Editor */}
            <div className="flex-1 overflow-auto bg-bg/50 rounded-xl border border-glass-border">
              {loadingHistoryItems ? (
                <div className="flex flex-col items-center justify-center h-full py-12 gap-3 text-muted">
                  <Loader2 className="animate-spin text-primary" size={32} />
                  <span className="text-xs font-semibold">Loading items...</span>
                </div>
              ) : isEditingHistory ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-20 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-left text-muted border-b border-glass-border">
                      <th className="p-3 text-xs font-semibold w-8">#</th>
                      <th className="p-3 text-xs font-semibold min-w-[170px]">Medicine</th>
                      <th className="p-3 text-xs font-semibold w-24">Batch</th>
                      <th className="p-3 text-xs font-semibold w-20">Expiry</th>
                      <th className="p-3 text-xs font-semibold w-16 text-center">Qty</th>
                      <th className="p-3 text-xs font-semibold w-24 text-right">Cost Price</th>
                      <th className="p-3 text-xs font-semibold w-24 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editingItems.map((item, idx) => {
                      const rf: string[] = item._resolved_fields || [];
                      const hi = (f: string) => rf.includes(f)
                        ? 'ring-1 ring-amber-400 bg-amber-400/10'
                        : '';
                      return (
                        <tr key={item.id} className="border-b border-glass-border hover:bg-bg3/20 transition-colors">
                          <td className="p-3 text-xs text-muted">{idx + 1}</td>
                          <td className="p-3 text-xs font-semibold text-text">{item.medicine_name}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.batch_no}
                              onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, batch_no: e.target.value } : it))}
                              className={`w-full bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary ${hi('batch_no')}`}
                              placeholder="—"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.expiry_date}
                              onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, expiry_date: e.target.value } : it))}
                              className={`w-full bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text font-mono focus:outline-none focus:ring-1 focus:ring-primary ${hi('expiry_date')}`}
                              placeholder="MM/YY"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))}
                              className="w-16 bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text text-center focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.cost_price}
                              onChange={e => setEditingItems(prev => prev.map((it, i) => i === idx ? { ...it, cost_price: parseFloat(e.target.value) || 0 } : it))}
                              className={`w-20 bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text text-right focus:outline-none focus:ring-1 focus:ring-primary ${hi('cost_price')}`}
                            />
                          </td>
                          <td className="p-3 text-xs text-text font-bold text-right">
                            ₹{((item.cost_price || 0) * (item.quantity || 0)).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-bg2 border-t border-glass-border">
                    <tr>
                      <td colSpan={6} className="p-3 text-xs font-bold text-text text-right">Updated Total:</td>
                      <td className="p-3 text-sm font-black text-emerald-500 text-right">
                        ₹{editingItems.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0).toFixed(2)}
                      </td>
                    </tr>
                    {editingItems.some(i => (i._resolved_fields || []).length > 0) && (
                      <tr>
                        <td colSpan={7} className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] text-amber-500">
                            <span className="inline-block w-3 h-3 rounded bg-amber-400/30 ring-1 ring-amber-400 flex-shrink-0" />
                            Amber cells were auto-filled from purchase history. Verify before saving.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              ) : historyReturnItems.length === 0 ? (
                <div className="text-center py-12 text-muted text-xs">No items recorded for this return invoice.</div>
              ) : (
                   <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-20 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-left text-muted border-b border-glass-border">
                      <th className="p-3 text-xs font-semibold w-10">#</th>
                      <th className="p-3 text-xs font-semibold min-w-[180px]">Medicine</th>
                      <th className="p-3 text-xs font-semibold w-24">Batch</th>
                      <th className="p-3 text-xs font-semibold w-20">Expiry</th>
                      <th className="p-3 text-xs font-semibold w-14 text-center">Qty</th>
                      <th className="p-3 text-xs font-semibold w-22 text-right">Cost Price</th>
                      <th className="p-3 text-xs font-semibold w-22 text-right">Total</th>
                      <th className="p-3 text-xs font-semibold w-24 text-center">Invoice Ref</th>
                      <th className="p-3 text-xs font-semibold min-w-[120px]">Distributor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyReturnItems.map((item, index) => (
                      <tr key={item.id} className="border-b border-glass-border hover:bg-bg3/30 transition-colors">
                        <td className="p-3 text-xs text-muted font-medium">{index + 1}</td>
                        <td className="p-3 text-xs font-semibold text-text">{item.medicine_name}</td>
                        <td className="p-3 text-xs font-mono text-muted">{item.batch_no || '—'}</td>
                        <td className="p-3 text-xs font-mono text-muted">{item.expiry_date || '—'}</td>
                        <td className="p-3 text-xs font-semibold text-text text-center">{item.quantity ?? '—'}</td>
                        <td className="p-3 text-xs text-text text-right">
                          {item.cost_price != null ? `₹${(item.cost_price || 0).toFixed(2)}` : '—'}
                        </td>
                        <td className="p-3 text-xs text-text font-bold text-right">
                          {item.cost_price != null && item.quantity != null
                            ? `₹${((item.cost_price || 0) * (item.quantity || 0)).toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg text-[9px] font-semibold">
                            {item.invoice_no || 'N/A'}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted truncate max-w-[140px]">
                          {item.distributor_name || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Workspace Header */}
            <div className="flex justify-between items-center border-b border-glass-border pb-3">
              <div>
                <h2 className="text-base font-bold text-text">
                  {items.some(i => i.distributor_name) 
                    ? `Return to: ${[...new Set(items.map(i => i.distributor_name).filter(Boolean))].join(', ')}`
                    : 'New Return Bill'}
                </h2>
                <p className="text-xs text-muted">
                  Edit the return items below. Items are automatically grouped by invoice reference when processed.
                </p>
              </div>
              <button
                onClick={addItem}
                className="bg-primary hover:bg-primary/95 text-white font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              >
                <Plus size={14} />
                <span>Add Row</span>
              </button>
            </div>

            {/* Table Editor */}
            <div className="flex-1 overflow-auto bg-bg/50 rounded-xl border border-glass-border">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-bg2 border-b border-glass-border shadow-sm">
                  <tr className="text-left text-muted border-b border-glass-border">
                    <th className="p-3 text-xs font-semibold w-10">#</th>
                    <th className="p-3 text-xs font-semibold min-w-[200px]">Medicine</th>
                    <th className="p-3 text-xs font-semibold w-24">Batch</th>
                    <th className="p-3 text-xs font-semibold w-28">Expiry</th>
                    <th className="p-3 text-xs font-semibold w-20">Qty</th>
                    <th className="p-3 text-xs font-semibold w-24">Cost Price</th>
                    <th className="p-3 text-xs font-semibold w-24">Total</th>
                    <th className="p-3 text-xs font-semibold w-28">Invoice Ref</th>
                    <th className="p-3 text-xs font-semibold w-36">Distributor</th>
                    <th className="p-3 text-xs font-semibold w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-b border-glass-border hover:bg-bg3/30 transition-colors">
                      <td className="p-3 text-xs text-muted font-medium">{index + 1}</td>
                      
                      {/* Medicine Select / Search */}
                      <td className="p-3">
                        <div className="relative">
                          <div className="flex gap-1 items-center">
                            <input
                              type="text"
                              value={item.medicine_name}
                              onChange={(e) => {
                                updateItem(index, 'medicine_name', e.target.value);
                                searchMedicines(e.target.value, index);
                              }}
                              className="w-full bg-bg3 border border-glass-border rounded-lg px-2.5 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                              placeholder="Search medicine..."
                            />
                            <button
                              onClick={() => {
                                setCameraTargetIndex(index);
                                setShowCamera(true);
                              }}
                              className="bg-sky/20 hover:bg-sky/40 border border-sky/30 text-sky w-7 h-7 rounded-lg text-xs flex-shrink-0 flex items-center justify-center transition-all"
                              title="Scan drug package using AI Camera"
                            >
                              <Camera size={14} />
                            </button>
                          </div>
                          {activeSearchIndex === index && searchResults.length > 0 && (
                            <div className="absolute z-30 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {searchResults.map((result) => (
                                <button
                                  key={result.purchase_item_id}
                                  onClick={() => selectMedicine(result, index)}
                                  className="w-full text-left px-3 py-2 hover:bg-bg3 text-text text-xs border-b border-glass-border/30 last:border-0"
                                >
                                  <div className="font-semibold">{result.medicine_name}</div>
                                  <div className="text-[10px] text-muted">
                                    Batch: {result.batch_no} | Cost: ₹{result.cost_price} | {result.distributor_name} | Inv: {result.invoice_no}
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
                          className="w-full bg-bg3 border border-glass-border rounded-lg px-2.5 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                      </td>

                      {/* Expiry */}
                      <td className="p-3">
                        <input
                          type="text"
                          value={item.expiry_date}
                          onChange={(e) => updateItem(index, 'expiry_date', e.target.value, false)}
                          onBlur={(e) => updateItem(index, 'expiry_date', e.target.value, true)}
                          className="w-full bg-bg3 border border-glass-border rounded-lg px-2.5 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                          placeholder="MM/YY"
                        />
                      </td>

                      {/* Qty */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          className="w-full bg-bg3 border border-glass-border rounded-lg px-2.5 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                          min="0"
                        />
                      </td>

                      {/* Cost Price */}
                      <td className="p-3">
                        <input
                          type="number"
                          value={item.cost_price}
                          onChange={(e) => updateItem(index, 'cost_price', e.target.value)}
                          className="w-full bg-bg3 border border-glass-border rounded-lg px-2.5 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                          min="0"
                        />
                      </td>

                      {/* Total */}
                      <td className="p-3 text-text font-semibold text-xs">
                        ₹{((parseFloat(item.cost_price as any) || 0) * (parseFloat(item.quantity as any) || 0)).toFixed(2)}
                      </td>

                      {/* Invoice Ref */}
                      <td className="p-3">
                        <span className="px-2 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg text-[10px] font-semibold block truncate text-center max-w-[100px]">
                          {item.invoice_no || 'N/A'}
                        </span>
                      </td>

                      {/* Distributor */}
                      <td className="p-3">
                        <span className="px-2 py-1 bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded-lg text-[10px] font-semibold block truncate text-center max-w-[130px]" title={item.distributor_name}>
                          {item.distributor_name || 'N/A'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => removeItem(index)}
                          className="text-red hover:text-red-600 p-1.5 hover:bg-red/10 rounded-lg transition-all"
                          title="Remove Row"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Grouped Preview Modal */}
      {showGroupedPreview && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-modal">
          <div className="bg-bg2 border border-glass-border rounded-xl p-6 w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-glass-border flex-shrink-0">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <Layers size={18} className="text-yellow-500" />
                <span>Preview: {groupedReturns.length} Separate Return Bill(s)</span>
              </h3>
              <button
                onClick={() => setShowGroupedPreview(false)}
                className="text-muted hover:text-text p-1 hover:bg-bg3 rounded-lg transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
              {groupedReturns.map((group, idx) => (
                <div key={idx} className="bg-bg3/30 rounded-lg p-4 border border-glass-border">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="text-text font-bold text-sm">{group.distributor_name}</h4>
                      <p className="text-xs text-muted">
                        Invoice: <span className="text-blue-500 font-semibold">{group.invoice_no}</span> | 
                        Date: {group.purchase_date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-emerald-500 font-black text-sm">₹{group.total_amount.toFixed(2)}</p>
                      <p className="text-[10px] text-muted">{group.items.length} item(s)</p>
                    </div>
                  </div>

                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="text-muted border-b border-glass-border">
                        <th className="pb-2 text-left font-semibold">Medicine</th>
                        <th className="pb-2 text-left font-semibold">Batch</th>
                        <th className="pb-2 text-left font-semibold">Expiry</th>
                        <th className="pb-2 text-right font-semibold">Qty</th>
                        <th className="pb-2 text-right font-semibold">Cost</th>
                        <th className="pb-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, i) => (
                        <tr key={i} className="border-b border-glass-border/30 last:border-0 hover:bg-bg3/30">
                          <td className="py-2 text-text font-medium">{item.medicine_name}</td>
                          <td className="py-2 text-muted">{item.batch_no}</td>
                          <td className="py-2 text-muted">{item.expiry_date}</td>
                          <td className="py-2 text-right text-muted">{item.quantity}</td>
                          <td className="py-2 text-right text-muted">₹{item.cost_price}</td>
                          <td className="py-2 text-right text-text font-semibold">₹{(item.cost_price * item.quantity).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-3 border-t border-glass-border flex-shrink-0">
              <button
                onClick={() => setShowGroupedPreview(false)}
                className="bg-bg3 hover:bg-bg3/80 text-text border border-glass-border px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={processReturn}
                disabled={saving}
                className="bg-green hover:bg-green/90 text-white px-6 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 active:scale-95"
              >
                {saving ? 'Processing...' : 'Confirm & Process All'}
              </button>
            </div>
          </div>
        </div>,
        document.body
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
