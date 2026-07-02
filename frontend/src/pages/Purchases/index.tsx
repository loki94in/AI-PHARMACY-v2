// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Edit, Camera, CheckCircle, Mail, Package, TrendingDown, X, Plus, BookOpen, AlertTriangle, ShieldAlert, Factory, RefreshCw } from 'lucide-react';
import { api, apiClient } from '../../services/api';
import { PriceIntelPanel } from '../../components/PriceIntelPanel';
import { HoverPriceIntelTable } from '../../components/HoverPriceIntelTable';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';

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

interface Medicine {
  id: number;
  name: string;
  generic_name: string;
  manufacturer: string;
  pack_unit: string;
  strength: string;
  mrp: number;
  rate: number;
  scheme_paid: number;
  scheme_free: number;
  cgst_per: number;
  sgst_per: number;
  hsn_code: string;
}

interface BillItem {
  id: string;
  medicine_id: number | null;
  medicine_name: string;
  original_name?: string;
  manufacturer?: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  free_qty: number;
  rate: number;
  mrp: number;
  cgst_per: number;
  sgst_per: number;
  cd_rs: number;
  cd_per: number;
  additional_discount: number;
  amount: number;
  scheme_paid: number;
  scheme_free: number;
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

const getInitialPurchasesTabs = () => {
  const saved = localStorage.getItem('purchase_tabs');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validTabs = parsed.filter(t => t && typeof t === 'object');
        if (validTabs.length > 0) return validTabs;
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
      grnNo: `P-${Math.floor(100 + Math.random()*900)}`,
      invoiceDate: new Date().toISOString().split('T')[0],
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

const getInitialPurchasesActiveTabId = (initialTabs: any[]) => {
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

let cachedDistributors: any[] | null = null;
let cachedPurchaseHistory: any[] | null = null;

const Purchases: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initialTabs = getInitialPurchasesTabs();
  const initialActiveTabId = getInitialPurchasesActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t && t.id === initialActiveTabId) || initialTabs[0] || {};

  const [tabs, setTabs] = useState<any[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  const [distributors, setDistributors] = useState<Distributor[]>(cachedDistributors || []);
  const [selectedDistributor, setSelectedDistributor] = useState<number | null>(initialActiveTab?.selectedDistributor || null);
  const [distributorSearch, setDistributorSearch] = useState(initialActiveTab?.distributorSearch || '');
  const [showDistributorDropdown, setShowDistributorDropdown] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState(initialActiveTab?.invoiceNo || '');
  const [grnNo, setGrnNo] = useState(initialActiveTab?.grnNo || '');
  const [invoiceDate, setInvoiceDate] = useState(initialActiveTab?.invoiceDate || '');
  const [globalCdPer, setGlobalCdPer] = useState(initialActiveTab?.globalCdPer !== undefined && initialActiveTab?.globalCdPer !== 0 ? initialActiveTab.globalCdPer : '');
  const [extraCredit, setExtraCredit] = useState(initialActiveTab?.extraCredit !== undefined && initialActiveTab?.extraCredit !== 0 ? initialActiveTab.extraCredit : '');
  const [cnAmount, setCnAmount] = useState(initialActiveTab?.cnAmount !== undefined && initialActiveTab?.cnAmount !== 0 ? initialActiveTab.cnAmount : '');
  const [cnNumber, setCnNumber] = useState(initialActiveTab?.cnNumber || '');
  const [reconcileExpiryReturnId, setReconcileExpiryReturnId] = useState<number | null>(initialActiveTab?.reconcileExpiryReturnId || null);
  const [pendingReturns, setPendingReturns] = useState<any[]>([]);
  const [showCreditNotesPanel, setShowCreditNotesPanel] = useState(false);
  const [items, setItems] = useState<BillItem[]>(initialActiveTab?.items || []);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>(cachedPurchaseHistory || []);
  const [sourceFilename, setSourceFilename] = useState(initialActiveTab?.sourceFilename || '');
  const [sourceFileHeaders, setSourceFileHeaders] = useState<string[]>(initialActiveTab?.sourceFileHeaders || []);
  const [mappingConfig, setMappingConfig] = useState<Record<string, string>>(initialActiveTab?.mappingConfig || {});
  const [editPurchaseId, setEditPurchaseId] = useState<number | null>(initialActiveTab?.editPurchaseId || null);
  // emailSource: set when navigating from Mail page
  const emailSource = location.state?.emailSource || null;
  // Track which row has the price intel panel open (by item id)
  const [openIntelPanels, setOpenIntelPanels] = useState<Record<string, boolean>>({});
  
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);

  const handleGlobalCdChange = (newVal: number) => {
    setGlobalCdPer(newVal);
    setItems(prevItems => prevItems.map(item => {
      const updated = { ...item, cd_per: newVal };
      updated.amount = calculateItemAmount(updated);
      return updated;
    }));
  };

  // Sync current active inputs into tabs array
  useEffect(() => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      if (idx === -1) return prev;
      const t = prev[idx];
      if (
        t.selectedDistributor !== selectedDistributor ||
        t.distributorSearch !== distributorSearch ||
        t.invoiceNo !== invoiceNo ||
        t.grnNo !== grnNo ||
        t.invoiceDate !== invoiceDate ||
        t.globalCdPer !== globalCdPer ||
        t.extraCredit !== extraCredit ||
        t.cnAmount !== cnAmount ||
        t.cnNumber !== cnNumber ||
        t.reconcileExpiryReturnId !== reconcileExpiryReturnId ||
        t.items !== items ||
        t.sourceFilename !== sourceFilename ||
        t.sourceFileHeaders !== sourceFileHeaders ||
        t.mappingConfig !== mappingConfig ||
        t.editPurchaseId !== editPurchaseId
      ) {
        const next = [...prev];
        next[idx] = {
          ...t,
          selectedDistributor,
          distributorSearch,
          invoiceNo,
          grnNo,
          invoiceDate,
          globalCdPer,
          extraCredit,
          cnAmount,
          cnNumber,
          reconcileExpiryReturnId,
          items,
          sourceFilename,
          sourceFileHeaders,
          mappingConfig,
          editPurchaseId
        };
        return next;
      }
      return prev;
    });
  }, [
    selectedDistributor,
    distributorSearch,
    invoiceNo,
    grnNo,
    invoiceDate,
    globalCdPer,
    extraCredit,
    cnAmount,
    cnNumber,
    reconcileExpiryReturnId,
    items,
    sourceFilename,
    sourceFileHeaders,
    mappingConfig,
    activeTabId
  ]);

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
    const newId = 'bill_' + Date.now();
    const newTab = {
      id: newId,
      name: `Bill ${nextNum}`,
      selectedDistributor: null,
      distributorSearch: '',
      invoiceNo: '',
      grnNo: `P-${Math.floor(100 + Math.random()*900)}`,
      invoiceDate: new Date().toISOString().split('T')[0],
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
        grnNo: `P-${Math.floor(100 + Math.random()*900)}`,
        invoiceDate: new Date().toISOString().split('T')[0],
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
      setGrnNo(`P-${Math.floor(100 + Math.random()*900)}`);
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
      setActiveTabId(fallback.id);
    }
    setTabs(filtered.map((t, idx) => ({
      ...t,
      name: t.name.startsWith('Bill ') ? `Bill ${idx + 1}` : t.name
    })));
  };

  const savePurchaseRef = useRef<any>(null);
  const addNewItemRef = useRef<any>(null);
  useEffect(() => {
    savePurchaseRef.current = savePurchase;
    addNewItemRef.current = addNewItem;
  });

  // Keyboard shortcut listeners (e.g. 'Alt+E' or 'F8' for quick edit medicine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;

      // Ctrl + S: Save Purchase Bill
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePurchaseRef.current();
        return;
      }

      // Alt + A: Add New Item
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        addNewItemRef.current();
        return;
      }

      // Escape: Close Overlays / Modals
      if (e.key === 'Escape') {
        setShowBarcodeModal(false);
        setShowUploadModal(false);
        setShowDistributorModal(false);
        setShowPriceHistoryModal(false);
        setShowMedicineModal(false);
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
      cgst_per: '',
      sgst_per: '',
      cd_rs: '',
      cd_per: globalCdPer || '',
      additional_discount: '',
      amount: 0,
      scheme_paid: 0,
      scheme_free: 0,
    };
  }

  // Helper to get date N days ago in YYYY-MM-DD format
  const getNDaysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  };

  // History list filter states
  const [filterDistributor, setFilterDistributor] = useState('');
  const [filterInvoice, setFilterInvoice] = useState('');
  const [filterStartDate, setFilterStartDate] = useState(getNDaysAgo(13));
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');

  const [saving, setSaving] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState('');
  const [lastSavedItems, setLastSavedItems] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<Medicine[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [schemeMatchStatus, setSchemeMatchStatus] = useState<{ [key: string]: string }>({});
  const [showDistributorModal, setShowDistributorModal] = useState(false);
  const [editDistributorId, setEditDistributorId] = useState<number | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<any>(null);
  const [newDistributor, setNewDistributor] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    state_code: '',
  });
  const [savingDistributor, setSavingDistributor] = useState(false);
  const [showPriceHistoryModal, setShowPriceHistoryModal] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [priceHistoryMedicine, setPriceHistoryMedicine] = useState('');
  const [showMedicineModal, setShowMedicineModal] = useState(false);
  const [newMedicine, setNewMedicine] = useState({
    name: '',
    generic_name: '',
    manufacturer: '',
    marketed_by: '',
    pack_unit: 'Tablet',
    strength: '',
    pack_size: '',
    cgst_per: 5,
    sgst_per: 5,
    hsn_code: '',
  });
  const [savingMedicine, setSavingMedicine] = useState(false);
  const [activeMedicineIndex, setActiveMedicineIndex] = useState<number | null>(null);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);

  const handleMfgChange = async (val: string) => {
    setNewMedicine(prev => ({ ...prev, manufacturer: val }));
    try {
      const res = await api.getManufacturers(val);
      setMfgSuggestions(res || []);
      setShowMfgSuggestions(true);
    } catch (err) {
      console.error('Error fetching manufacturers:', err);
    }
  };

  const handleMfgFocus = async (val: string) => {
    try {
      const res = await api.getManufacturers(val);
      setMfgSuggestions(res || []);
      setShowMfgSuggestions(true);
    } catch (err) {
      console.error('Error fetching manufacturers:', err);
    }
  };

  // Enrichment Drawer States
  const [selectedEnrichedItem, setSelectedEnrichedItem] = useState<any>(null);
  const [enrichedData, setEnrichedData] = useState<any>(null);
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
      .then((res: any) => {
        if (res.success) {
          setEnrichedData(res.enrichment);
        }
        setDetailsLoading(false);
      })
      .catch((err: any) => {
        console.error('Error fetching enrichment data:', err);
        setDetailsLoading(false);
      });
  };





  useDeferredEffect(() => {
    fetchDistributors();
    fetchPurchaseHistory();
  }, []);

  const fetchPendingReturns = async (distId: number) => {
    try {
      const response = await api.getPendingReturns(distId);
      setPendingReturns(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Error fetching pending returns:', error);
      setPendingReturns([]);
    }
  };

  useEffect(() => {
    if (selectedDistributor) {
      fetchPendingReturns(selectedDistributor);
    } else {
      setPendingReturns([]);
    }
  }, [selectedDistributor]);

  const fetchDistributors = async () => {
    try {
      const response = await api.getDistributors();
      const list = Array.isArray(response) ? response : (response.data || []);
      setDistributors(list);
      cachedDistributors = list;
    } catch (error) {
      console.error('Error fetching distributors:', error);
    }
  };

  const fetchPurchaseHistory = async () => {
    try {
      const list = await api.getPurchases();
      // STRICT RULE: Only show last 100
      const historyList = Array.isArray(list) ? list.slice(0, 100) : [];
      setPurchaseHistory(historyList);
      cachedPurchaseHistory = historyList;
    } catch (err) {
      console.error('Error fetching purchase history:', err);
    }
  };

  const saveDistributor = async () => {
    if (!newDistributor.name?.trim()) {
      alert('Distributor name is required');
      return;
    }
    if (!newDistributor.phone?.trim()) {
      alert('Distributor phone number is required');
      return;
    }
    if (!newDistributor.address?.trim()) {
      alert('Distributor address is required');
      return;
    }
    if (!newDistributor.state_code?.trim()) {
      alert('Distributor state code is required');
      return;
    }

    setSavingDistributor(true);
    try {
      if (editDistributorId) {
        const response = await apiClient.put(`/settings/distributors/${editDistributorId}`, newDistributor);
        const saved = response.data.data || response.data;
        setDistributors(distributors.map(d => d.id === editDistributorId ? saved : d));
        setSelectedDistributor(saved.id);
        setDistributorSearch(saved.name);
      } else {
        const response = await apiClient.post('/settings/distributors', newDistributor);
        const saved = response.data.data || response.data;
        setDistributors([...distributors, saved]);
        setSelectedDistributor(saved.id);
        setDistributorSearch(saved.name);
      }
      
      setNewDistributor({ name: '', phone: '', email: '', address: '', state_code: '' });
      setEditDistributorId(null);
      setShowDistributorModal(false);
    } catch (error) {
      console.error('Error saving distributor:', error);
      alert('Failed to save distributor');
    } finally {
      setSavingDistributor(false);
    }
  };

  const saveMedicine = async () => {
    if (!newMedicine.name) {
      alert('Medicine name is required');
      return;
    }

    setSavingMedicine(true);
    try {
      const response = await apiClient.post('/medicines', newMedicine);
      const saved = response.data.data;
      
      // Auto-select in the current row
      if (activeMedicineIndex !== null) {
        const newItems = [...items];
        const item = newItems[activeMedicineIndex];
        item.medicine_id = saved.id;
        item.medicine_name = saved.name;
        item.mrp = saved.mrp;
        item.rate = saved.rate;
        item.cgst_per = saved.cgst_per;
        item.sgst_per = saved.sgst_per;
        item.scheme_paid = saved.scheme_paid;
        item.scheme_free = saved.scheme_free;
        item.amount = calculateItemAmount(item);
        setItems(newItems);
      }
      
      setNewMedicine({
        name: '', generic_name: '', manufacturer: '', marketed_by: '',
        pack_unit: 'Tablet', strength: '', pack_size: '',
        cgst_per: 5, sgst_per: 5, hsn_code: '',
      });
      setShowMedicineModal(false);
      setActiveMedicineIndex(null);
    } catch (error) {
      console.error('Error saving medicine:', error);
      alert('Failed to save medicine');
    } finally {
      setSavingMedicine(false);
    }
  };

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
          const response = await api.catalogSearch(term);
          setSearchResults(response || []);
        } catch (error) {
          console.error('Error prefetching medicines:', error);
        }
      }, 150);
      return;
    }

    // >= 3 characters: show dropdown immediately
    setActiveSearchIndex(index);
    setActiveMedicineIndex(index);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await api.catalogSearch(term);
        setSearchResults(response || []);
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

  const fetchPriceHistory = async (medicineName: string) => {
    try {
      const response = await apiClient.get(`/purchases/price-history?name=${encodeURIComponent(medicineName)}`);
      setPriceHistory(response.data.data || []);
      setPriceHistoryMedicine(medicineName);
      setShowPriceHistoryModal(true);
    } catch (error) {
      console.error('Error fetching price history:', error);
    }
  };

  const selectMedicine = async (medicine: Medicine, index: number) => {
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
    item.cgst_per = medicine.cgst_per;
    item.sgst_per = medicine.sgst_per;
    item.scheme_paid = medicine.scheme_paid;
    item.scheme_free = medicine.scheme_free;

    // PU4: Run alias creation and last purchase lookup in parallel
    const aliasPromise = (item.original_name && item.original_name !== medicine.name)
      ? api.createMedicineAlias(item.original_name, medicine.id).catch(e => console.error('Failed to create alias:', e))
      : Promise.resolve();

    const lastPurchasePromise = api.getLastPurchase(medicine.name, selectedDistributor || undefined)
      .catch(e => {
        console.log('No last purchase found for this medicine');
        return null;
      });

    const [, response] = await Promise.all([aliasPromise, lastPurchasePromise]);
    
    if (response && response.found) {
      const lastPurchase = response;
      item.batch_no = lastPurchase.batch_no || '';
      item.expiry_date = formatExpiryToMMYY(lastPurchase.expiry_date || '');
      item.rate = lastPurchase.rate || medicine.rate;
      item.mrp = lastPurchase.mrp || medicine.mrp;
      item.cgst_per = lastPurchase.cgst_per !== undefined ? lastPurchase.cgst_per : medicine.cgst_per;
      item.sgst_per = lastPurchase.sgst_per !== undefined ? lastPurchase.sgst_per : medicine.sgst_per;
    }

    item.amount = calculateItemAmount(item);

    setItems(newItems);
    setSearchResults([]);
    setActiveSearchIndex(null);
  };

  const calculateItemAmount = (item: BillItem): number => {
    const qty = parseFloat(item.qty as any) || 0;
    const rate = parseFloat(item.rate as any) || 0;
    const cd_rs = parseFloat(item.cd_rs as any) || 0;
    const cd_per = parseFloat(item.cd_per as any) || 0;
    const additional_discount = parseFloat(item.additional_discount as any) || 0;
    const cgst_per = parseFloat(item.cgst_per as any) || 0;
    const sgst_per = parseFloat(item.sgst_per as any) || 0;

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
      const { editPurchaseId, distributorName, invoiceNo: prefInvoiceNo, date: prefDate, items: prefilledItems, globalCdPer: prefGlobalCdPer, totalAmount: prefTotalAmount, cnAmount: prefCnAmount, cnNumber: prefCnNumber, reconcileExpiryReturnId: prefReconcileExpiryReturnId, source_filename, source_file_headers, mapping_config } = location.state.prefilledPurchase;
      
      if (editPurchaseId) setEditPurchaseId(editPurchaseId);
      if (prefInvoiceNo) setInvoiceNo(prefInvoiceNo);
      if (prefDate) setInvoiceDate(prefDate);
      if (prefCnAmount !== undefined) setCnAmount(prefCnAmount);
      if (prefCnNumber !== undefined) setCnNumber(prefCnNumber);
      if (prefReconcileExpiryReturnId !== undefined) setReconcileExpiryReturnId(prefReconcileExpiryReturnId);
      if (prefGlobalCdPer !== undefined) setGlobalCdPer(prefGlobalCdPer);
      if (source_filename) setSourceFilename(source_filename);
      if (source_file_headers) setSourceFileHeaders(source_file_headers);
      if (mapping_config) setMappingConfig(mapping_config);
      
      // Try to find matching distributor in distributors list
      if (distributorName) {
        setDistributorSearch(distributorName);
        if (distributors.length > 0) {
          const matched = distributors.find(
            (d) => d.name && d.name.toLowerCase().includes(distributorName.toLowerCase()) ||
                   distributorName && distributorName.toLowerCase().includes(d.name && d.name.toLowerCase())
          );
          if (matched) {
            setSelectedDistributor(matched.id);
            setDistributorSearch(matched.name || '');
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
            currentItems.forEach((item: any) => {
              const qty = parseFloat(item.qty as any) || 0;
              const rate = parseFloat(item.rate as any) || 0;
              const cd_rs = parseFloat(item.cd_rs as any) || 0;
              const cd_per = parseFloat(item.cd_per as any) || 0;
              const additional_discount = parseFloat(item.additional_discount as any) || 0;
              const cgst_per = parseFloat(item.cgst_per as any) || 0;
              const sgst_per = parseFloat(item.sgst_per as any) || 0;

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
          const calculateSimilarity = (s1: string, s2: string): number => {
            const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
            const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (clean1 === clean2) return 1.0;
            if (!clean1 || !clean2) return 0.0;

            const track = Array(clean2.length + 1).fill(null).map(() =>
              Array(clean1.length + 1).fill(null));
            for (let i = 0; i <= clean1.length; i += 1) {
              track[0][i] = i;
            }
            for (let j = 0; j <= clean2.length; j += 1) {
              track[j][0] = j;
            }
            for (let j = 1; j <= clean2.length; j += 1) {
              for (let i = 1; i <= clean1.length; i += 1) {
                const indicator = clean1[i - 1] === clean2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(
                  track[j][i - 1] + 1, // deletion
                  track[j - 1][i] + 1, // insertion
                  track[j - 1][i - 1] + indicator // substitution
                );
              }
            }
            const distance = track[clean2.length][clean1.length];
            const maxLen = Math.max(clean1.length, clean2.length);
            return 1.0 - distance / maxLen;
          };

          const updatedItems = loadedItems.map(item => ({ ...item, original_name: item.medicine_name }));
          let hasChanges = false;
          
          for (let i = 0; i < updatedItems.length; i++) {
            const mName = updatedItems[i].original_name;
            if (!mName) continue;
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
                hasChanges = true;
                continue;
              }

              // 2. Fallback to catalog search for EXACT matches or FUZZY matches
              let searchResults = [];
              try {
                searchResults = await api.catalogSearch(mName);
              } catch (e) {
                searchResults = [];
              }
              
              let matchedList = searchResults || [];
              let bestMatch = null;

              // Check for exact match first
              if (matchedList.length > 0) {
                bestMatch = matchedList.find((m: any) => m.name && m.name.toLowerCase() === mName.toLowerCase());
              }

              // If no exact match, calculate similarities and find the best one >= 0.60
              if (!bestMatch && matchedList.length > 0) {
                const scored = matchedList.map((m: any) => ({
                  item: m,
                  score: calculateSimilarity(mName, m.name)
                })).filter(s => s.score >= 0.60);
                
                if (scored.length > 0) {
                  scored.sort((a, b) => b.score - a.score);
                  bestMatch = scored[0].item;
                }
              }

              // If still no match, try searching for the first word/token of length >= 3
              if (!bestMatch) {
                const parts = mName.split(/[\s\-]+/);
                let tokens = parts[0];
                const genericPrefixes = ['tab', 'tabs', 'cap', 'caps', 'inj', 'syp', 'susp', 'tablet', 'capsule', 'injection', 'syrup', 'drop', 'drops', 'ointment', 'cream', 'gel'];
                if (tokens && (genericPrefixes.includes(tokens.toLowerCase()) || tokens.length < 3) && parts.length > 1) {
                  tokens = parts[1];
                }
                if (tokens && tokens.length >= 3) {
                  let tokenResults = [];
                  try {
                    tokenResults = await api.catalogSearch(tokens);
                  } catch (e) {}
                  
                  const scored = (tokenResults || []).map((m: any) => ({
                    item: m,
                    score: calculateSimilarity(mName, m.name)
                  })).filter(s => s.score >= 0.60);

                  if (scored.length > 0) {
                    scored.sort((a, b) => b.score - a.score);
                    bestMatch = scored[0].item;
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
  }, [location.state, distributors, navigate, location.pathname]);

  const updateItem = (index: number, field: keyof BillItem, value: any) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'qty' || field === 'free_qty' || field === 'rate' || field === 'mrp' || 
        field === 'cgst_per' || field === 'sgst_per' || field === 'cd_rs' || field === 'cd_per' || field === 'additional_discount') {
      const parsedVal = parseFloat(value);
      (item as any)[field] = value === '' ? '' : (isNaN(parsedVal) ? 0 : parsedVal);
      
      // Auto match SGST and CGST
      if (field === 'sgst_per') {
        item.cgst_per = item.sgst_per;
      } else if (field === 'cgst_per') {
        item.sgst_per = item.cgst_per;
      }
    } else if (field === 'expiry_date') {
      (item as any)[field] = formatExpiryToMMYY(value);
    } else {
      (item as any)[field] = value;
    }

    if (field === 'qty' && item.scheme_paid > 0) {
      const qty = parseFloat(item.qty as any) || 0;
      const expectedFree = Math.floor(qty / item.scheme_paid) * item.scheme_free;
      const freeQty = parseFloat(item.free_qty as any) || 0;
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

  const calculateTotals = () => {
    let grossAmount = 0;
    let totalCd = 0;
    let subtotal = 0; // Taxable Amount (after CD)
    let totalCgst = 0;
    let totalSgst = 0;

    items.forEach(item => {
      const qty = parseFloat(item.qty as any) || 0;
      const rate = parseFloat(item.rate as any) || 0;
      const cd_rs = parseFloat(item.cd_rs as any) || 0;
      const cd_per = parseFloat(item.cd_per as any) || 0;
      const additional_discount = parseFloat(item.additional_discount as any) || 0;
      const cgst_per = parseFloat(item.cgst_per as any) || 0;
      const sgst_per = parseFloat(item.sgst_per as any) || 0;

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

    const cnVal = parseFloat(cnAmount as any) || 0;
    const grandTotal = subtotal + totalCgst + totalSgst - cnVal;

    return {
      grossAmount,
      totalCd,
      subtotal,
      totalCgst,
      totalSgst,
      grandTotal,
    };
  };

  const savePurchase = async () => {
    const distExists = selectedDistributor && distributors.some(d => d.id === selectedDistributor);
    const searchMatchExists = distributors.some(d => {
      const name = d.name || d.distributor_name || '';
      return name.trim().toLowerCase() === distributorSearch.trim().toLowerCase();
    });

    if (!selectedDistributor || !distExists || !searchMatchExists) {
      alert('This distributor is new or unsaved. Please save the distributor details first by clicking the "+" button before saving the bill.');
      return;
    }

    if (!invoiceNo) {
      alert('Please fill in the invoice number');
      return;
    }

    const validItems = items.filter(item => {
      const qty = parseFloat(item.qty as any) || 0;
      return (item.medicine_id || (item.medicine_name && item.medicine_name.trim())) && qty > 0;
    });
    if (validItems.length === 0) {
      alert('Please add at least one medicine with quantity');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        distributor_id: selectedDistributor,
        invoice_no: invoiceNo,
        date: invoiceDate,
        cd_per: parseFloat(globalCdPer as any) || 0,
        extra_credit: parseFloat(cnAmount as any) || 0,
        cn_amount: parseFloat(cnAmount as any) || 0,
        cn_number: cnNumber,
        reconcile_expiry_return_id: reconcileExpiryReturnId,
        source_filename: sourceFilename,
        source_file_headers: sourceFileHeaders,
        mapping_config: mappingConfig,
        // If this bill was created from a Mail page email, pass the UID so the
        // backend marks the email as saved (keeps it visible for the 3-day retention window)
        email_uid: emailSource?.email_uid || null,
        items: validItems.map(item => ({
          medicine_id: item.medicine_id,
          medicine: item.medicine_name,
          original_name: item.original_name,
          batch_no: item.batch_no,
          expiry_date: item.expiry_date,
          qty: parseFloat(item.qty as any) || 0,
          free_qty: parseFloat(item.free_qty as any) || 0,
          rate: parseFloat(item.rate as any) || 0,
          mrp: parseFloat(item.mrp as any) || 0,
          cgst_per: parseFloat(item.cgst_per as any) || 0,
          sgst_per: parseFloat(item.sgst_per as any) || 0,
          cd_rs: parseFloat(item.cd_rs as any) || 0,
          cd_per: parseFloat(item.cd_per as any) || 0,
          additional_discount: parseFloat(item.additional_discount as any) || 0,
        })),
      };

      let response;
      if (editPurchaseId) {
        response = await api.updatePurchase(editPurchaseId, {
          ...payload,
          distributor: distributorSearch
        });
      } else {
        response = await api.createManualPurchase(payload);
      }

      const savedInvoiceNo = response?.app_invoice_no || invoiceNo;
      setLastSavedInvoiceNo(savedInvoiceNo);
      setLastSavedItems(validItems.map(item => ({
        name: item.medicine_name,
        batch: item.batch_no || 'N/A'
      })));
      setShowBarcodeModal(true);
      
      const nextGrn = `P-${Math.floor(100 + Math.random()*900)}`;
      setItems([createEmptyItem()]);
      setSelectedDistributor(null);
      setDistributorSearch('');
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
      fetchPurchaseHistory();
    } catch (error: any) {
      console.error('Error saving purchase:', error);
      const errMsg = error.response?.data?.error || error.message || 'Failed to save purchase';
      alert(errMsg);
    } finally {
      setSaving(false);
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

      const parsedItems = response.data.data;
      const parsedGlobalCdPer = response.data.global_cd_per || '';
      let newItems = parsedItems.map((item: any) => ({
        ...createEmptyItem(),
        medicine_name: item.name,
        original_name: item.name,
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
          const res = await api.catalogSearch(mName);
          const matchedList = res || [];
          if (matchedList.length > 0) {
            const match = matchedList.find((m: any) => m.name && m.name.toLowerCase() === mName.toLowerCase());
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

      newItems.forEach((item: any) => {
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
      }

      if (response.data.global_cd_per !== undefined) {
        setGlobalCdPer(response.data.global_cd_per || '');
      }

      if (response.data.distributor_name) {
        setDistributorSearch(response.data.distributor_name);
        const match = distributors.find((d: any) => d.name && d.name.toLowerCase() === response.data.distributor_name.toLowerCase());
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
        newItems.forEach((item: any) => {
          const qty = parseFloat(item.qty as any) || 0;
          const rate = parseFloat(item.rate as any) || 0;
          const cd_rs = parseFloat(item.cd_rs as any) || 0;
          const cd_per = parseFloat(item.cd_per as any) || 0;
          const additional_discount = parseFloat(item.additional_discount as any) || 0;
          const cgst_per = parseFloat(item.cgst_per as any) || 0;
          const sgst_per = parseFloat(item.sgst_per as any) || 0;

          const baseAmount = qty * rate;
          const discountAmount = cd_rs + additional_discount + (baseAmount * cd_per / 100);
          const taxableAmount = baseAmount - discountAmount;
          const cgstAmount = taxableAmount * cgst_per / 100;
          const sgstAmount = taxableAmount * sgst_per / 100;

          subtotal += taxableAmount;
          totalCgst += cgstAmount;
          totalSgst += sgstAmount;
        });

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

  const filteredHistory = purchaseHistory.filter(purchase => {
    const matchesDistributor = !filterDistributor.trim() || 
      (purchase.distributor_name && purchase.distributor_name.toLowerCase().includes(filterDistributor.toLowerCase()));
      
    const matchesInvoice = !filterInvoice.trim() || 
      (purchase.invoice_no && purchase.invoice_no.toLowerCase().includes(filterInvoice.toLowerCase()));
      
    const matchesDateRange = (() => {
      if (!purchase.date) return false;
      const pDate = purchase.date.substring(0, 10);
      const start = filterStartDate || '0000-00-00';
      const end = filterEndDate || '9999-99-99';
      return pDate >= start && pDate <= end;
    })();
      
    const matchesMinAmount = !filterMinAmount || 
      purchase.total_amount >= Number(filterMinAmount);
      
    const matchesMaxAmount = !filterMaxAmount || 
      purchase.total_amount <= Number(filterMaxAmount);
      
    return !!(matchesDistributor && matchesInvoice && matchesDateRange && matchesMinAmount && matchesMaxAmount);
  });

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

  return (
    <div className="h-full flex flex-col px-6 pt-0 pb-0 animate-in fade-in duration-500">


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

      {/* Header Section */}
      <div className="relative z-30 bg-white/10 backdrop-blur-lg rounded-t-xl p-4 pb-3 border border-white/20 border-b-0">
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
                  onClick={() => switchTab(t.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-semibold text-xs transition-all select-none cursor-pointer flex-shrink-0 whitespace-nowrap ${
                    isActive 
                      ? 'bg-primary/20 border-primary text-primary font-bold' 
                      : 'bg-white/5 border-glass-border text-muted hover:text-text hover:bg-white/10'
                  }`}
                >
                  <Package size={12} className={isActive ? 'text-primary' : 'text-muted'} />
                  <span>{displayName} ({count})</span>
                  <span 
                    onClick={(e) => closeTab(t.id, e)}
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
            <label className="block text-sm font-medium text-gray-300 mb-1">Distributor *</label>
            <div className="flex gap-1">
              <div className="flex-1 min-w-0 relative">
                <input
                  type="text"
                  value={distributorSearch}
                  onChange={(e) => {
                    setDistributorSearch(e.target.value);
                    setShowDistributorDropdown(true);
                    if (e.target.value === '') {
                      setSelectedDistributor(null);
                    }
                  }}
                  onFocus={() => setShowDistributorDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDistributorDropdown(false), 200)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Type to search distributor..."
                />
                {showDistributorDropdown && (
                  <div className="absolute z-dropdown w-full mt-1 bg-[#18181b]/95 backdrop-blur border border-glass-border rounded-xl overflow-hidden max-h-60 overflow-y-auto shadow-2xl">
                    {distributorSearch === '' ? (
                      distributors.slice(0, 50).map((dist) => {
                        const distName = dist.name || dist.distributor_name || 'Unnamed Distributor';
                        return (
                        <button
                          key={dist.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedDistributor(dist.id);
                            setDistributorSearch(distName);
                            setShowDistributorDropdown(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-white/10 text-text text-sm"
                        >
                          {distName}
                          {dist.phone && <span className="text-gray-400 ml-2">({dist.phone})</span>}
                        </button>
                        );
                      })
                    ) : (
                      // Filter distributors when search has value
                      distributors
                        .filter((d) => {
                          const distName = d.name || d.distributor_name || '';
                          return distName.toLowerCase().includes(distributorSearch.toLowerCase());
                        })
                        .map((dist) => {
                          const distName = dist.name || dist.distributor_name || 'Unnamed Distributor';
                          return (
                          <button
                            key={dist.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSelectedDistributor(dist.id);
                              setDistributorSearch(distName);
                              setShowDistributorDropdown(false);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-white/10 text-text text-sm"
                          >
                            {distName}
                            {dist.phone && <span className="text-gray-400 ml-2">({dist.phone})</span>}
                          </button>
                          );
                        })
                    )}
                    {distributorSearch === ''
                      ? (distributors.length === 0 && (
                        <div className="px-4 py-2 text-muted text-sm">No distributors available</div>
                      ))
                      : (distributors.filter((d) => {
                        const distName = d.name || d.distributor_name || '';
                        return distName.toLowerCase().includes(distributorSearch.toLowerCase());
                      }).length === 0 && (
                        <div className="px-4 py-2 text-muted text-sm">No match found. Click + to add.</div>
                      ))}
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
          <div className="w-36">
            <label className="block text-sm font-medium text-gray-300 mb-1">Invoice No *</label>
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="INV-001"
            />
          </div>

          {/* GRN No */}
          <div className="w-40">
            <label className="block text-sm font-medium text-gray-300 mb-1">GRN No</label>
            <input
              type="text"
              value={grnNo}
              onChange={(e) => setGrnNo(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
              title="Goods Receipt Note"
            />
          </div>

          {/* Date */}
          <div className="w-36">
            <label className="block text-sm font-medium text-gray-300 mb-1">Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
              <div className="absolute z-dropdown w-64 mt-1 bg-gray-900/95 backdrop-blur-md border border-purple-500/30 rounded-xl shadow-2xl p-2 max-h-48 overflow-y-auto">
                <p className="text-[10px] text-purple-300 font-bold uppercase tracking-wider mb-1.5 px-2 border-b border-purple-500/20 pb-1">Select Return Credit Note</p>
                {pendingReturns.map(ret => (
                  <button
                    key={ret.id}
                    type="button"
                    onClick={() => {
                      setCnNumber(ret.return_no || `CN-${ret.id}`);
                      setCnAmount(ret.expected_credit_amount);
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
      <div className="bg-white/10 backdrop-blur-lg rounded-none p-4 pt-3 border border-white/20 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
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
                <th className="pb-3 text-xs uppercase tracking-wider text-left pl-2">Original Bill Name</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-left">Medicine Name</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-left">Batch</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center">Exp</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-right">Rate</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-right">MRP</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center">Qty</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center">Free</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center" title="Input SGST">SGST%</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center" title="Input CGST">CGST%</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-center">CD %</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-right">CD ₹</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-right" title="Additional Discount in Rupees">Add. Disc. (₹)</th>
                <th className="pb-3 text-xs uppercase tracking-wider text-right pr-2">Amount</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const qtyVal = parseFloat(item.qty as any) || 0;
                const rateVal = parseFloat(item.rate as any) || 0;
                const mrpVal = parseFloat(item.mrp as any) || 0;
                const cdRsVal = parseFloat(item.cd_rs as any) || 0;
                const cdPerVal = parseFloat(item.cd_per as any) || 0;
                const addDiscVal = parseFloat(item.additional_discount as any) || 0;
                const cgstPerVal = parseFloat(item.cgst_per as any) || 0;
                const sgstPerVal = parseFloat(item.sgst_per as any) || 0;
                const baseAmount = qtyVal * rateVal;
                const discountAmount = cdRsVal + addDiscVal + (baseAmount * cdPerVal / 100);
                const taxableAmount = baseAmount - discountAmount;
                const cgstAmount = taxableAmount * cgstPerVal / 100;
                const sgstAmount = taxableAmount * sgstPerVal / 100;
                const rowAmount = taxableAmount + cgstAmount + sgstAmount;
                return (
                  <tr key={item.id} data-medicine-id={item.medicine_id} className="border-b border-white/10">
                  <td className="py-3 text-gray-300">{index + 1}</td>
                  <td className="py-3 pr-2">
                    <span 
                      className="text-xs font-mono text-muted select-all block max-w-[200px] truncate" 
                      title={item.original_name || 'No original name'}
                    >
                      {item.original_name || '-'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="relative group/search">
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={item.medicine_name}
                          onChange={(e) => {
                            updateItem(index, 'medicine_name', e.target.value);
                            searchMedicines(e.target.value, index);
                          }}
                          className="flex-1 min-w-[150px] bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm"
                          placeholder="Search medicine..."
                        />
                        {item.medicine_name && (
                          <button
                            onClick={() => fetchPriceHistory(item.medicine_name)}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white w-7 h-7 rounded text-sm flex-shrink-0"
                            title="View price history from all distributors"
                          >
                            📊
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenEnrichment(item)}
                          disabled={!item.medicine_id}
                          className={`w-7 h-7 rounded text-sm flex-shrink-0 flex items-center justify-center border transition-all ${
                            item.medicine_id 
                              ? 'bg-purple-500/20 hover:bg-purple-500/40 border-purple-500/30 text-purple-400' 
                              : 'bg-white/5 border-glass-border text-muted cursor-not-allowed opacity-50'
                          }`}
                          title={item.medicine_id ? "View Medical Profile & Information" : "Select medicine first"}
                        >
                          <BookOpen size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setActiveMedicineIndex(index);
                            setShowMedicineModal(true);
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white w-7 h-7 rounded text-sm font-bold flex-shrink-0"
                          title="Add new medicine"
                        >
                          +
                        </button>
                      </div>
                      {activeSearchIndex === index && (
                        <div className="absolute z-dropdown w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {item.original_name && (
                            <div className="px-4 py-2 bg-blue-500/10 border-b border-glass-border/30 text-xs text-blue-300 font-bold select-none flex items-center gap-1.5 font-mono">
                              📄 Original Bill Name: {item.original_name}
                            </div>
                          )}
                          {searchResults.map((medicine) => (
                            <button
                              key={medicine.id}
                              onClick={() => selectMedicine(medicine, index)}
                              className="w-full text-left px-4 py-2 hover:bg-white/10 text-text border-b border-glass-border/10 last:border-0"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate">{medicine.name}</div>
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
                            onClick={() => {
                              setActiveMedicineIndex(index);
                              setNewMedicine(prev => ({
                                ...prev,
                                name: item.medicine_name || item.original_name || ''
                              }));
                              setShowMedicineModal(true);
                              setSearchResults([]);
                              setActiveSearchIndex(null);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-white/10 text-green-400 font-bold border-t border-glass-border/30 flex items-center gap-1.5"
                          >
                            ➕ Add New Medicine
                          </button>
                        </div>
                      )}
                    </div>
                    {schemeMatchStatus[item.id] && (
                      <p className="text-yellow-400 text-xs mt-1">{schemeMatchStatus[item.id]}</p>
                    )}
                  </td>
                  <td className="py-3">
                    <input
                      type="text"
                      value={item.batch_no}
                      onChange={(e) => updateItem(index, 'batch_no', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="text"
                      placeholder="MM/YY"
                      value={item.expiry_date}
                      onChange={(e) => updateItem(index, 'expiry_date', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm font-mono text-center"
                    />
                  </td>
                  <td className="py-3 relative group/btn">
                    <div className="flex items-center bg-white/10 border border-white/20 rounded px-1.5 py-1 w-full min-w-[80px] focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                      {mrpVal > 0 && (
                        <div className="flex-shrink-0 select-none mr-1">
                          {(() => {
                            const marginPercent = ((mrpVal - rateVal) / mrpVal) * 100;
                            return (
                              <span className={`text-[9px] font-bold px-0.5 py-0.2 rounded border inline-block leading-none ${
                                marginPercent > 20 
                                  ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                  : marginPercent > 10 
                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                    : marginPercent > 0 
                                      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                              }`}>
                                {marginPercent.toFixed(1)}%
                              </span>
                            );
                          })()}
                        </div>
                      )}
                      <input
                        type="number"
                        value={item.rate}
                        onChange={(e) => updateItem(index, 'rate', e.target.value)}
                        className="w-full bg-transparent border-0 outline-none text-white text-sm text-right p-0 focus:ring-0 focus:outline-none"
                      />
                    </div>
                    {item.medicine_name && (
                      <div className="absolute z-dropdown top-full left-0 mt-2 hidden group-hover/btn:block min-w-[320px]">
                        <div className="bg-gray-900 border border-blue-500 rounded-lg p-2 shadow-xl">
                          <HoverPriceIntelTable medicineName={item.medicine_name} />
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="py-3 relative group/btn">
                    <input
                      type="number"
                      value={item.mrp}
                      onChange={(e) => updateItem(index, 'mrp', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1.5 py-1 text-white text-sm text-right"
                    />
                    {item.medicine_name && (
                      <div className="absolute z-dropdown top-full left-0 mt-2 hidden group-hover/btn:block min-w-[320px]">
                        <div className="bg-gray-900 border border-purple-500 rounded-lg p-2 shadow-xl">
                          <HoverPriceIntelTable medicineName={item.medicine_name} />
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="py-3">
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) => updateItem(index, 'qty', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.free_qty}
                      onChange={(e) => updateItem(index, 'free_qty', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.sgst_per}
                      onChange={(e) => updateItem(index, 'sgst_per', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.cgst_per}
                      onChange={(e) => updateItem(index, 'cgst_per', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.cd_per}
                      onChange={(e) => updateItem(index, 'cd_per', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.cd_rs}
                      onChange={(e) => updateItem(index, 'cd_rs', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1.5 py-1 text-white text-sm text-right"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      value={item.additional_discount}
                      onChange={(e) => updateItem(index, 'additional_discount', e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-1.5 py-1 text-white text-sm text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="py-3 text-white font-medium text-right pr-2">
                    ₹{rowAmount.toFixed(2)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (item.medicine_id) setUniversalEditMedicineId(item.medicine_id);
                        }}
                        disabled={!item.medicine_id}
                        className={`p-1 rounded transition-colors ${item.medicine_id ? 'text-sky-400 hover:text-sky-300' : 'text-gray-600 cursor-not-allowed'}`}
                        title="Quick Edit Medicine"
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
        </div>
      </div>

      {/* ── Auto-updating Bill Summary ── */}
      <div className="bg-white/10 backdrop-blur-lg rounded-b-xl border border-white/20 border-t-0 overflow-hidden shrink-0 mt-0">
        {/* Summary rows */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-white/10">
          {/* Gross Amount */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Gross Amt</span>
            <span className="text-base font-bold text-white">₹{totals.grossAmount.toFixed(2)}</span>
          </div>
          {/* Cash Discount */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">
              Discount (CD)
            </span>
            <span className="text-base font-bold text-red-400">-₹{totals.totalCd.toFixed(2)}</span>
          </div>
          {/* Taxable Subtotal */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Taxable Value</span>
            <span className="text-base font-bold text-white">₹{totals.subtotal.toFixed(2)}</span>
          </div>
          {/* CGST */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">CGST</span>
            <span className="text-base font-bold text-white">₹{totals.totalCgst.toFixed(2)}</span>
          </div>
          {/* SGST */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">SGST</span>
            <span className="text-base font-bold text-white">₹{totals.totalSgst.toFixed(2)}</span>
          </div>
          {/* Credit Note (CN) */}
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">CN Applied</span>
            <span className="text-base font-bold text-red-400" title={cnNumber ? `CN Ref: ${cnNumber}` : undefined}>
              -₹{(parseFloat(cnAmount as any) || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Grand Total + Save */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/20 bg-white/5">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Grand Total (incl. GST)</p>
            <p className="text-3xl font-extrabold text-white tracking-tight">
              ₹{Math.round(totals.grandTotal)}
            </p>
          </div>
          <button
            onClick={savePurchase}
            disabled={saving}
            className="bg-green-600 hover:bg-green-500 active:scale-95 text-white px-10 py-3 rounded-xl font-bold text-base shadow-lg shadow-green-900/30 disabled:opacity-50 transition-all"
          >
            {saving ? '⏳ Saving...' : '💾 Save Purchase'}
          </button>
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
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone *</label>
                <input
                  type="tel"
                  value={newDistributor.phone}
                  onChange={(e) => setNewDistributor({ ...newDistributor, phone: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+91 98765 43210"
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
                <label className="block text-sm font-medium text-gray-300 mb-2">Address *</label>
                <textarea
                  value={newDistributor.address}
                  onChange={(e) => setNewDistributor({ ...newDistributor, address: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Full address"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">State Code *</label>
                <select
                  value={newDistributor.state_code}
                  onChange={(e) => setNewDistributor({ ...newDistributor, state_code: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>Select State Code</option>
                  {INDIAN_STATE_CODES.sort((a, b) => a.name.localeCompare(b.name)).map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.code} - {state.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowDistributorModal(false)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveDistributor}
                disabled={savingDistributor || !newDistributor.name}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {savingDistributor ? 'Saving...' : editDistributorId ? 'Save Changes' : 'Add Distributor'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Medicine Modal */}
      {showMedicineModal && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Add New Medicine</h3>
            
            {activeMedicineIndex !== null && items[activeMedicineIndex]?.original_name && (
              <div className="mb-4 p-3 bg-blue-500/10 border border-glass-border/30 rounded-lg flex items-start gap-2 text-xs text-blue-300 font-mono">
                <span className="text-base select-none">📄</span>
                <div>
                  <span className="font-bold text-gray-300 block mb-0.5 font-sans">Reference Name from Bill:</span>
                  <span className="text-white font-semibold">{items[activeMedicineIndex].original_name}</span>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              {/* Row 1 - Full width */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1">Medicine Name *</label>
                <input
                  type="text"
                  value={newMedicine.name}
                  onChange={(e) => setNewMedicine({ ...newMedicine, name: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Medicine name"
                />
              </div>

              {/* Row 2 - Type & Generic */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Type *</label>
                <select
                  value={newMedicine.pack_unit}
                  onChange={(e) => setNewMedicine({ ...newMedicine, pack_unit: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Tablet">Tablet (Tab)</option>
                  <option value="Capsule">Capsule (Cap)</option>
                  <option value="Syrup">Syrup</option>
                  <option value="Solution">Solution</option>
                  <option value="Suspension">Suspension</option>
                  <option value="Drop">Drop</option>
                  <option value="Injection">Injection</option>
                  <option value="Cream">Cream</option>
                  <option value="Ointment">Ointment</option>
                  <option value="Gel">Gel</option>
                  <option value="Powder">Powder</option>
                  <option value="Inhaler">Inhaler</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Generic Name</label>
                <input
                  type="text"
                  value={newMedicine.generic_name}
                  onChange={(e) => setNewMedicine({ ...newMedicine, generic_name: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Paracetamol"
                />
              </div>

              {/* Row 3 - Strength & Pack */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Strength</label>
                <input
                  type="text"
                  value={newMedicine.strength}
                  onChange={(e) => setNewMedicine({ ...newMedicine, strength: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 500mg, 10ml"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Pack</label>
                <input
                  type="text"
                  value={newMedicine.pack_size}
                  onChange={(e) => setNewMedicine({ ...newMedicine, pack_size: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 1x10 Tab, 1x30 Cap"
                />
              </div>

              {/* Row 4 - Mfg & Mkdt */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-300 mb-1">Mfg (Manufacturer)</label>
                <input
                  type="text"
                  value={newMedicine.manufacturer}
                  onChange={(e) => handleMfgChange(e.target.value)}
                  onFocus={(e) => handleMfgFocus(e.target.value)}
                  onBlur={() => setTimeout(() => setShowMfgSuggestions(false), 200)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Cipla Ltd"
                />
                {showMfgSuggestions && (() => {
                  const billMfgs = items.map(item => item.manufacturer || '').filter(Boolean);
                  const query = newMedicine.manufacturer.toLowerCase();
                  const uniqueBillMfgs = Array.from(new Set(billMfgs)).filter(m => m.toLowerCase().includes(query));
                  
                  const combinedMfgs = [...uniqueBillMfgs];
                  mfgSuggestions.forEach(dbMfg => {
                    if (!combinedMfgs.some(c => c.toLowerCase() === dbMfg.toLowerCase())) {
                      combinedMfgs.push(dbMfg);
                    }
                  });

                  if (combinedMfgs.length === 0) return null;

                  return (
                    <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown">
                      {combinedMfgs.slice(0, 15).map((mfgName, idx) => {
                        const isInBill = billMfgs.some(m => m.toLowerCase() === mfgName.toLowerCase());
                        const isInDb = mfgSuggestions.some(m => m.toLowerCase() === mfgName.toLowerCase());
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setNewMedicine(prev => ({ ...prev, manufacturer: mfgName }))}
                            className="w-full text-left px-3 py-2 hover:bg-white/10 text-text border-b border-glass-border/10 last:border-0 flex items-center justify-between text-xs"
                          >
                            <span className="truncate pr-2 font-medium">{mfgName}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              {isInBill && (
                                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                  In Bill
                                </span>
                              )}
                              {isInDb && (
                                <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                  In Database
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Mkdt (Marketed By)</label>
                <input
                  type="text"
                  value={newMedicine.marketed_by}
                  onChange={(e) => setNewMedicine({ ...newMedicine, marketed_by: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Cipla Pvt Ltd"
                />
              </div>

              {/* Row 5 - Tax */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">CGST %</label>
                <input
                  type="number"
                  value={newMedicine.cgst_per}
                  onChange={(e) => setNewMedicine({ ...newMedicine, cgst_per: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">SGST %</label>
                <input
                  type="number"
                  value={newMedicine.sgst_per}
                  onChange={(e) => setNewMedicine({ ...newMedicine, sgst_per: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Row 6 - HSN */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1">HSN Code</label>
                <input
                  type="text"
                  value={newMedicine.hsn_code}
                  onChange={(e) => setNewMedicine({ ...newMedicine, hsn_code: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 3004"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowMedicineModal(false); setActiveMedicineIndex(null); }}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveMedicine}
                disabled={savingMedicine || !newMedicine.name}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {savingMedicine ? 'Saving...' : 'Add Medicine'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Price History Modal */}
      {showPriceHistoryModal && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-2">Price History</h3>
            <p className="text-gray-400 text-sm mb-4">Past purchase prices for: <span className="text-white">{priceHistoryMedicine}</span></p>
            
            {priceHistory.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No purchase history found for this medicine</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-300 border-b border-white/20">
                      <th className="pb-3">Date</th>
                      <th className="pb-3">Distributor</th>
                      <th className="pb-3">Batch</th>
                      <th className="pb-3">Rate</th>
                      <th className="pb-3">MRP</th>
                      <th className="pb-3">CGST%</th>
                      <th className="pb-3">SGST%</th>
                      <th className="pb-3">CD ₹</th>
                      <th className="pb-3">CD %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((item: any, idx: number) => (
                      <tr key={idx} className="border-b border-white/10 hover:bg-white/5">
                        <td className="py-3 text-gray-300">{item.date}</td>
                        <td className="py-3 text-white">{item.distributor_name}</td>
                        <td className="py-3 text-gray-300">{item.batch_no}</td>
                        <td className="py-3 text-white font-medium">₹{item.rate}</td>
                        <td className="py-3 text-white">₹{item.mrp}</td>
                        <td className="py-3 text-gray-300">{item.cgst_per}%</td>
                        <td className="py-3 text-gray-300">{item.sgst_per}%</td>
                        <td className="py-3 text-gray-300">₹{item.cd_rs || 0}</td>
                        <td className="py-3 text-gray-300">{item.cd_per || 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowPriceHistoryModal(false)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Purchase Modal */}
      {editingPurchase && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Edit Purchase</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Invoice Number</label>
                <input
                  type="text"
                  value={editingPurchase.invoice_no || ''}
                  onChange={(e) => setEditingPurchase({ ...editingPurchase, invoice_no: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Date</label>
                <input
                  type="date"
                  value={editingPurchase.date || ''}
                  onChange={(e) => setEditingPurchase({ ...editingPurchase, date: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Total Amount</label>
                <input
                  type="number"
                  value={editingPurchase.total_amount || 0}
                  onChange={(e) => setEditingPurchase({ ...editingPurchase, total_amount: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white"
                  step="0.01"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingPurchase(null)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await apiClient.put(`/purchases/${editingPurchase.id}`, {
                      invoice_no: editingPurchase.invoice_no,
                      date: editingPurchase.date,
                      total_amount: editingPurchase.total_amount
                    });
                    setEditingPurchase(null);
                    alert('Purchase updated successfully');
                  } catch (error) {
                    alert('Failed to update purchase');
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}



      {/* Barcode Print Prompt Modal */}
      {showBarcodeModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md fade-in text-left">
          <div className="bg-gray-900 border border-white/20 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 mb-2">
                <CheckCircle size={32} className="animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-white font-sans">Purchase Saved Successfully!</h3>
              <p className="text-xs text-gray-400">Invoice No: <span className="font-mono text-blue-400 font-semibold">{lastSavedInvoiceNo}</span></p>
            </div>

            <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
              <p className="text-xs text-center text-gray-200 font-medium leading-relaxed font-sans">
                Would you like to print unique barcode/QR code labels for the medicines in this purchase, or generate a single barcode for the purchase bill itself?
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={async () => {
                  try {
                    const res = await api.generateMedicineBarcodes(lastSavedItems);
                    if (res && res.success && res.pdfUrl) {
                      const backendUrl = apiClient.defaults.baseURL || window.location.origin;
                      window.open(`${backendUrl}${res.pdfUrl}`, '_blank');
                    } else {
                      alert('Failed to generate barcodes');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Error generating medicine barcodes');
                  }
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-green-600 hover:bg-green-500 text-white transition-all shadow-[0_4px_12px_rgba(34,197,94,0.2)] flex items-center justify-center gap-2 font-sans"
              >
                Create Medicine Barcodes
              </button>

              <button
                onClick={async () => {
                  try {
                    const res = await api.generateBillBarcode(lastSavedInvoiceNo);
                    if (res && res.success && res.pdfUrl) {
                      const backendUrl = apiClient.defaults.baseURL || window.location.origin;
                      window.open(`${backendUrl}${res.pdfUrl}`, '_blank');
                    } else {
                      alert('Failed to generate bill barcode');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Error generating bill barcode');
                  }
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-[0_4px_12px_rgba(59,130,246,0.2)] flex items-center justify-center gap-2 font-sans"
              >
                Create Bill Barcode
              </button>

              <button
                onClick={() => {
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all font-sans"
              >
                No / Skip
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sliding Details Drawer for OpenFDA Enrichment */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-[450px] bg-[#121214]/95 backdrop-blur-xl border-l border-glass-border shadow-[-8px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-in-out z-drawer flex flex-col pt-16 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
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

      {universalEditMedicineId && (
        <UniversalMedicineEditModal 
          medicineId={universalEditMedicineId} 
          onClose={() => setUniversalEditMedicineId(null)} 
          onSave={() => {
            // Optional: You can trigger a refetch of items here if needed, or rely on next search
          }} 
        />
      )}
    </div>
  );
};

export default Purchases;