import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Edit,
  Clock,
  Trash2,
  Check,
  AlertTriangle,
  Package,
  Loader2,
  Columns3,
  X,
  Download,
  Calendar,
  Sliders,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  ShoppingCart,
  Plus,
  Minus,
  History,
  FileText,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Info,
  PackageSearch
} from 'lucide-react';
import { api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, formatDisplayDate, toDateInputValue } from '../../utils/date';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { exportToCSV, exportToPDF } from '../../utils/export';

interface SearchFilters {
  q: string;
  patientName: string;
  medicineName: string;
  salesBillNo: string;
  purchaseBillNo: string;
  batchNo: string;
  distributor: string;
  dateFrom: string;
  dateTo: string;
  type: string;
}

interface SelectedDetails {
  inventory: {
    id: number;
    medicine_id: number;
    medicine_name: string;
    batch_no: string;
    expiry_date: string;
    quantity: number;
    loose_quantity: number;
    mrp: number;
    cost_price: number;
    rack_location?: string;
  };
  purchases: Array<{
    id: number;
    purchase_id: number;
    medicine_id: number;
    batch_no: string;
    expiry_date: string;
    quantity: number;
    free_qty: number;
    cost_price: number;
    mrp: number;
    invoice_no: string;
    date: string;
    distributor_name: string;
  }>;
  sales: Array<{
    id: number;
    invoice_id: number;
    inventory_id: number;
    quantity: number;
    unit_price: number;
    loose_qty: number;
    invoice_no: string;
    date: string;
    customer_name: string;
  }>;
  timeline: Array<{
    date: string;
    type: 'Purchase' | 'Sale' | 'Adjustment';
    reference: string;
    detail: string;
    qtyChange: number;
    price?: number;
    cost?: number;
    mrp?: number;
  }>;
}

const InvestigationCenter = () => {
  const queryClient = useQueryClient();
  // Column-header inline filters (immediate UI state)
  const [colFilterMedicine, setColFilterMedicine] = useState('');
  const [colFilterBatch, setColFilterBatch] = useState('');
  const [colFilterInvoice, setColFilterInvoice] = useState('');
  const [colFilterParty, setColFilterParty] = useState('');
  const [colFilterType, setColFilterType] = useState('All');

  // Debounced server-side filter values (400ms delay to avoid per-keystroke fetches)
  const [debouncedMedicine, setDebouncedMedicine] = useState('');
  const [debouncedBatch, setDebouncedBatch] = useState('');
  const [debouncedInvoice, setDebouncedInvoice] = useState('');
  const [debouncedParty, setDebouncedParty] = useState('');

  useEffect(() => { const t = setTimeout(() => setDebouncedMedicine(colFilterMedicine), 400); return () => clearTimeout(t); }, [colFilterMedicine]);
  useEffect(() => { const t = setTimeout(() => setDebouncedBatch(colFilterBatch), 400); return () => clearTimeout(t); }, [colFilterBatch]);
  useEffect(() => { const t = setTimeout(() => setDebouncedInvoice(colFilterInvoice), 400); return () => clearTimeout(t); }, [colFilterInvoice]);
  useEffect(() => { const t = setTimeout(() => setDebouncedParty(colFilterParty), 400); return () => clearTimeout(t); }, [colFilterParty]);

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'investigation-date-range',
    defaultFrom: getNDaysAgoString(15),
    defaultTo: getTodayString(),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<SelectedDetails | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Column Visibility — persisted in localStorage
  const COL_KEYS = [
    { key: 'batch', label: 'Batch' },
    { key: 'date', label: 'Date' },
    { key: 'invoice', label: 'Invoice' },
    { key: 'party', label: 'Party' },
    { key: 'openingStock', label: 'Opening Stock' },
    { key: 'purchase', label: 'Purchase' },
    { key: 'sales', label: 'Sales' },
    { key: 'purchaseReturn', label: 'Purchase Return' },
    { key: 'salesReturn', label: 'Sales Return' },
    { key: 'adj', label: 'Adj' },
    { key: 'stockAudit', label: 'Stock Audit' },
    { key: 'b2bSales', label: 'B2B Sales' },
    { key: 'closingStock', label: 'Closing Stock' },
    { key: 'medicineStock', label: 'Medicine Stock' },
  ] as const;
  type ColKey = typeof COL_KEYS[number]['key'];

  const defaultVisible = new Set<ColKey>(COL_KEYS.map(c => c.key));
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem('inv-ledger-cols');
      if (saved) {
        const arr = JSON.parse(saved) as ColKey[];
        return new Set(arr.filter(k => COL_KEYS.some(c => c.key === k)));
      }
    } catch { /* ignore */ }
    return defaultVisible;
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const medicineSearchRef = useRef<HTMLDivElement>(null);

  const toggleCol = (key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('inv-ledger-cols', JSON.stringify([...next]));
      return next;
    });
  };

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
      if (medicineSearchRef.current && !medicineSearchRef.current.contains(e.target as Node)) {
        setSearchMedicineResults([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const col = (key: ColKey) => visibleCols.has(key);

  // Modals / Confirmation State
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  // Edit / Adjustment States
  const [editingType, setEditingType] = useState<'inventory' | 'sale' | 'purchase' | null>(null);
  const [editInventoryForm, setEditInventoryForm] = useState({
    quantity: 0,
    loose_quantity: 0,
    batch_no: '',
    expiry_date: '',
    mrp: 0,
    cost_price: 0,
    rack_location: ''
  });

  // Target Bill Edit States
  const [editingBillId, setEditingBillId] = useState<number | null>(null);
  const [editingBillNo, setEditingBillNo] = useState<string>('');
  const [billItems, setBillItems] = useState<any[]>([]);
  const [billDiscount, setBillDiscount] = useState<number>(0);
  const [searchMedicineResults, setSearchMedicineResults] = useState<any[]>([]);
  const [searchMedicineQuery, setSearchMedicineQuery] = useState('');

  // Notification Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // No client-side filtering needed — all filters are now handled server-side

  // Infinite Scroll setup
  const {
    items,
    allItems,
    totalItems,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    sentinelRef,
  } = useInfiniteScroll<any>({
    queryKey: 'investigation-list',
    cacheKey: 'investigation-cache',
    serverFilters: {
      dateFrom: dateRangeHelper.dateRange.from,
      dateTo: dateRangeHelper.dateRange.to,
      type: colFilterType,
      // Text filters: debounced so server only refetches 400ms after typing stops
      medicineName: debouncedMedicine,
      batchNo: debouncedBatch,
      reference: debouncedInvoice,
      party: debouncedParty,
    },
    fetchPage: async (pageParam, filters) => {
      const cleanFilters: any = {
        page: pageParam,
        limit: 100,
      };
      if (filters.dateFrom) cleanFilters.dateFrom = filters.dateFrom;
      if (filters.dateTo) cleanFilters.dateTo = filters.dateTo;
      if (filters.type && filters.type !== 'All') cleanFilters.type = filters.type;
      // Pass text filters to the backend (backend already has the SQL WHERE clauses)
      if (filters.medicineName) cleanFilters.medicineName = filters.medicineName;
      if (filters.batchNo) cleanFilters.batchNo = filters.batchNo;
      if (filters.reference) cleanFilters.reference = filters.reference;
      if (filters.party) cleanFilters.party = filters.party;

      const response = await api.getInvestigationTimeline(cleanFilters);
      return {
        data: response.data || [],
        totalItems: response.totalItems || 0,
        totalPages: response.totalPages || 1,
      };
    },
  });

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const runSearch = (page?: number, isAppend?: boolean) => {
    refetch();
  };

  const handleExport = (type: 'csv' | 'pdf') => {
    const columns = [
      { key: 'medicine_name', label: 'Medicine' },
      ...(col('batch') ? [{ key: 'batch_no', label: 'Batch' }] : []),
      ...(col('date') ? [{ key: 'date', label: 'Date' }] : []),
      ...(col('invoice') ? [{ key: 'reference', label: 'Invoice' }] : []),
      ...(col('party') ? [{ key: 'party', label: 'Party' }] : []),
      ...(col('openingStock') ? [{ key: 'opening_qty_formatted', label: 'Opening Stock' }] : []),
      ...(col('purchase') ? [{ key: 'purchase_qty_formatted', label: 'Purchase' }] : []),
      ...(col('sales') ? [{ key: 'sales_qty_formatted', label: 'Sales' }] : []),
      ...(col('purchaseReturn') ? [{ key: 'purchase_return_qty', label: 'Purchase Return' }] : []),
      ...(col('salesReturn') ? [{ key: 'sales_return_qty', label: 'Sales Return' }] : []),
      ...(col('adj') ? [{ key: 'adj_qty_formatted', label: 'Adj' }] : []),
      ...(col('stockAudit') ? [{ key: 'stock_audit', label: 'Stock Audit' }] : []),
      ...(col('b2bSales') ? [{ key: 'b2b_sales', label: 'B2B Sales' }] : []),
      ...(col('closingStock') ? [{ key: 'closing_qty_formatted', label: 'Closing Stock' }] : []),
      ...(col('medicineStock') ? [{ key: 'medicine_stock_qty_formatted', label: 'Medicine Stock' }] : []),
    ];

    const formattedData = items.map(item => ({
      ...item,
      date: formatDate(item.date),
      opening_qty_formatted: formatOpeningStock(item.opening_qty, item.opening_loose),
      purchase_qty_formatted: item.type === 'Purchase' ? formatTxQty(item.purchase_qty, item.free_qty || 0) : '0',
      sales_qty_formatted: item.type === 'Sale' ? formatTxQty(item.sale_qty, item.sale_loose) : '0',
      adj_qty_formatted: item.type === 'Adjustment' ? formatTxQty(item.adj_qty, item.adj_loose) : '0',
      stock_audit: '0',
      b2b_sales: '0',
      closing_qty_formatted: formatTxQty(item.closing_qty, item.closing_loose),
      medicine_stock_qty_formatted: formatTxQty(item.medicine_stock_qty, item.medicine_stock_loose),
    }));

    if (type === 'csv') {
      exportToCSV(formattedData, columns, 'stock_ledger.csv');
    } else {
      exportToPDF(formattedData, columns, 'stock_ledger.pdf', 'Stock Ledger Timeline Report');
    }
  };

  // Direct Inventory Correction logic
  const handleAdjustStock = async (inventoryId: number) => {
    setSelectedId(inventoryId);
    setDetailsLoading(true);
    setEditingType(null);
    try {
      const detailsData = await api.getInvestigationDetails(inventoryId);
      setDetails(detailsData);
      const logs = await api.getInvestigationAuditLogs(inventoryId);
      setAuditLogs(logs);

      const inv = detailsData.inventory;
      setEditInventoryForm({
        quantity: inv.quantity,
        loose_quantity: inv.loose_quantity,
        batch_no: inv.batch_no,
        expiry_date: inv.expiry_date,
        mrp: inv.mrp,
        cost_price: inv.cost_price,
        rack_location: inv.rack_location || ''
      });
      setEditingType('inventory');
    } catch (err) {
      showToast('Failed to fetch medicine inventory details.', 'error');
    } finally {
      setDetailsLoading(false);
    }
  };

  const saveInventoryAdjustment = () => {
    if (!selectedId || !details) return;
    if (editInventoryForm.quantity < 0 || editInventoryForm.loose_quantity < 0) {
      showToast('Quantities cannot be negative', 'error');
      return;
    }

    setConfirmModal({
      show: true,
      title: 'Confirm Inventory Adjustments',
      message: `Adjusting stock for ${details.inventory.medicine_name}. Quantity: ${details.inventory.quantity} -> ${editInventoryForm.quantity}. Expiry: "${details.inventory.expiry_date}" -> "${editInventoryForm.expiry_date}". Are you sure?`,
      confirmText: 'Confirm Adjustment',
      onConfirm: async () => {
        try {
          await api.updateInvestigationInventory(selectedId, editInventoryForm);
          showToast('Inventory adjusted successfully.');
          setEditingType(null);
          setConfirmModal(null);
          runSearch(1, false);
          // Centralized cache invalidation for frontend lists and local infinite scroll caches
          invalidateAfterStockWrite(queryClient);

          // Refresh local POS inventory search cache
          api.getCompactInventory().catch(() => { });
        } catch (err: any) {
          showToast(err.response?.data?.error || 'Failed to update inventory', 'error');
        }
      }
    });
  };

  // Edit Sales Bill logic
  const handleStartSaleBillEdit = (item: any) => {
    setEditingBillId(item.invoice_id);
    setEditingBillNo(item.reference);
    setBillDiscount(item.discount || 0);

    setDetailsLoading(true);
    api.getSale(item.invoice_id)
      .then(invoiceDetails => {
        const mapped = invoiceDetails.items.map((it: any) => ({
          inventory_id: it.inventory_id,
          medicine_name: it.medicine_name,
          batch_no: it.batch_number,
          quantity: it.quantity,
          unit_price: it.unit_price,
          loose_qty: it.loose_qty || 0,
          original_qty: it.quantity
        }));
        setBillItems(mapped);
        setEditingType('sale');
      })
      .catch(() => showToast('Failed to fetch invoice details', 'error'))
      .finally(() => setDetailsLoading(false));
  };

  // Edit Purchase Bill logic
  const handleStartPurchaseBillEdit = (item: any) => {
    setEditingBillId(item.purchase_id);
    setEditingBillNo(item.reference);

    setDetailsLoading(true);
    api.getPurchase(item.purchase_id)
      .then(purchaseDetails => {
        const mapped = purchaseDetails.items.map((it: any) => ({
          medicine_id: it.medicine_id,
          medicine_name: it.medicine_name,
          batch_no: it.batch_no,
          expiry_date: it.expiry_date,
          quantity: it.quantity,
          cost_price: it.cost_price,
          mrp: it.mrp,
          free_qty: it.free_qty || 0,
          cgst_per: it.cgst_per || 0,
          sgst_per: it.sgst_per || 0,
          cd_value: it.cd_value || 0,
          original_qty: it.quantity
        }));
        setBillItems(mapped);
        setEditingType('purchase');
      })
      .catch(() => showToast('Failed to fetch purchase bill details', 'error'))
      .finally(() => setDetailsLoading(false));
  };

  // Inline Recalculation Engine
  const calculateRecalculatedTotal = () => {
    if (editingType === 'sale') {
      const subtotal = billItems.reduce((acc, it) => acc + (it.quantity * it.unit_price), 0);
      const tax = subtotal * 0.05;
      return Math.round(subtotal + tax - billDiscount);
    }
    if (editingType === 'purchase') {
      return Math.round(billItems.reduce((acc, it) => {
        const taxable = (it.quantity * it.cost_price) - (it.cd_value || 0);
        const gstPer = (it.cgst_per || 0) + (it.sgst_per || 0);
        return acc + taxable + (taxable * gstPer / 100);
      }, 0));
    }
    return 0;
  };

  // Item list mutation helpers
  const handleItemQtyChange = (index: number, newQty: number) => {
    if (newQty < 0) return;
    setBillItems(prev => {
      const next = [...prev];
      next[index].quantity = newQty;
      return next;
    });
  };

  const handleItemLooseQtyChange = (index: number, newQty: number) => {
    if (newQty < 0) return;
    setBillItems(prev => {
      const next = [...prev];
      next[index].loose_qty = newQty;
      return next;
    });
  };

  const handleRemoveBillItem = (index: number) => {
    setConfirmModal({
      show: true,
      title: 'Confirm Item Removal',
      message: `Are you sure you want to remove "${billItems[index].medicine_name}" from this transaction? Stock reconciliation will occur automatically.`,
      confirmText: 'Remove Item',
      onConfirm: () => {
        setBillItems(prev => prev.filter((_, idx) => idx !== index));
        setConfirmModal(null);
      }
    });
  };

  const handleSearchMedicineForAdd = async (q: string) => {
    setSearchMedicineQuery(q);
    if (q.trim().length < 2) {
      setSearchMedicineResults([]);
      return;
    }
    try {
      const data = await api.searchMedicine(q);
      setSearchMedicineResults(data);
    } catch { }
  };

  const handleAddMedicineToBill = (med: any) => {
    if (editingType === 'sale') {
      if (billItems.some(i => i.inventory_id === med.inventory_id)) {
        showToast('Medicine already present in list', 'error');
        return;
      }
      setBillItems(prev => [
        ...prev,
        {
          inventory_id: med.inventory_id,
          medicine_name: med.medicine_name,
          batch_no: med.batch_no,
          quantity: 1,
          unit_price: med.mrp,
          loose_qty: 0,
          original_qty: 0
        }
      ]);
    } else if (editingType === 'purchase') {
      if (billItems.some(i => i.medicine_id === med.medicine_id && i.batch_no === med.batch_no)) {
        showToast('Medicine and batch already present in list', 'error');
        return;
      }
      setBillItems(prev => [
        ...prev,
        {
          medicine_id: med.medicine_id,
          medicine_name: med.medicine_name,
          batch_no: med.batch_no || '',
          expiry_date: med.expiry_date || '',
          quantity: 1,
          cost_price: Number(med.cost_price || 0),
          mrp: Number(med.mrp || 0),
          free_qty: 0,
          cgst_per: med.cgst_per || 0,
          sgst_per: med.sgst_per || 0,
          cd_value: 0,
          original_qty: 0
        }
      ]);
    }
    setSearchMedicineQuery('');
    setSearchMedicineResults([]);
    showToast(`Added ${med.medicine_name} to transaction workspace.`);
  };

  const saveBillCorrections = () => {
    if (!editingBillId) return;

    const actionText = editingType === 'sale' ? 'Sales Bill' : 'Purchase Bill';
    setConfirmModal({
      show: true,
      title: `Confirm ${actionText} Correction`,
      message: `This will update Invoice #${editingBillNo} with corrected items and prices, then adjust inventory stock balances automatically. Proceed?`,
      confirmText: 'Confirm Correction',
      onConfirm: async () => {
        try {
          if (editingType === 'sale') {
            await api.updateInvestigationSaleBill(editingBillId, {
              items: billItems,
              discount: billDiscount
            });
          } else {
            await api.updateInvestigationPurchaseBill(editingBillId, {
              items: billItems
            });
          }
          showToast(`${actionText} corrected successfully!`);
          setEditingType(null);
          setConfirmModal(null);
          runSearch(1, false);
          // Centralized cache invalidation for frontend lists and local infinite scroll caches
          invalidateAfterStockWrite(queryClient);

          // Refresh local POS inventory search cache
          api.getCompactInventory().catch(() => { });
        } catch (err: any) {
          showToast(err.response?.data?.error || 'Failed to save correction.', 'error');
        }
      }
    });
  };

  // Helper date formatter matching user's spreadsheet style: DD/MM/YYYY hh:mm AM/PM
  const formatDate = (dateStr: string) => {
    return formatDisplayDate(dateStr, true);
  };

  // Formatting helpers for stock quantities
  const formatOpeningStock = (qty: number, loose: number) => `${qty || 0}::${loose || 0}`;
  const formatTxQty = (qty: number, loose: number) => {
    if (loose > 0) return `${qty || 0}::${loose}`;
    return String(qty || 0);
  };

  // Type helper for row icons
  const getTypeIcon = (type: string, returnType?: string) => {
    switch (type) {
      case 'Sale':
        return <ShoppingCart size={12} className="text-accent" />;
      case 'Purchase':
        return <Package size={12} className="text-primary" />;
      case 'Return':
        return <RotateCcw size={12} className={returnType === 'purchase' ? 'text-orange-400' : 'text-purple-400'} />;
      case 'Adjustment':
        return <Sliders size={12} className="text-amber-500" />;
      default:
        return <Clock size={12} className="text-muted" />;
    }
  };

  // Calculate summary stats from current loaded items
  const salesCount = items.filter(i => i.type === 'Sale').length;
  const purchasesCount = items.filter(i => i.type === 'Purchase').length;
  const adjustmentsCount = items.filter(i => i.type === 'Adjustment').length;

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden relative">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[99999] flex items-center gap-2 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl text-xs font-semibold animate-in slide-in-from-top-4 duration-300
          ${toast.type === 'success' ? 'bg-green/10 border-green/30 text-green' : 'bg-red/10 border-red/30 text-red'}`}>
          <Check size={14} />
          {toast.message}
        </div>
      )}

      {/* Confirmation Modal — portalled to document.body to escape overflow-hidden stacking context */}
      {confirmModal && confirmModal.show && createPortal(
        <div className="fixed inset-0 z-submodal bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-glass-border max-w-md w-full rounded-2xl shadow-2xl overflow-hidden p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertTriangle size={24} />
              <h3 className="font-bold text-base text-text">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setConfirmModal(null)}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border transition-colors text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (isSaving) return;
                  try {
                    setIsSaving(true);
                    await confirmModal.onConfirm();
                  } catch (err) {
                    console.error('Confirmation action failed:', err);
                  } finally {
                    setIsSaving(false);
                  }
                }}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/95 transition-all text-xs font-bold shadow-[0_0_15px_rgba(34,197,150,0.2)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isSaving && <Loader2 size={12} className="animate-spin" />}
                {confirmModal.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        {!editingType && (
          <>
            {/* ── HERO HEADER ── */}
            <div className="relative shrink-0 overflow-hidden border-b border-glass-border/30">
              {/* Gradient background layer */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary/8 via-bg2/60 to-transparent pointer-events-none" />
              <div className="absolute top-0 left-0 w-48 h-full bg-primary/5 blur-3xl pointer-events-none" />

              <div className="relative px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 select-none">
                {/* Left: Brand + stats */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Icon + Title */}
                  <div className="flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 bg-primary/20 rounded-xl blur-md" />
                      <div className="relative p-1.5 rounded-xl bg-primary/15 border border-primary/25 shadow-inner">
                        <PackageSearch size={15} className="text-primary" />
                      </div>
                    </div>
                    <div>
                      <h1 className="text-xs font-black text-text tracking-wide leading-none">Investigation Center</h1>
                      <p className="text-[9px] text-muted font-medium leading-none mt-0.5">Stock Ledger · Audit Trail · Bill Correction</p>
                    </div>
                  </div>

                  {/* Live count chip */}
                  <div className="h-5 flex items-center gap-1.5 px-2.5 rounded-full bg-bg3/80 border border-glass-border/50 text-[10px] font-mono font-bold text-muted">
                    {isFetching && items.length === 0
                      ? <Loader2 size={9} className="animate-spin text-primary" />
                      : <span className="text-text font-black">{items.length.toLocaleString()}</span>
                    }
                    {totalItems > 0 && <><span className="text-muted/50">/</span><span>{totalItems.toLocaleString()}</span></>}
                    <span className="text-muted/60">ledgers</span>
                  </div>

                  {/* Compact type stat badges */}
                  <div className="hidden lg:flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] font-mono font-bold">
                      ↓ {salesCount.toLocaleString()} Sales
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-green/10 border border-green/20 text-green text-[10px] font-mono font-bold">
                      ↑ {purchasesCount.toLocaleString()} Purchases
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-mono font-bold">
                      ⚖ {adjustmentsCount.toLocaleString()} Adj
                    </span>
                  </div>
                </div>

                {/* Right: Tools cluster */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Date range */}
                  <div className="flex items-center gap-1.5 bg-bg3/60 border border-glass-border/50 px-2.5 py-1 rounded-xl text-[10px] font-bold text-muted">
                    <Calendar size={11} className="text-primary shrink-0" />
                    <span className="text-[9px] text-muted/60 uppercase font-bold">From</span>
                    <input
                      type="date"
                      value={toDateInputValue(dateRangeHelper.dateRange.from)}
                      onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
                      className="px-1.5 py-0.5 bg-bg2 border border-glass-border/50 rounded-lg text-[10px] text-text font-bold focus:outline-none focus:border-primary/50 w-24 cursor-pointer"
                    />
                    <span className="text-[9px] text-muted/60 uppercase font-bold">To</span>
                    <input
                      type="date"
                      value={toDateInputValue(dateRangeHelper.dateRange.to)}
                      onChange={e => dateRangeHelper.handleToChange(e.target.value)}
                      className="px-1.5 py-0.5 bg-bg2 border border-glass-border/50 rounded-lg text-[10px] text-text font-bold focus:outline-none focus:border-primary/50 w-24 cursor-pointer"
                    />
                    {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
                      <button
                        onClick={() => dateRangeHelper.clearFilters()}
                        className="text-[9px] font-bold text-red hover:text-red/70 transition-colors cursor-pointer ml-0.5"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="w-px h-5 bg-glass-border/40 shrink-0" />

                  {/* Export buttons */}
                  <button
                    onClick={() => handleExport('csv')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl border bg-bg3/80 border-glass-border/60 text-muted hover:text-text hover:border-primary/30 hover:bg-primary/5 text-[10px] font-bold transition-all cursor-pointer"
                    title="Export to CSV"
                  >
                    <Download size={11} />
                    CSV
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl border bg-bg3/80 border-glass-border/60 text-muted hover:text-text hover:border-primary/30 hover:bg-primary/5 text-[10px] font-bold transition-all cursor-pointer"
                    title="Export to PDF"
                  >
                    <Download size={11} />
                    PDF
                  </button>
                </div>
              </div>
            </div>

            {/* ── FILTER BAR ── */}
            <div className="px-3 py-2 bg-bg2/30 border-b border-glass-border/20 flex flex-wrap items-center gap-2 shrink-0 select-none">
              {/* Label */}
              <div className="flex items-center gap-1 text-[9px] text-muted/70 font-black uppercase tracking-widest shrink-0">
                <Sliders size={10} className="text-primary" />
                Filter
              </div>

              {/* Medicine Filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-green/50" size={10} />
                <input
                  type="text"
                  placeholder="Medicine..."
                  value={colFilterMedicine}
                  onChange={e => setColFilterMedicine(e.target.value)}
                  className="w-40 bg-bg3/70 border border-glass-border/40 rounded-xl pl-7 pr-6 py-1 text-xs text-text placeholder:text-muted/30 focus:outline-none focus:border-green/40 focus:bg-green/5 transition-all"
                />
                {colFilterMedicine && (
                  <button onClick={() => setColFilterMedicine('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                    <X size={9} />
                  </button>
                )}
              </div>

              {/* Batch Filter */}
              {col('batch') && (
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-sky-400/50 font-black">#</span>
                  <input
                    type="text"
                    placeholder="Batch..."
                    value={colFilterBatch}
                    onChange={e => setColFilterBatch(e.target.value)}
                    className="w-28 bg-bg3/70 border border-glass-border/40 rounded-xl pl-6 pr-6 py-1 text-xs text-text placeholder:text-muted/30 focus:outline-none focus:border-sky-400/40 focus:bg-sky-500/5 transition-all"
                  />
                  {colFilterBatch && (
                    <button onClick={() => setColFilterBatch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                      <X size={9} />
                    </button>
                  )}
                </div>
              )}

              {/* Invoice Filter */}
              {col('invoice') && (
                <div className="relative">
                  <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent/40" size={10} />
                  <input
                    type="text"
                    placeholder="Invoice / Ref..."
                    value={colFilterInvoice}
                    onChange={e => setColFilterInvoice(e.target.value)}
                    className="w-32 bg-bg3/70 border border-glass-border/40 rounded-xl pl-7 pr-6 py-1 text-xs text-text placeholder:text-muted/30 focus:outline-none focus:border-accent/40 focus:bg-accent/5 transition-all"
                  />
                  {colFilterInvoice && (
                    <button onClick={() => setColFilterInvoice('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                      <X size={9} />
                    </button>
                  )}
                </div>
              )}

              {/* Party Filter */}
              {col('party') && (
                <div className="relative">
                  <Info className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-400/40" size={10} />
                  <input
                    type="text"
                    placeholder="Party / Client..."
                    value={colFilterParty}
                    onChange={e => setColFilterParty(e.target.value)}
                    className="w-36 bg-bg3/70 border border-glass-border/40 rounded-xl pl-7 pr-6 py-1 text-xs text-text placeholder:text-muted/30 focus:outline-none focus:border-purple-400/40 focus:bg-purple-500/5 transition-all"
                  />
                  {colFilterParty && (
                    <button onClick={() => setColFilterParty('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                      <X size={9} />
                    </button>
                  )}
                </div>
              )}

              {/* Segmented Type Tabs */}
              <div className="flex items-center bg-bg3/60 border border-glass-border/40 rounded-xl overflow-hidden text-[10px] font-bold h-[26px] shrink-0">
                {[
                  { v: 'All', label: 'All' },
                  { v: 'Purchase', label: 'Purchase', color: 'text-green' },
                  { v: 'Sale', label: 'Sale', color: 'text-sky-400' },
                  { v: 'Return', label: 'Return', color: 'text-purple-400' },
                  { v: 'Adjustment', label: 'Adj', color: 'text-amber-500' },
                ].map(({ v, label, color }) => (
                  <button
                    key={v}
                    onClick={() => setColFilterType(v)}
                    className={`px-2.5 h-full flex items-center transition-all cursor-pointer border-r border-glass-border/30 last:border-r-0 ${
                      colFilterType === v
                        ? 'bg-primary/15 text-primary shadow-inner'
                        : `text-muted hover:text-text hover:bg-bg2/50 ${color || ''}`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Right: Reset + Column toggle */}
              <div className="ml-auto flex items-center gap-2">
                {(colFilterMedicine || colFilterBatch || colFilterInvoice || colFilterParty || colFilterType !== 'All') && (
                  <button
                    onClick={() => {
                      setColFilterMedicine('');
                      setColFilterBatch('');
                      setColFilterInvoice('');
                      setColFilterParty('');
                      setColFilterType('All');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red/10 border border-red/20 text-red hover:bg-red hover:text-white hover:shadow-[0_0_10px_rgba(239,68,68,0.3)] transition-all text-[10px] font-bold cursor-pointer"
                  >
                    <RotateCcw size={10} />
                    Reset
                  </button>
                )}

                {/* Column toggle */}
                <div className="relative" ref={colMenuRef}>
                  <button
                    onClick={() => setShowColMenu(p => !p)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${showColMenu
                      ? 'bg-primary/15 border-primary/45 text-primary shadow-[0_0_8px_rgba(34,197,150,0.15)]'
                      : 'bg-bg3/70 border-glass-border/50 text-muted hover:text-text hover:border-glass-border/70'
                    }`}
                    title="Toggle columns"
                  >
                    <Columns3 size={11} />
                    Columns
                    {visibleCols.size < COL_KEYS.length && (
                      <span className="px-1.5 py-0 rounded-full bg-primary/20 text-primary text-[9px] font-mono shrink-0">
                        {COL_KEYS.length - visibleCols.size} hidden
                      </span>
                    )}
                  </button>

                  {showColMenu && (
                    <div className="absolute right-0 top-full mt-1.5 z-[200] w-52 bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-glass-border/30 bg-bg2/80">
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted">Ledger Columns</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setVisibleCols(defaultVisible);
                              localStorage.setItem('inv-ledger-cols', JSON.stringify([...defaultVisible]));
                            }}
                            className="text-[9px] font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer"
                          >
                            Reset
                          </button>
                          <button onClick={() => setShowColMenu(false)} className="text-muted hover:text-text transition-colors cursor-pointer">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="py-1 max-h-72 overflow-y-auto custom-scrollbar bg-bg2/40">
                        {COL_KEYS.map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => toggleCol(key)}
                            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary/10 transition-colors text-left cursor-pointer"
                          >
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all ${visibleCols.has(key)
                              ? 'bg-primary border-primary'
                              : 'bg-transparent border-glass-border/60'
                            }`}>
                              {visibleCols.has(key) && <Check size={9} className="text-white" />}
                            </span>
                            <span className={`text-[11px] font-semibold ${visibleCols.has(key) ? 'text-text' : 'text-muted/60'}`}>
                              {label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {editingType ? (
          /* ── CORRECTION WORKSPACE PANEL ── */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-300">
            {/* Amber "Correction Mode" header strip */}
            <div className="relative shrink-0 overflow-hidden border-b border-amber-500/30">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent pointer-events-none" />
              <div className="absolute top-0 left-0 w-32 h-full bg-amber-500/8 blur-2xl pointer-events-none" />
              <div className="relative px-4 py-2.5 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 bg-amber-500/20 rounded-lg blur-sm" />
                    <div className="relative p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30">
                      <Edit size={13} className="text-amber-400" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-xs font-black text-text leading-none">
                      {editingType === 'inventory' ? 'Inventory Direct Correction' :
                        editingType === 'sale' ? `Correcting Sales Invoice #${editingBillNo}` :
                          `Correcting Purchase Bill #${editingBillNo}`}
                    </h2>
                    <p className="text-[9px] text-amber-500/70 font-bold mt-0.5 uppercase tracking-wider">⚡ Correction Mode Active</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingType(null)}
                  className="flex items-center gap-1.5 text-[11px] text-muted hover:text-text font-bold bg-bg3 border border-glass-border px-3 py-1.5 rounded-xl transition-all cursor-pointer hover:border-red/30 hover:text-red"
                >
                  <X size={12} />
                  Discard Workspace
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-bg2/10">
              {editingType === 'inventory' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">

                  {/* Left Panel: Form & Preview (Col span 8) */}
                  <div className="lg:col-span-8 flex flex-col gap-6 w-full animate-in fade-in slide-in-from-left-4 duration-300">

                    {/* Before vs After Preview Card with Diff Badges */}
                    {details && details.inventory && (() => {
                      const qtyDiff = editInventoryForm.quantity - details.inventory.quantity;
                      const looseDiff = editInventoryForm.loose_quantity - details.inventory.loose_quantity;
                      const mrpDiff = editInventoryForm.mrp - details.inventory.mrp;
                      const costDiff = editInventoryForm.cost_price - details.inventory.cost_price;

                      return (
                        <div className="bg-bg2 border border-amber-500/20 p-5 rounded-2xl flex flex-col gap-4 shadow-xl relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

                          <div className="flex items-center justify-between border-b border-amber-500/15 pb-3">
                            <div className="flex items-center gap-2">
                              <Info size={14} className="text-amber-500" />
                              <h3 className="text-xs font-bold text-text uppercase tracking-wider">Adjustment Preview</h3>
                            </div>
                            <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-500 px-2 py-0.5 rounded-lg font-black uppercase animate-pulse">
                              Draft Mode
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* Compare Box Qty */}
                            <div className="bg-bg3/40 border border-glass-border/20 rounded-xl p-3.5 flex flex-col gap-2 relative hover:border-amber-500/20 transition-colors">
                              <span className="text-[9px] text-muted font-black uppercase tracking-wider">Box Qty</span>
                              <div className="flex items-center gap-2 font-mono text-xs">
                                <span className="text-red/60 line-through">{details.inventory.quantity}</span>
                                <ChevronRight size={11} className="text-muted/40" />
                                <span className={`font-black text-sm ${qtyDiff !== 0 ? 'text-amber-400' : 'text-text'}`}>
                                  {editInventoryForm.quantity}
                                </span>
                              </div>
                              {qtyDiff !== 0 && (
                                <span className={`absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-md ${qtyDiff > 0 ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20'}`}>
                                  {qtyDiff > 0 ? `+${qtyDiff}` : qtyDiff}
                                </span>
                              )}
                            </div>

                            {/* Compare Loose Qty */}
                            <div className="bg-bg3/40 border border-glass-border/20 rounded-xl p-3.5 flex flex-col gap-2 relative hover:border-amber-500/20 transition-colors">
                              <span className="text-[9px] text-muted font-black uppercase tracking-wider">Loose Qty</span>
                              <div className="flex items-center gap-2 font-mono text-xs">
                                <span className="text-red/60 line-through">{details.inventory.loose_quantity}</span>
                                <ChevronRight size={11} className="text-muted/40" />
                                <span className={`font-black text-sm ${looseDiff !== 0 ? 'text-amber-400' : 'text-text'}`}>
                                  {editInventoryForm.loose_quantity}
                                </span>
                              </div>
                              {looseDiff !== 0 && (
                                <span className={`absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-md ${looseDiff > 0 ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20'}`}>
                                  {looseDiff > 0 ? `+${looseDiff}` : looseDiff}
                                </span>
                              )}
                            </div>

                            {/* Compare MRP */}
                            <div className="bg-bg3/40 border border-glass-border/20 rounded-xl p-3.5 flex flex-col gap-2 relative hover:border-amber-500/20 transition-colors">
                              <span className="text-[9px] text-muted font-black uppercase tracking-wider">MRP</span>
                              <div className="flex items-center gap-2 font-mono text-xs">
                                <span className="text-red/60 line-through">₹{details.inventory.mrp}</span>
                                <ChevronRight size={11} className="text-muted/40" />
                                <span className={`font-black text-sm ${mrpDiff !== 0 ? 'text-amber-400' : 'text-text'}`}>
                                  ₹{editInventoryForm.mrp}
                                </span>
                              </div>
                              {mrpDiff !== 0 && (
                                <span className={`absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-md ${mrpDiff > 0 ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20'}`}>
                                  {mrpDiff > 0 ? `+₹${mrpDiff}` : `-₹${Math.abs(mrpDiff)}`}
                                </span>
                              )}
                            </div>

                            {/* Compare Cost */}
                            <div className="bg-bg3/40 border border-glass-border/20 rounded-xl p-3.5 flex flex-col gap-2 relative hover:border-amber-500/20 transition-colors">
                              <span className="text-[9px] text-muted font-black uppercase tracking-wider">Cost Price</span>
                              <div className="flex items-center gap-2 font-mono text-xs">
                                <span className="text-red/60 line-through">₹{details.inventory.cost_price}</span>
                                <ChevronRight size={11} className="text-muted/40" />
                                <span className={`font-black text-sm ${costDiff !== 0 ? 'text-amber-400' : 'text-text'}`}>
                                  ₹{editInventoryForm.cost_price}
                                </span>
                              </div>
                              {costDiff !== 0 && (
                                <span className={`absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-md ${costDiff > 0 ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20'}`}>
                                  {costDiff > 0 ? `+₹${costDiff}` : `-₹${Math.abs(costDiff)}`}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Stock Master Form */}
                    <div className="bg-bg2 border border-glass-border p-5 rounded-2xl flex flex-col gap-5 shadow-xl">
                      <div className="flex items-center justify-between border-b border-glass-border/30 pb-3">
                        <div className="flex items-center gap-2">
                          <Package size={14} className="text-primary" />
                          <h3 className="text-xs font-bold text-text uppercase tracking-wider">Master Inventory Record Parameters</h3>
                        </div>
                        <span className="text-[10px] text-muted font-mono font-bold">
                          Item ID: #{details?.inventory?.id}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">Box Quantity</label>
                          <input
                            type="number"
                            value={editInventoryForm.quantity}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, quantity: Math.max(0, Number(e.target.value)) }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">Loose Quantity</label>
                          <input
                            type="number"
                            value={editInventoryForm.loose_quantity}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, loose_quantity: Math.max(0, Number(e.target.value)) }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">Batch Number</label>
                          <input
                            type="text"
                            value={editInventoryForm.batch_no}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, batch_no: e.target.value }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">Expiry Date</label>
                          <input
                            type="text"
                            placeholder="MM/YY"
                            value={editInventoryForm.expiry_date}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, expiry_date: e.target.value }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">MRP (₹)</label>
                          <input
                            type="number"
                            value={editInventoryForm.mrp}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, mrp: Math.max(0, Number(e.target.value)) }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-muted uppercase">Cost Price (₹)</label>
                          <input
                            type="number"
                            value={editInventoryForm.cost_price}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, cost_price: Math.max(0, Number(e.target.value)) }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 sm:col-span-2 md:col-span-3">
                          <label className="text-[10px] font-bold text-muted uppercase">Rack Location</label>
                          <input
                            type="text"
                            placeholder="e.g. Rack A1, Shelf 2"
                            value={editInventoryForm.rack_location}
                            onChange={e => setEditInventoryForm(prev => ({ ...prev, rack_location: e.target.value }))}
                            className="bg-bg3 border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 border-t border-glass-border/30 pt-4">
                        <button
                          onClick={() => setEditingType(null)}
                          className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border transition-colors text-xs font-bold cursor-pointer"
                        >
                          Discard
                        </button>
                        <button
                          onClick={saveInventoryAdjustment}
                          className="px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/95 transition-all text-xs font-bold shadow-[0_0_15px_rgba(34,197,150,0.2)] cursor-pointer"
                        >
                          Save Stock Adjustments
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Panel: Audit Logs Timeline (Col span 4) */}
                  <div className="lg:col-span-4 bg-bg2 border border-glass-border rounded-2xl p-5 flex flex-col gap-4 shadow-xl sticky top-0 self-start min-h-[450px] animate-in fade-in slide-in-from-right-4 duration-300 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />

                    <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3 shrink-0">
                      <History size={14} className="text-primary animate-pulse" />
                      <h3 className="text-xs font-bold text-text uppercase tracking-wider">Audit Trail / History</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-3.5 max-h-[500px]">
                      {auditLogs.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted py-12">
                          <Clock size={28} className="opacity-20 mb-2" />
                          <p className="text-xs font-bold">No prior audit logs</p>
                          <p className="text-[10px] mt-0.5 max-w-[180px]">No historical ledger corrections found for this item.</p>
                        </div>
                      ) : (
                        <div className="relative pl-5 border-l-2 border-dashed border-glass-border/50 ml-2.5 flex flex-col gap-5 py-1">
                          {auditLogs.map((log, idx) => {
                            const action = log.action_type || '';
                            const isCorrection = action.includes('CORRECTION') || action.includes('ADJUST');
                            const isPositive = action.includes('IN') || action.includes('RETURN');
                            const isNegative = action.includes('OUT') || action.includes('SALE') || action.includes('DELETE');

                            return (
                              <div key={log.id || idx} className="relative flex flex-col gap-1 text-[11px] animate-in fade-in duration-300">
                                <span className={`absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-bg2 ${isCorrection ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                                    isPositive ? 'bg-green shadow-[0_0_8px_rgba(34,197,150,0.5)]' :
                                      isNegative ? 'bg-red shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                                        'bg-primary shadow-[0_0_8px_rgba(34,197,150,0.5)]'
                                  }`} />

                                <div className="flex justify-between items-center text-[9px] font-bold text-muted uppercase tracking-wider">
                                  <span className={
                                    isCorrection ? 'text-amber-500' :
                                      isPositive ? 'text-green' :
                                        isNegative ? 'text-red' :
                                          'text-primary'
                                  }>
                                    {action.replace(/_/g, ' ')}
                                  </span>
                                  <span className="font-mono text-muted/60">{formatDate(log.created_at)}</span>
                                </div>
                                <p className="text-text font-medium leading-relaxed bg-bg3/40 border border-glass-border/30 rounded-xl p-2.5 mt-0.5 shadow-sm hover:border-glass-border/60 transition-colors">
                                  {log.description}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(editingType === 'sale' || editingType === 'purchase') && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">

                  {/* Left Panel: Autocomplete and Item List (Col span 8) */}
                  <div className="lg:col-span-8 flex flex-col gap-5 w-full animate-in fade-in slide-in-from-left-4 duration-300">

                    {/* Medicine Search Card */}
                    <div className="bg-bg2 border border-glass-border p-5 rounded-2xl shadow-xl flex flex-col gap-3 relative z-30">
                      <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Search & Add Medicines</label>
                      <div className="relative" ref={medicineSearchRef}>
                        <Search className="absolute left-3 top-3.5 text-muted" size={14} />
                        <input
                          type="text"
                          placeholder="Search medicine to add to this transaction..."
                          value={searchMedicineQuery}
                          onChange={e => handleSearchMedicineForAdd(e.target.value)}
                          className="w-full bg-bg3 border border-glass-border rounded-xl pl-9 pr-4 py-2.5 text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-colors"
                        />
                        {searchMedicineResults.length > 0 && (
                          <div className="absolute top-full left-0 right-0 z-50 mt-2 bg-bg2/95 backdrop-blur-xl border border-glass-border rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto p-1.5 flex flex-col gap-1 animate-in fade-in slide-in-from-top-2 duration-200">
                            {searchMedicineResults.map((med, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleAddMedicineToBill(med)}
                                className="w-full text-left p-2.5 hover:bg-primary/10 rounded-lg text-xs text-text flex items-center justify-between border border-transparent hover:border-primary/20 transition-all cursor-pointer"
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-semibold text-text">{med.medicine_name}</span>
                                  <span className="text-[10px] text-muted">Batch: {med.batch_no || 'N/A'}</span>
                                </div>
                                <span className="font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded text-[10px] font-bold">
                                  Stock: {med.quantity}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bill Items List */}
                    <div className="bg-bg2 border border-glass-border rounded-2xl shadow-xl flex flex-col overflow-hidden">
                      <div className="p-4 border-b border-glass-border/30 bg-bg2/60 flex justify-between items-center">
                        <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-2">
                          <Package size={14} className="text-primary" />
                          Transaction Items ({billItems.length})
                        </h3>
                      </div>

                      <div className="p-4 flex flex-col gap-3 max-h-[520px] overflow-y-auto custom-scrollbar">
                        {billItems.length === 0 ? (
                          <div className="p-8 text-center text-muted text-xs flex flex-col items-center justify-center gap-2">
                            <AlertCircle size={24} className="opacity-30" />
                            No items in this transaction workspace.
                          </div>
                        ) : (
                          billItems.map((item, index) => {
                            const originalQty = item.original_qty || 0;
                            const qtyDiff = item.quantity - originalQty;

                            return (
                              <div key={index} className="p-3.5 bg-bg3/60 border border-glass-border/40 hover:border-glass-border/70 hover:bg-bg3/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition-all shadow-sm relative overflow-hidden group">
                                <div className="min-w-0 flex-1 flex flex-col gap-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-bold text-text truncate text-sm">{item.medicine_name}</p>
                                    {originalQty === 0 ? (
                                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-green/10 text-green border border-green/20 uppercase shrink-0">
                                        New Item
                                      </span>
                                    ) : qtyDiff !== 0 ? (
                                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md border uppercase shrink-0 ${qtyDiff > 0 ? 'bg-green/10 text-green border-green/20' : 'bg-red/10 text-red border-red/20'
                                        }`}>
                                        {qtyDiff > 0 ? `+${qtyDiff} Added` : `${qtyDiff} Reduced`}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] bg-bg2 border border-glass-border/40 px-2 py-0.5 rounded text-muted font-semibold">
                                      Batch: {item.batch_no}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center flex-wrap sm:flex-nowrap gap-3.5 shrink-0 justify-between sm:justify-end">
                                  {/* Quantity Stepper */}
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Qty</span>
                                    <div className="flex items-center bg-bg2 border border-glass-border rounded-lg overflow-hidden h-8">
                                      <button
                                        type="button"
                                        onClick={() => handleItemQtyChange(index, Math.max(0, item.quantity - 1))}
                                        className="px-2.5 hover:bg-bg3 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-r border-glass-border/40 cursor-pointer"
                                      >
                                        <Minus size={11} />
                                      </button>
                                      <input
                                        type="number"
                                        value={item.quantity}
                                        onChange={e => handleItemQtyChange(index, Math.max(0, Number(e.target.value)))}
                                        className="w-12 text-center bg-transparent font-mono font-bold text-text text-xs focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleItemQtyChange(index, item.quantity + 1)}
                                        className="px-2.5 hover:bg-bg3 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-l border-glass-border/40 cursor-pointer"
                                      >
                                        <Plus size={11} />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Loose Quantity Stepper (Sales only) */}
                                  {editingType === 'sale' && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Loose</span>
                                      <div className="flex items-center bg-bg2 border border-glass-border rounded-lg overflow-hidden h-8">
                                        <button
                                          type="button"
                                          onClick={() => handleItemLooseQtyChange(index, Math.max(0, item.loose_qty - 1))}
                                          className="px-2.5 hover:bg-bg3 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-r border-glass-border/40 cursor-pointer"
                                        >
                                          <Minus size={11} />
                                        </button>
                                        <input
                                          type="number"
                                          value={item.loose_qty}
                                          onChange={e => handleItemLooseQtyChange(index, Math.max(0, Number(e.target.value)))}
                                          className="w-10 text-center bg-transparent font-mono font-bold text-text text-xs focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleItemLooseQtyChange(index, item.loose_qty + 1)}
                                          className="px-2.5 hover:bg-bg3 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-l border-glass-border/40 cursor-pointer"
                                        >
                                          <Plus size={11} />
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Price Monospace */}
                                  <div className="flex flex-col text-right min-w-[65px]">
                                    <span className="text-[9px] text-muted uppercase font-bold tracking-wider">
                                      {editingType === 'sale' ? 'Unit Price' : 'Unit Cost'}
                                    </span>
                                    <span className="font-mono font-bold text-text text-xs mt-0.5">
                                      ₹{editingType === 'sale' ? item.unit_price : item.cost_price}
                                    </span>
                                  </div>

                                  {/* Remove Button */}
                                  <button
                                    onClick={() => handleRemoveBillItem(index)}
                                    className="p-2 rounded-xl hover:bg-red/10 border border-transparent hover:border-red/20 text-red transition-all cursor-pointer"
                                    title="Remove item"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Panel: Invoice Summary / Checkout Receipt Card (Col span 4) */}
                  <div className="lg:col-span-4 bg-bg2 border border-glass-border rounded-2xl p-5 flex flex-col gap-5 shadow-xl sticky top-0 self-start animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3 shrink-0">
                      <FileText size={14} className="text-primary" />
                      <h3 className="text-xs font-bold text-text uppercase tracking-wider">Reconciliation Summary</h3>
                    </div>

                    <div className="flex flex-col gap-4 text-xs border-b border-glass-border/35 pb-4">
                      {/* Subtotal */}
                      <div className="flex justify-between items-center text-muted">
                        <span>Subtotal</span>
                        <span className="font-mono font-bold text-text">
                          ₹{billItems.reduce((acc, it) => acc + (it.quantity * (editingType === 'sale' ? it.unit_price : it.cost_price)), 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Taxes */}
                      {editingType === 'sale' && (
                        <div className="flex justify-between items-center text-muted">
                          <span>GST / Taxes (5%)</span>
                          <span className="font-mono font-bold text-text">
                            ₹{(billItems.reduce((acc, it) => acc + (it.quantity * it.unit_price), 0) * 0.05).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {editingType === 'purchase' && (
                        <div className="flex justify-between items-center text-muted">
                          <span>GST / Taxes (CGST+SGST)</span>
                          <span className="font-mono font-bold text-text">
                            ₹{billItems.reduce((acc, it) => {
                              const taxable = (it.quantity * it.cost_price) - (it.cd_value || 0);
                              const gstPer = (it.cgst_per || 0) + (it.sgst_per || 0);
                              return acc + (taxable * gstPer / 100);
                            }, 0).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {editingType === 'purchase' && (
                        <div className="flex justify-between items-center text-muted">
                          <span>Cash Discount</span>
                          <span className="font-mono font-bold text-text">
                            ₹{billItems.reduce((acc, it) => acc + (it.cd_value || 0), 0).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Discount Override Input */}
                      {editingType === 'sale' && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted">Discount Override</span>
                          <div className="relative w-24">
                            <span className="absolute left-2.5 top-1.5 text-[10px] text-muted">₹</span>
                            <input
                              type="number"
                              value={billDiscount}
                              onChange={e => setBillDiscount(Math.max(0, Number(e.target.value)))}
                              className="w-full bg-bg3 border border-glass-border rounded-lg pl-5 pr-2 py-1 font-mono font-bold text-right text-text text-xs focus:outline-none focus:border-primary/50"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Net Amount Display */}
                    <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-between shadow-inner">
                      <span className="text-xs font-black text-primary uppercase tracking-wider">Net Amount</span>
                      <span className="text-lg font-black font-mono text-primary">
                        ₹{calculateRecalculatedTotal().toLocaleString()}
                      </span>
                    </div>

                    {/* Actions Grid */}
                    <div className="flex flex-col gap-2.5 pt-2">
                      <button
                        onClick={saveBillCorrections}
                        className="w-full py-2.5 rounded-xl bg-primary text-white hover:bg-primary/95 transition-all text-xs font-bold shadow-[0_0_15px_rgba(34,197,150,0.35)] cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Check size={14} />
                        Save Corrections
                      </button>
                      <button
                        onClick={() => setEditingType(null)}
                        className="w-full py-2.5 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border transition-colors text-xs font-bold cursor-pointer"
                      >
                        Discard Workspace
                      </button>
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── UNIFIED LEDGER TABLE ── */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {isFetching && items.length === 0 ? (
              /* Loading State */
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <Loader2 size={22} className="animate-spin text-primary" />
                    </div>
                    <div className="absolute inset-0 bg-primary/10 rounded-2xl blur-lg animate-pulse" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-black text-text uppercase tracking-wider">Loading Stock Ledger</p>
                    <p className="text-[10px] text-muted mt-1">Fetching transactions...</p>
                  </div>
                  {/* Stagger dots */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            ) : items.length === 0 ? (
              /* Empty State */
              <div className="h-full flex flex-col items-center justify-center text-center p-12 relative overflow-hidden">
                {/* Subtle grid bg */}
                <div className="absolute inset-0 opacity-[0.03]" style={{
                  backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }} />
                <div className="relative flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-3xl bg-muted/5 border border-glass-border/30 flex items-center justify-center">
                      <PackageSearch size={28} className="text-muted/30" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <AlertTriangle size={11} className="text-amber-500" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-black text-sm text-text">No ledger entries found</h3>
                    <p className="text-xs text-muted mt-1 max-w-xs leading-relaxed">Try adjusting the calendar dates or column search filters to find transactions.</p>
                  </div>
                  {debouncedMedicine && debouncedMedicine.trim().length >= 2 && (
                    <div className="flex flex-col items-center gap-1.5 bg-amber-500/5 px-4 py-3 rounded-xl border border-amber-500/20">
                      <span className="text-xs text-amber-400 font-semibold">
                        🔍 No results for "{debouncedMedicine}" — check spelling or try batch/invoice number.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <InfiniteTable
                  totalSize={rowVirtualizer.getTotalSize()}
                  containerRef={parentRef}
                  className="border-t border-glass-border/30"
                  header={
                    <tr className="flex items-center min-w-[1750px] bg-bg2/90 backdrop-blur-sm border-b border-glass-border/40 text-muted font-bold text-[10px] select-none py-2.5 sticky top-0 z-10">
                      {/* Medicine Header — always visible */}
                      <th className="px-4 text-left min-w-[180px] flex-1 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                        Medicine
                      </th>
                      {col('batch') && (
                        <th className="px-3 text-left w-28 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                          Batch
                        </th>
                      )}
                      {col('date') && (
                        <th className="px-3 text-left w-44 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                          Date
                        </th>
                      )}
                      {col('invoice') && (
                        <th className="px-3 text-left w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                          Invoice
                        </th>
                      )}
                      {col('party') && (
                        <th className="px-3 text-left w-40 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                          Party
                        </th>
                      )}
                      {col('openingStock') && (
                        <th className="px-3 text-center w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">
                          Opening
                        </th>
                      )}
                      {col('purchase') && <th className="px-3 text-center w-24 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Purchase</th>}
                      {col('sales') && <th className="px-3 text-center w-24 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Sales</th>}
                      {col('purchaseReturn') && <th className="px-3 text-center w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Pur. Return</th>}
                      {col('salesReturn') && <th className="px-3 text-center w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Sale Return</th>}
                      {col('adj') && <th className="px-3 text-center w-24 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Adj</th>}
                      {col('stockAudit') && <th className="px-3 text-center w-28 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Stock Audit</th>}
                      {col('b2bSales') && <th className="px-3 text-center w-28 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">B2B Sales</th>}
                      {col('closingStock') && <th className="px-3 text-center w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Closing</th>}
                      {col('medicineStock') && <th className="px-3 text-center w-32 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black border-r border-glass-border/15">Med. Stock</th>}
                      <th className="px-3 text-center w-24 shrink-0 uppercase text-[9px] tracking-widest text-muted/70 font-black">
                        Actions
                      </th>
                    </tr>
                  }
                  body={
                    rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = items[virtualRow.index];
                      if (!item) return null;

                      // Determine left-border accent color by type
                      const accentClass =
                        item.type === 'Sale' ? 'border-l-sky-500/60' :
                        item.type === 'Purchase' ? 'border-l-green/60' :
                        item.type === 'Adjustment' ? 'border-l-amber-500/60' :
                        item.return_type === 'purchase' ? 'border-l-orange-500/60' :
                        'border-l-purple-500/60';

                      return (
                        <VirtualRow
                          key={virtualRow.key}
                          ref={rowVirtualizer.measureElement}
                          start={virtualRow.start}
                          size={virtualRow.size}
                          className={`min-w-[1750px] border-b border-glass-border/15 border-l-2 ${accentClass} hover:bg-primary/3 transition-colors`}
                        >
                          {/* Medicine Cell */}
                          <td className="p-2 border-r border-glass-border/15 flex-1 min-w-[180px] text-text truncate" title={item.medicine_name}>
                            <div className="flex items-center gap-2.5 truncate">
                              <span className="shrink-0 p-1.5 rounded-lg bg-bg3/60 border border-glass-border/25">
                                {getTypeIcon(item.type, item.return_type)}
                              </span>
                              <div className="truncate flex flex-col gap-0.5 min-w-0">
                                <span className="font-bold text-text truncate text-xs">{item.medicine_name || 'System Activity'}</span>
                                <span className="text-[9px] text-muted/70 font-black tracking-widest uppercase">
                                  {item.type === 'Return' ? `${item.return_type} return` : item.type}
                                </span>
                              </div>
                              <span className={`text-[8px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded-md border shrink-0 ${
                                item.type === 'Sale' ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' :
                                item.type === 'Purchase' ? 'bg-green/10 border-green/20 text-green' :
                                item.type === 'Adjustment' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                                item.return_type === 'purchase' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                                'bg-purple-500/10 border-purple-500/20 text-purple-400'
                              }`}>
                                {item.type}
                              </span>
                            </div>
                          </td>
                          {col('batch') && <td className="p-2 border-r border-glass-border/15 w-28 shrink-0 font-mono font-bold text-muted truncate text-xs">{item.batch_no || 'N/A'}</td>}
                          {col('date') && <td className="p-2 border-r border-glass-border/15 w-44 shrink-0 font-mono whitespace-nowrap text-muted truncate text-xs" title={formatDate(item.date)}>{formatDate(item.date)}</td>}

                          {/* Invoice cell */}
                          {col('invoice') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 truncate text-xs">
                              {item.invoice_id || item.purchase_id ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (item.type === 'Sale') handleStartSaleBillEdit(item);
                                    if (item.type === 'Purchase') handleStartPurchaseBillEdit(item);
                                  }}
                                  className="text-accent hover:text-accent/80 font-black text-left cursor-pointer underline decoration-dotted truncate w-full block"
                                >
                                  {item.reference}
                                </button>
                              ) : (
                                <span className="text-muted font-medium">{item.reference}</span>
                              )}
                            </td>
                          )}

                          {col('party') && (
                            <td className="p-2 border-r border-glass-border/15 w-40 shrink-0 truncate text-xs">
                              <div className="truncate w-full text-muted font-medium">{item.party}</div>
                            </td>
                          )}

                          {/* Opening Stock */}
                          {col('openingStock') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 text-center font-mono text-xs text-muted">
                              <span className="text-text font-bold">{item.opening_qty || 0}</span>
                              {item.opening_loose > 0 && (
                                <span className="text-[10px] text-muted font-normal ml-0.5">::{item.opening_loose}</span>
                              )}
                            </td>
                          )}

                          {col('purchase') && (
                            <td className="p-2 border-r border-glass-border/15 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Purchase' ? (
                                <>
                                  <span className="text-green font-bold">{item.purchase_qty || 0}</span>
                                  {(item.free_qty || 0) > 0 && (
                                    <span className="text-[10px] text-green/60 font-semibold ml-0.5">+{item.free_qty}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/30">—</span>
                              )}
                            </td>
                          )}

                          {col('sales') && (
                            <td className="p-2 border-r border-glass-border/15 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Sale' ? (
                                <>
                                  <span className="text-sky-400 font-bold">{item.sale_qty || 0}</span>
                                  {(item.sale_loose || 0) > 0 && (
                                    <span className="text-[10px] text-sky-400/60 font-semibold ml-0.5">::{item.sale_loose}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/30">—</span>
                              )}
                            </td>
                          )}

                          {col('purchaseReturn') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Return' && item.return_type === 'purchase' ? (
                                <span className="text-orange-400 font-bold">{item.purchase_return_qty || 0}</span>
                              ) : (
                                <span className="text-muted/30">—</span>
                              )}
                            </td>
                          )}

                          {col('salesReturn') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Return' && item.return_type === 'sale' ? (
                                <span className="text-purple-400 font-bold">{item.sales_return_qty || 0}</span>
                              ) : (
                                <span className="text-muted/30">—</span>
                              )}
                            </td>
                          )}

                          {col('adj') && (
                            <td className="p-2 border-r border-glass-border/15 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Adjustment' ? (
                                <>
                                  <span className="text-amber-500 font-bold">{item.adj_qty || 0}</span>
                                  {(item.adj_loose || 0) > 0 && (
                                    <span className="text-[10px] text-amber-500/60 font-semibold ml-0.5">::{item.adj_loose}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/30">—</span>
                              )}
                            </td>
                          )}

                          {col('stockAudit') && <td className="p-2 border-r border-glass-border/15 w-28 shrink-0 text-center font-mono text-xs text-muted/30">—</td>}
                          {col('b2bSales') && <td className="p-2 border-r border-glass-border/15 w-28 shrink-0 text-center font-mono text-xs text-muted/30">—</td>}

                          {col('closingStock') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 text-center font-mono text-xs">
                              <span className="font-bold text-text">{item.closing_qty || 0}</span>
                              {item.closing_loose > 0 && (
                                <span className="text-[10px] text-muted/70 font-semibold ml-0.5">::{item.closing_loose}</span>
                              )}
                            </td>
                          )}

                          {col('medicineStock') && (
                            <td className="p-2 border-r border-glass-border/15 w-32 shrink-0 text-center font-mono text-xs">
                              <span className="font-bold text-text/80">{item.medicine_stock_qty || 0}</span>
                              {item.medicine_stock_loose > 0 && (
                                <span className="text-[10px] text-muted/70 font-semibold ml-0.5">::{item.medicine_stock_loose}</span>
                              )}
                            </td>
                          )}

                          {/* Action Button — icon style */}
                          <td className="p-2 w-24 shrink-0 text-center">
                            {item.inventory_id ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAdjustStock(item.inventory_id);
                                }}
                                className="px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500 hover:text-white hover:shadow-[0_0_10px_rgba(245,158,11,0.4)] text-amber-500 transition-all text-[10px] font-extrabold cursor-pointer flex items-center gap-1 mx-auto"
                                title="Direct Stock Master Adjustment"
                              >
                                <Sliders size={9} />
                                Adjust
                              </button>
                            ) : (
                              <span className="text-[10px] text-muted/30 font-medium">N/A</span>
                            )}
                          </td>
                        </VirtualRow>
                      );
                    })
                  }
                />
                <InfiniteScrollStatus
                  totalItems={totalItems}
                  loadedCount={items.length}
                  isFetching={isFetching}
                  isFetchingNextPage={isFetchingNextPage}
                  hasNextPage={hasNextPage}
                  onLoadMore={fetchNextPage}
                  sentinelRef={sentinelRef}
                  itemName="transactions"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestigationCenter;
