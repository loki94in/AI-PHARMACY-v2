import { useState, useEffect, useCallback, useRef } from 'react';
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
import { getTodayString, getNDaysAgoString, formatDisplayDate } from '../../utils/date';
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
  // Column-header inline filters
  const [colFilterMedicine, setColFilterMedicine] = useState('');
  const [colFilterBatch, setColFilterBatch] = useState('');
  const [colFilterInvoice, setColFilterInvoice] = useState('');
  const [colFilterParty, setColFilterParty] = useState('');
  const [colFilterType, setColFilterType] = useState('All');

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
    { key: 'batch',          label: 'Batch' },
    { key: 'date',           label: 'Date' },
    { key: 'invoice',        label: 'Invoice' },
    { key: 'party',          label: 'Party' },
    { key: 'openingStock',   label: 'Opening Stock' },
    { key: 'purchase',       label: 'Purchase' },
    { key: 'sales',          label: 'Sales' },
    { key: 'purchaseReturn', label: 'Purchase Return' },
    { key: 'salesReturn',    label: 'Sales Return' },
    { key: 'adj',            label: 'Adj' },
    { key: 'stockAudit',     label: 'Stock Audit' },
    { key: 'b2bSales',       label: 'B2B Sales' },
    { key: 'closingStock',   label: 'Closing Stock' },
    { key: 'medicineStock',  label: 'Medicine Stock' },
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
    onConfirm: () => void;
  } | null>(null);

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

  // Client-side filtering logic
  const clientFilterFn = useCallback((tx: any) => {
    if (colFilterMedicine) {
      const medName = (tx.medicine_name || '').toLowerCase();
      if (!medName.includes(colFilterMedicine.toLowerCase())) return false;
    }
    if (colFilterBatch) {
      const batch = (tx.batch_no || '').toLowerCase();
      if (!batch.includes(colFilterBatch.toLowerCase())) return false;
    }
    if (colFilterInvoice) {
      const ref = (tx.reference || '').toLowerCase();
      if (!ref.includes(colFilterInvoice.toLowerCase())) return false;
    }
    if (colFilterParty) {
      const partyVal = (tx.party || '').toLowerCase();
      if (!partyVal.includes(colFilterParty.toLowerCase())) return false;
    }
    return true;
  }, [colFilterMedicine, colFilterBatch, colFilterInvoice, colFilterParty]);

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
    },
    clientFilterFn,
    fetchPage: async (pageParam, filters) => {
      const cleanFilters: any = {
        page: pageParam,
        limit: 100,
      };
      if (filters.dateFrom) cleanFilters.dateFrom = filters.dateFrom;
      if (filters.dateTo) cleanFilters.dateTo = filters.dateTo;
      if (filters.type && filters.type !== 'All') cleanFilters.type = filters.type;
      
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
          api.getCompactInventory().catch(() => {});
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
      return billItems.reduce((acc, it) => acc + (it.quantity * it.cost_price), 0);
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
          batch_no: med.batch_no || 'MANUAL',
          expiry_date: med.expiry_date || '12/28',
          quantity: 1,
          cost_price: med.cost_price || (med.mrp * 0.7),
          mrp: med.mrp,
          free_qty: 0,
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
          api.getCompactInventory().catch(() => {});
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

      {/* Confirmation Modal */}
      {confirmModal && confirmModal.show && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-glass-border max-w-md w-full rounded-2xl shadow-2xl overflow-hidden p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertTriangle size={24} />
              <h3 className="font-bold text-base text-text">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end gap-3 mt-2">
              <button 
                onClick={() => setConfirmModal(null)} 
                className="px-4 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border transition-colors text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm} 
                className="px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/95 transition-all text-xs font-bold shadow-[0_0_15px_rgba(34,197,150,0.2)] cursor-pointer"
              >
                Confirm Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsLoading && (
        <div className="absolute inset-0 z-[80] bg-black/40 backdrop-blur-xs flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 animate-pulse text-muted">
            <Loader2 size={32} className="animate-spin text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider">Fetching details...</span>
          </div>
        </div>
      )}

      {/* KPI Cards (Dashboard Summary View) - Only visible when not editing */}
      {!editingType && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0 animate-in fade-in duration-300">
          <div className="bg-glass-bg border border-glass-border/65 rounded-2xl p-4 flex items-center justify-between shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Total Ledgers</span>
              <span className="text-2xl font-black text-text font-mono">
                {totalItems.toLocaleString()}
              </span>
              <span className="text-[9px] text-muted">Across selected dates</span>
            </div>
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/25 text-accent shadow-sm">
              <FileText size={18} />
            </div>
          </div>

          <div className="bg-glass-bg border border-glass-border/65 rounded-2xl p-4 flex items-center justify-between shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Sales Events</span>
              <span className="text-2xl font-black text-sky-400 font-mono">
                {salesCount.toLocaleString()}
              </span>
              <span className="text-[9px] text-muted">Currently loaded</span>
            </div>
            <div className="p-3 rounded-xl bg-sky-400/10 border border-sky-400/25 text-sky-400 shadow-sm">
              <ShoppingCart size={18} />
            </div>
          </div>

          <div className="bg-glass-bg border border-glass-border/65 rounded-2xl p-4 flex items-center justify-between shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Purchases</span>
              <span className="text-2xl font-black text-green-400 font-mono">
                {purchasesCount.toLocaleString()}
              </span>
              <span className="text-[9px] text-muted">Currently loaded</span>
            </div>
            <div className="p-3 rounded-xl bg-green-400/10 border border-green-400/25 text-green-400 shadow-sm">
              <Package size={18} />
            </div>
          </div>

          <div className="bg-glass-bg border border-glass-border/65 rounded-2xl p-4 flex items-center justify-between shadow-lg hover:-translate-y-0.5 transition-all">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Stock Adjustments</span>
              <span className="text-2xl font-black text-amber-500 font-mono">
                {adjustmentsCount.toLocaleString()}
              </span>
              <span className="text-[9px] text-muted">Manually corrected</span>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-500 shadow-sm">
              <Sliders size={18} />
            </div>
          </div>
        </div>
      )}

      {editingType ? (
        /* CORRECTION WORKSPACE PANEL */
        <div className="flex-1 bg-glass-bg border border-glass-border rounded-2xl flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-300">
          <div className="p-4 border-b border-glass-border/30 bg-bg2/40 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <Edit size={16} className="text-primary" />
              <h2 className="text-sm font-black text-text uppercase tracking-wider">
                {editingType === 'inventory' ? 'Inventory Direct Correction' : 
                 editingType === 'sale' ? `Correcting Sales Invoice #${editingBillNo}` : 
                 `Correcting Purchase Bill #${editingBillNo}`}
              </h2>
            </div>
            <button 
              onClick={() => setEditingType(null)} 
              className="text-xs text-muted hover:text-text font-bold bg-bg3 border border-glass-border px-3 py-1.5 rounded-xl transition-all cursor-pointer"
            >
              Discard Workspace
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-bg2/10">
            {editingType === 'inventory' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">
                
                {/* Left Panel: Form & Preview (Col span 8) */}
                <div className="lg:col-span-8 flex flex-col gap-6 w-full animate-in fade-in slide-in-from-left-4 duration-300">
                  
                  {/* Before vs After Preview Card */}
                  {details && details.inventory && (
                    <div className="bg-bg2 border border-glass-border p-5 rounded-2xl flex flex-col gap-4 shadow-xl">
                      <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3">
                        <Info size={14} className="text-primary" />
                        <h3 className="text-xs font-bold text-text uppercase tracking-wider">Adjustment Preview</h3>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {/* Compare Box Qty */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">Box Quantity</span>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-red/85 line-through">{details.inventory.quantity}</span>
                            <ChevronRight size={12} className="text-muted" />
                            <span className={`font-bold ${editInventoryForm.quantity !== details.inventory.quantity ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              {editInventoryForm.quantity}
                            </span>
                          </div>
                        </div>

                        {/* Compare Loose Qty */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">Loose Qty</span>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-red/85 line-through">{details.inventory.loose_quantity}</span>
                            <ChevronRight size={12} className="text-muted" />
                            <span className={`font-bold ${editInventoryForm.loose_quantity !== details.inventory.loose_quantity ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              {editInventoryForm.loose_quantity}
                            </span>
                          </div>
                        </div>

                        {/* Compare Batch */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">Batch Number</span>
                          <div className="flex items-center gap-2 font-mono text-xs truncate">
                            <span className="text-red/85 line-through truncate max-w-[60px]">{details.inventory.batch_no}</span>
                            <ChevronRight size={12} className="text-muted shrink-0" />
                            <span className={`font-bold truncate max-w-[90px] ${editInventoryForm.batch_no !== details.inventory.batch_no ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              {editInventoryForm.batch_no}
                            </span>
                          </div>
                        </div>

                        {/* Compare Expiry */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">Expiry Date</span>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-red/85 line-through">{details.inventory.expiry_date}</span>
                            <ChevronRight size={12} className="text-muted" />
                            <span className={`font-bold ${editInventoryForm.expiry_date !== details.inventory.expiry_date ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              {editInventoryForm.expiry_date}
                            </span>
                          </div>
                        </div>

                        {/* Compare MRP */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">MRP (₹)</span>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-red/85 line-through">₹{details.inventory.mrp}</span>
                            <ChevronRight size={12} className="text-muted" />
                            <span className={`font-bold ${editInventoryForm.mrp !== details.inventory.mrp ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              ₹{editInventoryForm.mrp}
                            </span>
                          </div>
                        </div>

                        {/* Compare Cost Price */}
                        <div className="bg-bg3/30 border border-glass-border/30 rounded-xl p-3 flex flex-col gap-1.5 animate-in fade-in duration-300">
                          <span className="text-[10px] text-muted font-bold uppercase">Cost Price (₹)</span>
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="text-red/85 line-through">₹{details.inventory.cost_price}</span>
                            <ChevronRight size={12} className="text-muted" />
                            <span className={`font-bold ${editInventoryForm.cost_price !== details.inventory.cost_price ? 'text-green font-extrabold text-sm' : 'text-text'}`}>
                              ₹{editInventoryForm.cost_price}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Input Form Card */}
                  <div className="bg-bg2 border border-glass-border p-6 rounded-2xl flex flex-col gap-6 shadow-xl">
                    <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3">
                      <Sliders size={14} className="text-primary" />
                      <h3 className="text-xs font-bold text-text uppercase tracking-wider">Adjustment Parameters</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted uppercase">Stock Quantity</label>
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
                <div className="lg:col-span-4 bg-bg2 border border-glass-border rounded-2xl p-5 flex flex-col gap-4 shadow-xl self-stretch min-h-[450px] animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3 shrink-0">
                    <History size={14} className="text-primary" />
                    <h3 className="text-xs font-bold text-text uppercase tracking-wider">Audit Trail / History</h3>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-3.5 max-h-[500px]">
                    {auditLogs.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center text-muted py-8">
                        <Clock size={28} className="opacity-20 mb-2" />
                        <p className="text-[10px] leading-relaxed">No prior audit logs found for this item.</p>
                      </div>
                    ) : (
                      <div className="relative pl-4 border-l border-glass-border/40 ml-1.5 flex flex-col gap-4">
                        {auditLogs.map((log, idx) => (
                          <div key={log.id || idx} className="relative flex flex-col gap-1 text-[11px] animate-in fade-in duration-300">
                            {/* Dot on line */}
                            <span className="absolute -left-[20.5px] top-1 w-2 h-2 rounded-full bg-primary/80 ring-4 ring-bg2" />
                            
                            <div className="flex justify-between items-center text-[9px] font-semibold text-muted">
                              <span className="uppercase text-primary">{log.action_type?.replace(/_/g, ' ')}</span>
                              <span>{formatDate(log.created_at)}</span>
                            </div>
                            <p className="text-text font-medium leading-relaxed bg-bg3/20 border border-glass-border/20 rounded-lg p-2 mt-0.5">
                              {log.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {(editingType === 'sale' || editingType === 'purchase') && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">
                
                {/* Left Panel: Autocomplete and Item List (Col span 8) */}
                <div className="lg:col-span-8 flex flex-col gap-4 w-full animate-in fade-in slide-in-from-left-4 duration-300">
                  
                  {/* Medicine Search Card */}
                  <div className="bg-bg2 border border-glass-border p-4 rounded-2xl shadow-xl flex flex-col gap-3">
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Search & Add Medicines</label>
                    <div className="relative" ref={medicineSearchRef}>
                      <Search className="absolute left-3 top-3.5 text-muted" size={14} />
                      <input 
                        type="text"
                        placeholder="Search medicine to add to this transaction..."
                        value={searchMedicineQuery}
                        onChange={e => handleSearchMedicineForAdd(e.target.value)}
                        className="w-full bg-bg3 border border-glass-border rounded-xl pl-9 pr-3 py-2.5 text-xs text-text placeholder-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                      {searchMedicineResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-[100] mt-2 bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto p-1.5 flex flex-col gap-1 animate-in fade-in slide-in-from-top-2 duration-200">
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
                  <div className="bg-bg2 border border-glass-border rounded-2xl shadow-xl flex flex-col min-h-[300px] overflow-hidden">
                    <div className="px-5 py-4 border-b border-glass-border/30 bg-bg2/40 flex justify-between items-center">
                      <span className="text-xs font-bold text-text uppercase tracking-wider">Transaction Workspace Items</span>
                      <span className="text-[10px] text-muted font-bold font-mono bg-bg3 px-2 py-0.5 rounded-lg">
                        {billItems.length} {billItems.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-[450px] custom-scrollbar bg-bg2/10">
                      {billItems.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted py-12">
                          <Package size={36} className="opacity-20 mb-2" />
                          <p className="text-xs font-semibold">No items in this transaction workspace.</p>
                          <p className="text-[10px] mt-0.5">Search and select a medicine above to add it.</p>
                        </div>
                      ) : (
                        billItems.map((item, index) => (
                          <div key={index} className="p-4 bg-bg2 border border-glass-border/35 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs hover:border-glass-border/60 transition-all shadow-sm">
                            <div className="min-w-0 flex-1 flex flex-col gap-1">
                              <p className="font-black text-text truncate text-sm">{item.medicine_name}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] bg-bg3 border border-glass-border/40 px-2 py-0.5 rounded text-muted font-semibold">
                                  Batch: {item.batch_no}
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-4 shrink-0 justify-between sm:justify-end">
                              {/* Quantity Stepper */}
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Qty</span>
                                <div className="flex items-center bg-bg3 border border-glass-border rounded-lg overflow-hidden h-8">
                                  <button
                                    type="button"
                                    onClick={() => handleItemQtyChange(index, Math.max(0, item.quantity - 1))}
                                    className="px-2 hover:bg-bg2 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-r border-glass-border/40 cursor-pointer"
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
                                    className="px-2 hover:bg-bg2 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-l border-glass-border/40 cursor-pointer"
                                  >
                                    <Plus size={11} />
                                  </button>
                                </div>
                              </div>

                              {/* Loose Quantity Stepper (Sales only) */}
                              {editingType === 'sale' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Loose</span>
                                  <div className="flex items-center bg-bg3 border border-glass-border rounded-lg overflow-hidden h-8">
                                    <button
                                      type="button"
                                      onClick={() => handleItemLooseQtyChange(index, Math.max(0, item.loose_qty - 1))}
                                      className="px-2 hover:bg-bg2 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-r border-glass-border/40 cursor-pointer"
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
                                      className="px-2 hover:bg-bg2 text-muted hover:text-text transition-colors h-full flex items-center justify-center border-l border-glass-border/40 cursor-pointer"
                                    >
                                      <Plus size={11} />
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Price Monospace */}
                              <div className="flex flex-col text-right">
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
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Panel: Invoice Summary / Checkout Receipt Card (Col span 4) */}
                <div className="lg:col-span-4 bg-bg2 border border-glass-border rounded-2xl p-5 flex flex-col gap-5 shadow-xl sticky top-4 animate-in fade-in slide-in-from-right-4 duration-300">
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
        /* UNIFIED LEDGER SPREADSHEET TIMELINE */
        <div className="flex-1 bg-glass-bg border border-glass-border rounded-2xl flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-300">
          
          {/* Controls Glass Card */}
          <div className="p-4 border-b border-glass-border/30 bg-bg2/30 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 select-none">
            <div className="flex flex-col gap-1">
              <h1 className="text-sm font-black text-text uppercase tracking-wider flex items-center gap-2">
                <PackageSearch size={18} className="text-primary animate-pulse" />
                Investigation Center
              </h1>
              <p className="text-[10px] text-muted leading-relaxed">
                Audit history, verify customer sales & distributor purchases, and correct stock.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Date Filters with Lucide Calendar icon */}
              <div className="flex items-center gap-2 bg-bg2/40 border border-glass-border/30 px-3 py-1.5 rounded-xl text-xs">
                <Calendar size={13} className="text-muted" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-muted font-bold uppercase">From</span>
                  <input
                    type="date"
                    value={dateRangeHelper.dateRange.from}
                    onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
                    className="px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] font-bold text-text focus:outline-none focus:border-primary/50 w-24 hover:border-glass-border/60 transition-colors"
                  />
                </div>
                <div className="flex items-center gap-1.5 border-l border-glass-border/30 pl-2">
                  <span className="text-[9px] text-muted font-bold uppercase">To</span>
                  <input
                    type="date"
                    value={dateRangeHelper.dateRange.to}
                    onChange={e => dateRangeHelper.handleToChange(e.target.value)}
                    className="px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] font-bold text-text focus:outline-none focus:border-primary/50 w-24 hover:border-glass-border/60 transition-colors"
                  />
                </div>
                {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
                  <button
                    onClick={() => dateRangeHelper.clearFilters()}
                    className="ml-1.5 text-[9px] font-extrabold text-red hover:underline cursor-pointer"
                    title="Clear dates"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('csv')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-xs font-bold transition-all cursor-pointer hover:shadow-md"
                  title="Export to CSV"
                >
                  <Download size={13} />
                  CSV
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-xs font-bold transition-all cursor-pointer hover:shadow-md"
                  title="Export to PDF"
                >
                  <Download size={13} />
                  PDF
                </button>

                {/* Column Toggle */}
                <div className="relative" ref={colMenuRef}>
                  <button
                    onClick={() => setShowColMenu(p => !p)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all hover:shadow-md ${
                      showColMenu
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60'
                    }`}
                    title="Toggle columns"
                  >
                    <Columns3 size={13} />
                    Columns
                    {visibleCols.size < COL_KEYS.length && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px] font-mono">
                        {COL_KEYS.length - visibleCols.size} hidden
                      </span>
                    )}
                  </button>

                  {showColMenu && (
                    <div className="absolute right-0 top-full mt-2 z-[200] w-56 bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-glass-border/30 bg-bg2/80">
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted">Ledger Columns</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setVisibleCols(defaultVisible);
                              localStorage.setItem('inv-ledger-cols', JSON.stringify([...defaultVisible]));
                            }}
                            className="text-[9px] font-bold text-primary hover:text-primary/80 transition-colors"
                          >
                            Reset
                          </button>
                          <button onClick={() => setShowColMenu(false)} className="text-muted hover:text-text transition-colors">
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="py-1.5 max-h-72 overflow-y-auto custom-scrollbar bg-bg2/40">
                        {COL_KEYS.map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => toggleCol(key)}
                            className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-primary/10 transition-colors text-left"
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                              visibleCols.has(key)
                                ? 'bg-primary border-primary'
                                : 'bg-transparent border-glass-border/60'
                            }`}>
                              {visibleCols.has(key) && <Check size={10} className="text-white" />}
                            </span>
                            <span className={`text-xs font-semibold ${ visibleCols.has(key) ? 'text-text' : 'text-muted/60' }`}>
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
          </div>
          
          {/* LEDGER SPREADSHEET VIEW CONTAINER */}
          <div className="flex-1 flex flex-col min-h-0 bg-bg2/5 p-4 overflow-hidden">
            {isFetching && items.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted animate-pulse">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="animate-spin text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wider">Loading Stock Ledger...</span>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted p-12">
                <Package size={44} className="opacity-20 mb-3 animate-bounce" />
                <h3 className="font-bold text-xs text-text">No ledger entries matches filters</h3>
                <p className="text-[11px] max-w-sm mt-1 leading-relaxed">Try adjusting the calendar dates or column filters.</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <InfiniteTable
                  totalSize={rowVirtualizer.getTotalSize()}
                  containerRef={parentRef}
                  className="border border-glass-border/30 rounded-xl bg-glass-bg"
                  header={
                    <tr className="flex items-center min-w-[1750px] bg-bg2 border-b border-glass-border/30 text-muted font-bold text-[10px] align-top select-none">
                      {/* Medicine Header — always visible */}
                      <th className="p-2 border-r border-glass-border/20 min-w-[180px] flex-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="uppercase text-[9px] tracking-wider text-muted font-black">Medicine</span>
                          <input
                            type="text"
                            placeholder="Filter medicine..."
                            value={colFilterMedicine}
                            onChange={e => setColFilterMedicine(e.target.value)}
                            className="w-full min-w-0 px-2.5 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          />
                        </div>
                      </th>
                      {/* Batch Header */}
                      {col('batch') && (
                        <th className="p-2 border-r border-glass-border/20 w-28 shrink-0 min-w-0">
                          <div className="flex flex-col gap-1.5">
                            <span className="uppercase text-[9px] tracking-wider text-muted font-black">Batch</span>
                            <input
                              type="text"
                              placeholder="Filter batch..."
                              value={colFilterBatch}
                              onChange={e => setColFilterBatch(e.target.value)}
                              className="w-full min-w-0 px-2.5 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                            />
                          </div>
                        </th>
                      )}
                      {/* Date Header */}
                      {col('date') && (
                        <th className="p-2 border-r border-glass-border/20 w-44 shrink-0">
                          <div className="flex flex-col gap-1.5">
                            <span className="uppercase text-[9px] tracking-wider text-muted font-black">Date</span>
                          </div>
                        </th>
                      )}
                      {/* Invoice Header */}
                      {col('invoice') && (
                        <th className="p-2 border-r border-glass-border/20 w-32 shrink-0 min-w-0">
                          <div className="flex flex-col gap-1.5">
                            <span className="uppercase text-[9px] tracking-wider text-muted font-black">Invoice</span>
                            <input
                              type="text"
                              placeholder="Filter invoice..."
                              value={colFilterInvoice}
                              onChange={e => setColFilterInvoice(e.target.value)}
                              className="w-full min-w-0 px-2.5 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                            />
                          </div>
                        </th>
                      )}
                      {/* Party Header */}
                      {col('party') && (
                        <th className="p-2 border-r border-glass-border/20 w-40 shrink-0 min-w-0">
                          <div className="flex flex-col gap-1.5">
                            <span className="uppercase text-[9px] tracking-wider text-muted font-black">Party</span>
                            <input
                              type="text"
                              placeholder="Filter party..."
                              value={colFilterParty}
                              onChange={e => setColFilterParty(e.target.value)}
                              className="w-full min-w-0 px-2.5 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                            />
                          </div>
                        </th>
                      )}
                      {/* Opening Stock Header (with Type Selector) */}
                      {col('openingStock') && (
                        <th className="p-2 border-r border-glass-border/20 text-center w-32 shrink-0 min-w-0">
                          <div className="flex flex-col gap-1.5 items-center">
                            <span className="uppercase text-[9px] tracking-wider text-muted font-black">Opening Stock</span>
                            <select
                              value={colFilterType}
                              onChange={e => setColFilterType(e.target.value)}
                              className="w-full min-w-0 px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal focus:outline-none focus:border-primary/50 cursor-pointer"
                            >
                              <option value="All">All Types</option>
                              <option value="Purchase">Purchases</option>
                              <option value="Sale">Sales</option>
                              <option value="Return">Returns</option>
                              <option value="Adjustment">Adjustments</option>
                            </select>
                          </div>
                        </th>
                      )}
                      {col('purchase') && <th className="p-2 border-r border-glass-border/20 text-center w-24 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Purchase</th>}
                      {col('sales') && <th className="p-2 border-r border-glass-border/20 text-center w-24 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Sales</th>}
                      {col('purchaseReturn') && <th className="p-2 border-r border-glass-border/20 text-center w-32 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Purchase Return</th>}
                      {col('salesReturn') && <th className="p-2 border-r border-glass-border/20 text-center w-32 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Sales Return</th>}
                      {col('adj') && <th className="p-2 border-r border-glass-border/20 text-center w-24 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Adj</th>}
                      {col('stockAudit') && <th className="p-2 border-r border-glass-border/20 text-center w-28 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Stock Audit</th>}
                      {col('b2bSales') && <th className="p-2 border-r border-glass-border/20 text-center w-28 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">B2B Sales</th>}
                      {col('closingStock') && <th className="p-2 border-r border-glass-border/20 text-center w-32 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Closing Stock</th>}
                      {col('medicineStock') && <th className="p-2 border-r border-glass-border/20 text-center w-32 shrink-0 uppercase text-[9px] tracking-wider text-muted font-black">Medicine Stock</th>}
                      <th className="p-2 text-center w-24 shrink-0">
                        <div className="flex flex-col gap-1 items-center justify-center">
                          <span className="uppercase text-[9px] tracking-wider text-muted font-black">Actions</span>
                          {(colFilterMedicine || colFilterBatch || dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to || colFilterInvoice || colFilterParty || colFilterType !== 'All') && (
                            <button
                              onClick={() => {
                                setColFilterMedicine('');
                                setColFilterBatch('');
                                dateRangeHelper.clearFilters();
                                setColFilterInvoice('');
                                setColFilterParty('');
                                setColFilterType('All');
                              }}
                              className="px-2.5 py-0.5 rounded-lg bg-red/15 border border-red/30 text-red-400 hover:bg-red hover:text-white transition-all text-[9px] font-extrabold cursor-pointer"
                              title="Clear Filters"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </th>
                    </tr>
                  }
                  body={
                    rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = items[virtualRow.index];
                      if (!item) return null;
                      return (
                        <VirtualRow
                          key={virtualRow.key}
                          ref={rowVirtualizer.measureElement}
                          start={virtualRow.start}
                          size={virtualRow.size}
                          className="min-w-[1750px] border-b border-glass-border/20 hover:bg-bg2/40 transition-colors"
                        >
                          {/* Medicine Cell with visual icons */}
                          <td className="p-2 border-r border-glass-border/20 flex-1 min-w-[180px] text-text truncate" title={item.medicine_name}>
                            <div className="flex items-center gap-2 truncate">
                              <span className="shrink-0 p-1.5 rounded-xl bg-bg3/60 border border-glass-border/40">
                                {getTypeIcon(item.type, item.return_type)}
                              </span>
                              <div className="truncate flex flex-col gap-0.5">
                                <span className="font-black text-text truncate text-xs">{item.medicine_name || 'System Activity'}</span>
                                <span className="text-[9px] text-muted font-bold tracking-wider uppercase">
                                  {item.type} {item.type === 'Return' && `(${item.return_type})`}
                                </span>
                              </div>
                            </div>
                          </td>
                          {col('batch') && <td className="p-2 border-r border-glass-border/20 w-28 shrink-0 font-mono font-bold text-muted truncate text-xs">{item.batch_no || 'N/A'}</td>}
                          {col('date') && <td className="p-2 border-r border-glass-border/20 w-44 shrink-0 font-mono whitespace-nowrap text-muted truncate text-xs" title={formatDate(item.date)}>{formatDate(item.date)}</td>}
                          
                          {/* Invoice cell */}
                          {col('invoice') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 truncate text-xs">
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
                            <td className="p-2 border-r border-glass-border/20 w-40 shrink-0 truncate text-xs">
                              <div className="truncate w-full text-muted font-medium">{item.party}</div>
                            </td>
                          )}

                          {/* Quantities cells with beautiful typography */}
                          {col('openingStock') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 text-center font-mono text-xs text-muted">
                              <span className="text-text font-bold">{item.opening_qty || 0}</span>
                              {item.opening_loose > 0 && (
                                <span className="text-[10px] text-muted font-normal ml-0.5">::{item.opening_loose}</span>
                              )}
                            </td>
                          )}

                          {col('purchase') && (
                            <td className="p-2 border-r border-glass-border/20 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Purchase' ? (
                                <>
                                  <span className="text-green font-bold">{item.purchase_qty || 0}</span>
                                  {(item.free_qty || 0) > 0 && (
                                    <span className="text-[10px] text-green/60 font-semibold ml-0.5">+{item.free_qty}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/40">0</span>
                              )}
                            </td>
                          )}

                          {col('sales') && (
                            <td className="p-2 border-r border-glass-border/20 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Sale' ? (
                                <>
                                  <span className="text-sky-400 font-bold">{item.sale_qty || 0}</span>
                                  {(item.sale_loose || 0) > 0 && (
                                    <span className="text-[10px] text-sky-400/60 font-semibold ml-0.5">::{item.sale_loose}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/40">0</span>
                              )}
                            </td>
                          )}

                          {col('purchaseReturn') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Return' && item.return_type === 'purchase' ? (
                                <span className="text-orange-400 font-bold">{item.purchase_return_qty || 0}</span>
                              ) : (
                                <span className="text-muted/40">0</span>
                              )}
                            </td>
                          )}

                          {col('salesReturn') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Return' && item.return_type === 'sale' ? (
                                <span className="text-purple-400 font-bold">{item.sales_return_qty || 0}</span>
                              ) : (
                                <span className="text-muted/40">0</span>
                              )}
                            </td>
                          )}

                          {col('adj') && (
                            <td className="p-2 border-r border-glass-border/20 w-24 shrink-0 text-center font-mono text-xs">
                              {item.type === 'Adjustment' ? (
                                <>
                                  <span className="text-amber-500 font-bold">{item.adj_qty || 0}</span>
                                  {(item.adj_loose || 0) > 0 && (
                                    <span className="text-[10px] text-amber-500/60 font-semibold ml-0.5">::{item.adj_loose}</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted/40">0</span>
                              )}
                            </td>
                          )}

                          {col('stockAudit') && <td className="p-2 border-r border-glass-border/20 w-28 shrink-0 text-center font-mono text-xs text-muted/30">0</td>}
                          {col('b2bSales') && <td className="p-2 border-r border-glass-border/20 w-28 shrink-0 text-center font-mono text-xs text-muted/30">0</td>}
                          
                          {col('closingStock') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 text-center font-mono text-xs text-text">
                              <span className="font-bold">{item.closing_qty || 0}</span>
                              {item.closing_loose > 0 && (
                                <span className="text-[10px] text-muted/70 font-semibold ml-0.5">::{item.closing_loose}</span>
                              )}
                            </td>
                          )}

                          {col('medicineStock') && (
                            <td className="p-2 border-r border-glass-border/20 w-32 shrink-0 text-center font-mono text-xs text-text/80">
                              <span className="font-bold">{item.medicine_stock_qty || 0}</span>
                              {item.medicine_stock_loose > 0 && (
                                <span className="text-[10px] text-muted/70 font-semibold ml-0.5">::{item.medicine_stock_loose}</span>
                              )}
                            </td>
                          )}

                          {/* Action Button Adjust */}
                          <td className="p-2 w-24 shrink-0 text-center">
                            {item.inventory_id ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAdjustStock(item.inventory_id);
                                }}
                                className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500 hover:text-white hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] text-amber-500 transition-all text-[10px] font-extrabold cursor-pointer"
                                title="Direct Stock Master Adjustment"
                              >
                                Adjust
                              </button>
                            ) : (
                              <span className="text-[10px] text-muted/40 font-medium">N/A</span>
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
        </div>
      )}
    </div>
  );
};

export default InvestigationCenter;
