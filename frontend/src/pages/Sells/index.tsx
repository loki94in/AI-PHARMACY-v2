import { useState, useEffect, useCallback, Fragment, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit3, Trash2, X, User, FileText, Save, AlertTriangle, BookOpen, RefreshCw, ShieldAlert, Factory, Calendar, RotateCcw, Download, QrCode, Printer, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useQueryClient } from '@tanstack/react-query';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, formatDisplayDate, toDateInputValue } from '../../utils/date';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { exportToCSV, exportToPDF } from '../../utils/export';

interface SaleItem {
  id: number;
  invoice_id: number;
  inventory_id: number;
  medicine_id?: number;
  quantity: number;
  unit_price: number;
  loose_qty?: number;
  pack_size?: number;
  batch_number?: string;
  expiry_date?: string;
  medicine_name?: string;
  mrp?: number;
  discount_per?: number;
}

interface SaleInvoice {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  tax_amount: number;
  payment_medium?: string;
  payment_status?: string;
  roff?: number;
  cgst_value?: number;
  sgst_value?: number;
  igst_value?: number;
  customer_name?: string;
  customer_phone?: string;
  doctor_name?: string;
  discount?: number;
  subtotal?: number;
  items?: SaleItem[];
}



// Module-level cache for instant re-mount
let cachedInvoices: SaleInvoice[] | null = null;

const exportColumns = [
  { key: 'invoice_no', label: 'Invoice No' },
  { key: 'customer_name', label: 'Patient Name' },
  { key: 'date', label: 'Date' },
  { key: 'doctor_name', label: 'Doctor Name' },
  { key: 'subtotal', label: 'Bill Amount' },
  { key: 'total_amount', label: 'Final Amount' },
  { key: 'discount', label: 'Discount (₹)' },
  { key: 'payment_medium', label: 'Pay Via' }
];

const Sells = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const todayStr = getTodayString();
  const thirtyDaysAgoStr = getNDaysAgoString(30);

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'sells-date-range',
    defaultFrom: thirtyDaysAgoStr,
    defaultTo: todayStr,
  });

  const [colFilterNo, setColFilterNo] = useState('');
  const [colFilterName, setColFilterName] = useState('');
  const [colFilterDrName, setColFilterDrName] = useState('');
  const [colFilterMinAmount, setColFilterMinAmount] = useState('');
  const [colFilterMaxAmount, setColFilterMaxAmount] = useState('');
  const [colFilterPayVia, setColFilterPayVia] = useState('');

  // Edit modal state
  const [editInvoice, setEditInvoice] = useState<SaleInvoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<SaleInvoice | null>(null);
  const [editItems, setEditItems] = useState<SaleItem[]>([]);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editDiscount, setEditDiscount] = useState(0);
  const [editPaymentMedium, setEditPaymentMedium] = useState('CASH');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // OpenFDA Enrichment Drawer State
  const [selectedEnrichedItem, setSelectedEnrichedItem] = useState<{ medicine_name: string; batch?: string } | null>(null);
  const [enrichedData, setEnrichedData] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Universal Edit state
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);
  const [universalEditItem, setUniversalEditItem] = useState<any>(null);

  // Barcode state
  const [barcodeModalInvoice, setBarcodeModalInvoice] = useState<string | null>(null);
  const [barcodeData, setBarcodeData] = useState<{ invoiceNo: string; qrDataUrl: string; code128DataUrl: string; pdfUrl: string; barcodeText: string } | null>(null);
  const [loadingBarcode, setLoadingBarcode] = useState(false);
  const [barcodeModalItems, setBarcodeModalItems] = useState<SaleItem[]>([]);
  const [productBarcodeSearch, setProductBarcodeSearch] = useState('');
  const [generatingProductBarcode, setGeneratingProductBarcode] = useState(false);
  const [activeBarcodeTab, setActiveBarcodeTab] = useState<'invoice' | 'products'>('invoice');

  const handleOpenBarcode = async (invoiceNo: string, invoiceId?: number, existingItems?: SaleItem[]) => {
    setBarcodeModalInvoice(invoiceNo);
    setLoadingBarcode(true);
    setBarcodeData(null);
    setBarcodeModalItems(existingItems || []);
    setProductBarcodeSearch('');
    setActiveBarcodeTab('invoice');

    try {
      const res = await api.generateSaleInvoiceBarcode(invoiceNo);
      if (res.success) {
        setBarcodeData(res as any);
      } else {
        toastEvent.trigger('Failed to generate invoice barcode', 'error');
      }

      if ((!existingItems || existingItems.length === 0) && invoiceId) {
        const full = await api.getSale(invoiceId);
        if (full && full.items) {
          setBarcodeModalItems(full.items);
        }
      }
    } catch (err) {
      console.error('Barcode load error:', err);
      toastEvent.trigger('Failed to load invoice barcode', 'error');
    } finally {
      setLoadingBarcode(false);
    }
  };

  const handleGenerateProductBarcodes = async (
    itemsToGenerate: Array<{ medicine_name?: string; name?: string; batch_number?: string; batch?: string }>
  ) => {
    const payload = itemsToGenerate
      .filter(it => (it.medicine_name || it.name || '').trim().length > 0)
      .map(it => ({
        name: (it.medicine_name || it.name || 'Medicine').trim(),
        batch: (it.batch_number || it.batch || 'N/A').trim(),
      }));

    if (payload.length === 0) {
      toastEvent.trigger('No valid items selected for product barcode generation', 'error');
      return;
    }

    setGeneratingProductBarcode(true);
    try {
      const res = await api.generateMedicineBarcodes(payload);
      if (res && res.pdfUrl) {
        toastEvent.trigger(`Generated ${payload.length} product barcode label(s)`, 'success');
        window.open(res.pdfUrl, '_blank');
      } else {
        toastEvent.trigger('Failed to generate product barcode label', 'error');
      }
    } catch (err) {
      console.error('Product barcode generation error:', err);
      toastEvent.trigger('Failed to generate product barcode label', 'error');
    } finally {
      setGeneratingProductBarcode(false);
    }
  };

  const isDateFilterExcludingToday = !!(
    (dateRangeHelper.dateRange.from && dateRangeHelper.dateRange.from > todayStr) ||
    (dateRangeHelper.dateRange.to && dateRangeHelper.dateRange.to < todayStr)
  );

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const monthStr = monthNames[monthIdx] || parts[1];
      return `${parseInt(parts[2], 10)} ${monthStr}`;
    }
    return dateStr;
  };

  const getDateRangeLabel = () => {
    const from = dateRangeHelper.dateRange.from;
    const to = dateRangeHelper.dateRange.to;
    if (!from && !to) return 'All Dates';
    if (from === todayStr && to === todayStr) return 'Today';
    if (from && to && from === to) return formatShortDate(from);
    if (from && to) return `${formatShortDate(from)} - ${formatShortDate(to)}`;
    if (from) return `From ${formatShortDate(from)}`;
    if (to) return `Until ${formatShortDate(to)}`;
    return 'All Dates';
  };

  const handleOpenEnrichment = async (item: SaleItem) => {
    if (!item.medicine_id) {
      toastEvent.trigger('Medicine profile not available', 'error');
      return;
    }
    setSelectedEnrichedItem({ medicine_name: item.medicine_name || 'Unknown', batch: item.batch_number });
    setPanelOpen(true);
    setDetailsLoading(true);
    try {
      const data = await api.getEnrichedMedicine(item.medicine_id);
      setEnrichedData(data);
    } catch (err) {
      console.error('Failed to load enriched details:', err);
      toastEvent.trigger('Failed to load medical profile', 'error');
      setPanelOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Client-side instant filter function for invoices.
  // Amount range and Pay Via are enforced server-side (serverFilters below) so they apply to the
  // full dataset rather than only whatever page(s) have loaded into memory so far.
  const clientFilterFn = useCallback((inv: SaleInvoice) => {
    if (colFilterNo && !(inv.invoice_no || '').toLowerCase().includes(colFilterNo.toLowerCase())) {
      return false;
    }
    if (colFilterName) {
      const searchLower = colFilterName.toLowerCase();
      const nameMatch = (inv.customer_name || 'Walk-in').toLowerCase().includes(searchLower);
      const phoneMatch = (inv.customer_phone || '').includes(colFilterName);
      const medicineMatch = inv.items?.some(it =>
        (it.medicine_name || '').toLowerCase().includes(searchLower) ||
        (it.batch_number || '').toLowerCase().includes(searchLower)
      );
      if (!nameMatch && !phoneMatch && !medicineMatch) return false;
    }
    if (colFilterDrName && !((inv.doctor_name || '').toLowerCase().includes(colFilterDrName.toLowerCase()))) {
      return false;
    }

    return true;
  }, [colFilterNo, colFilterName, colFilterDrName]);

  // Infinite Scroll hook setup
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
  } = useInfiniteScroll<SaleInvoice>({
    queryKey: 'sells-list',
    cacheKey: 'sells-invoices-cache',
    serverFilters: {
      date_from: dateRangeHelper.dateRange.from,
      date_to: dateRangeHelper.dateRange.to,
      search: (colFilterNo || colFilterName || colFilterDrName || '').trim(),
      min_amount: colFilterMinAmount,
      max_amount: colFilterMaxAmount,
      payment_medium: colFilterPayVia,
    },
    clientFilterFn,
    fetchPage: async (pageParam, filters) => {
      const res = await api.listSales({
        page: pageParam - 1,
        limit: 100,
        date_from: filters.date_from,
        date_to: filters.date_to,
        search: filters.search,
        min_amount: filters.min_amount ? Number(filters.min_amount) : undefined,
        max_amount: filters.max_amount ? Number(filters.max_amount) : undefined,
        payment_medium: filters.payment_medium || undefined,
      });
      const data = Array.isArray(res) ? res : (res?.invoices || res?.data || []);
      const totalItems = res?.meta?.total || data.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / 100));
      return {
        data,
        totalItems,
        totalPages,
      };
    },
  });

  const loading = isFetching && items.length === 0;

  const fetchInvoices = useCallback((silent = false) => {
    refetch();
  }, [refetch]);

  // Auto refetch when module cache cleared or date range changes
  useEffect(() => {
    const handleClear = () => {
      refetch();
    };
    window.addEventListener('clear-module-cache', handleClear);
    window.addEventListener('app-show-toast', handleClear);
    return () => {
      window.removeEventListener('clear-module-cache', handleClear);
      window.removeEventListener('app-show-toast', handleClear);
    };
  }, [refetch]);

  useEffect(() => {
    refetch();
  }, [dateRangeHelper.dateRange.from, dateRangeHelper.dateRange.to, refetch]);

  const openView = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(full);
      handleOpenBarcode(full.invoice_no, full.id, full.items);
    } catch (err) {
      toastEvent.trigger('Failed to load invoice details', 'error');
    }
  };

  const openEdit = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(null);
      setEditInvoice(null);
      navigate('/pos', { state: { editSale: full } });
    } catch (err) {
      toastEvent.trigger('Failed to load invoice for editing in POS', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editInvoice) return;
    setSaving(true);
    try {
      await api.updateSale(editInvoice.id, {
        items: editItems.map(item => ({
          inventory_id: item.inventory_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          loose_qty: item.loose_qty || 0,
          discount_per: item.discount_per || 0,
        })),
        patient_name: editCustomerName,
        patient_phone: editCustomerPhone,
        discount: editDiscount,
        paymentMedium: editPaymentMedium,
      });
      toastEvent.trigger('Invoice updated successfully', 'success');
      setEditInvoice(null);
      fetchInvoices(true);
      
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh the shared inventory cache so POS search reflects the adjusted stock
      api.getCompactInventory().catch(() => {});
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error || 'Failed to update invoice';
      toastEvent.trigger(serverMsg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteSale(id);
      toastEvent.trigger('Invoice deleted, stock restored', 'success');
      setDeleteConfirm(null);
      if (viewInvoice?.id === id) {
        setViewInvoice(null);
      }
      fetchInvoices(true);
      
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh the shared inventory cache so POS search reflects the restored stock
      api.getCompactInventory().catch(() => {});
    } catch (err) {
      toastEvent.trigger('Failed to delete invoice', 'error');
    }
  };

  const updateItemQty = (index: number, qty: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(0, qty) } : item));
  };

  const updateItemPrice = (index: number, price: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, unit_price: price } : item));
  };

  const updateItemLooseQty = (index: number, looseQty: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, loose_qty: Math.max(0, looseQty) } : item));
  };

  const updateItemMrp = (index: number, mrp: number) => {
    const newItems = [...editItems];
    newItems[index].mrp = mrp;
    setEditItems(newItems);
  };

  const updateItemDiscountPer = (index: number, discPer: number) => {
    const newItems = [...editItems];
    newItems[index].discount_per = Math.min(100, Math.max(0, discPer));
    setEditItems(newItems);
  };

  const removeItem = (index: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== index));
  };

  const formatDate = (d: string) => {
    return formatDisplayDate(d, true);
  };

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  return (
    <div className="h-full flex flex-col px-4 py-4 animate-in fade-in duration-500 gap-3 relative">
      
      {/* Streamlined Compact Date Filter Bar */}
      <div className="bg-bg2/80 border border-glass-border rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-sm text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-primary font-bold text-xs shrink-0">
            <Calendar size={14} />
            <span>Period:</span>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center gap-1 bg-bg3 p-0.5 rounded-lg border border-glass-border/40 shrink-0">
            {[
              {
                label: '30 Days',
                key: '30d',
                action: () => dateRangeHelper.setPreset(30),
                active: dateRangeHelper.dateRange.from === thirtyDaysAgoStr && dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'Today',
                key: 'today',
                action: () => dateRangeHelper.setDateRange({ from: todayStr, to: todayStr }),
                active: dateRangeHelper.dateRange.from === todayStr && dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'Yesterday',
                key: 'yesterday',
                action: () => {
                  const y = getNDaysAgoString(1);
                  dateRangeHelper.setDateRange({ from: y, to: y });
                },
                active: dateRangeHelper.dateRange.from === getNDaysAgoString(1) && dateRangeHelper.dateRange.to === getNDaysAgoString(1),
              },
              {
                label: 'This Month',
                key: 'month',
                action: () => {
                  const now = new Date();
                  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                  dateRangeHelper.setDateRange({ from: firstDay, to: todayStr });
                },
                active: dateRangeHelper.dateRange.from === new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) && dateRangeHelper.dateRange.to === todayStr,
              },
              {
                label: 'All Time',
                key: 'all',
                action: () => dateRangeHelper.clearFilters(),
                active: !dateRangeHelper.dateRange.from && !dateRangeHelper.dateRange.to,
              },
            ].map(p => (
              <button
                key={p.key}
                type="button"
                onClick={p.action}
                className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer ${
                  p.active
                    ? 'bg-primary text-white font-bold shadow-sm'
                    : 'text-muted hover:text-text hover:bg-bg2'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom Date Inputs */}
          <div className="flex items-center gap-1.5 bg-bg3 px-2 py-1 rounded-lg border border-glass-border/40 shrink-0 text-xs">
            <span className="text-[10px] font-bold text-muted uppercase">FROM:</span>
            <input
              type="date"
              value={toDateInputValue(dateRangeHelper.dateRange.from)}
              onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
              className="bg-transparent border-none text-xs text-text focus:outline-none cursor-pointer"
            />
            <span className="text-[10px] font-bold text-muted uppercase">TO:</span>
            <input
              type="date"
              value={toDateInputValue(dateRangeHelper.dateRange.to)}
              onChange={e => dateRangeHelper.handleToChange(e.target.value)}
              className="bg-transparent border-none text-xs text-text focus:outline-none cursor-pointer"
            />
            {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
              <button
                type="button"
                onClick={() => dateRangeHelper.clearFilters()}
                className="p-0.5 text-muted hover:text-red transition-colors rounded cursor-pointer"
                title="Reset date filter (All Time)"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          {/* Reset All Filters Button */}
          {(colFilterNo || colFilterName || colFilterDrName || colFilterMinAmount || colFilterMaxAmount || colFilterPayVia || dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
            <button
              type="button"
              onClick={() => {
                setColFilterNo('');
                setColFilterName('');
                setColFilterDrName('');
                setColFilterMinAmount('');
                setColFilterMaxAmount('');
                setColFilterPayVia('');
                dateRangeHelper.clearFilters();
              }}
              className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
              title="Reset all search filters and date ranges"
            >
              <RotateCcw size={13} />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>

        {/* Live Filter Summary Count */}
        <div className="flex items-center gap-2 text-xs shrink-0 ml-auto">
          <span className="bg-bg3 px-2.5 py-1 rounded-lg border border-glass-border/50 font-mono text-[11px] text-muted">
            {items.length !== totalItems ? (
              <>Filtered: <strong className="text-text font-bold">{items.length}</strong> / <strong className="text-text font-bold">{totalItems}</strong> total</>
            ) : (
              <>Invoices: <strong className="text-text font-bold">{totalItems}</strong></>
            )} ({getDateRangeLabel()})
          </span>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-bg2/60 backdrop-blur-lg rounded-xl p-0 border border-glass-border flex-1 flex flex-col overflow-hidden min-h-0">
        
        <InfiniteTable
          totalSize={rowVirtualizer.getTotalSize()}
          containerRef={parentRef}
          header={
            <tr className="flex items-center w-full bg-bg3/95 border-b border-glass-border/40 select-none py-2 text-xs">
              {/* No. */}
              <th className="px-2 py-1 w-32 shrink-0 flex items-center justify-start">
                <input
                  type="text"
                  placeholder="Search No..."
                  value={colFilterNo}
                  onChange={e => setColFilterNo(e.target.value)}
                  className="w-full px-2 py-1 bg-bg2/90 border border-glass-border rounded-md text-xs text-text font-normal placeholder:text-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </th>

              {/* Name of the patient */}
              <th className="px-2 py-1 flex-1 min-w-[240px] flex items-center justify-start">
                <input
                  type="text"
                  placeholder="Search patient/phone/medicine..."
                  value={colFilterName}
                  onChange={e => setColFilterName(e.target.value)}
                  className="w-full px-2 py-1 bg-bg2/90 border border-glass-border rounded-md text-xs text-text font-normal placeholder:text-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </th>

              {/* Date */}
              <th className="px-2 py-1 w-36 shrink-0 flex items-center justify-center text-center">
                <div className="w-full py-1 bg-bg2/50 border border-glass-border/40 rounded-md text-[10px] font-semibold text-muted truncate text-center" title="Filtered Date Period">
                  {getDateRangeLabel()}
                </div>
              </th>

              {/* Dr Name */}
              <th className="px-2 py-1 w-36 shrink-0 flex items-center justify-start">
                <input
                  type="text"
                  placeholder="Search doctor..."
                  value={colFilterDrName}
                  onChange={e => setColFilterDrName(e.target.value)}
                  className="w-full px-2 py-1 bg-bg2/90 border border-glass-border rounded-md text-xs text-text font-normal placeholder:text-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </th>

              {/* Bill Amount */}
              <th className="px-1.5 py-1 w-28 shrink-0 flex items-center justify-end text-right">
                <div className="flex gap-1 w-full">
                  <input
                    type="number"
                    placeholder="Min ₹"
                    value={colFilterMinAmount}
                    onChange={e => setColFilterMinAmount(e.target.value)}
                    className="w-1/2 px-1 py-1 bg-bg2/90 border border-glass-border rounded-md text-[11px] text-text font-normal placeholder:text-muted/50 focus:outline-none focus:border-primary/50 text-right"
                  />
                  <input
                    type="number"
                    placeholder="Max ₹"
                    value={colFilterMaxAmount}
                    onChange={e => setColFilterMaxAmount(e.target.value)}
                    className="w-1/2 px-1 py-1 bg-bg2/90 border border-glass-border rounded-md text-[11px] text-text font-normal placeholder:text-muted/50 focus:outline-none focus:border-primary/50 text-right"
                  />
                </div>
              </th>

              {/* Final Amount */}
              <th className="px-2 py-1 w-28 shrink-0 flex items-center justify-end text-right">
                <span className="text-xs font-semibold text-muted/60 px-1">Final Amt</span>
              </th>

              {/* Discount */}
              <th className="px-2 py-1 w-24 shrink-0 flex items-center justify-end text-right">
                <span className="text-xs font-semibold text-muted/60 px-1">Discount</span>
              </th>

              {/* Pay Via */}
              <th className="px-1.5 py-1 w-24 shrink-0 flex items-center justify-center text-center">
                <select
                  value={colFilterPayVia}
                  onChange={e => setColFilterPayVia(e.target.value)}
                  className="w-full px-1 py-1 bg-bg2/90 border border-glass-border rounded-md text-xs text-text font-normal focus:outline-none focus:border-primary/50"
                >
                  <option value="">Pay: All</option>
                  <option value="CASH">CASH</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">CARD</option>
                  <option value="CREDIT">CREDIT</option>
                </select>
              </th>

              {/* Actions */}
              <th className="px-2 py-1 w-32 shrink-0 flex items-center justify-center text-center">
                {(colFilterNo || colFilterName || colFilterDrName || colFilterMinAmount || colFilterMaxAmount || colFilterPayVia) ? (
                  <button
                    onClick={() => {
                      setColFilterNo('');
                      setColFilterName('');
                      setColFilterDrName('');
                      setColFilterMinAmount('');
                      setColFilterMaxAmount('');
                      setColFilterPayVia('');
                    }}
                    className="text-[11px] text-red hover:underline font-bold py-0.5 cursor-pointer"
                  >
                    Clear Filters
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-muted/60">Actions</span>
                )}
              </th>
            </tr>
          }
          body={
            items.length === 0 ? (
              <tr className="flex items-center justify-center p-8 text-muted text-sm w-full absolute top-0 left-0">
                <td>No invoices found.</td>
              </tr>
            ) : (
              rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const inv = items[virtualRow.index];
                if (!inv) return null;
                return (
                  <VirtualRow
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    start={virtualRow.start}
                    size={virtualRow.size}
                    onClick={() => openView(inv)}
                  >
                    <td className="px-4 py-3.5 w-32 shrink-0 flex items-center justify-start relative">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary to-purple-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center"></div>
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20 shadow-sm">{inv.invoice_no}</span>
                    </td>
                    <td className="px-4 py-3.5 flex-1 min-w-[240px] flex items-center">
                      <div className="flex items-center gap-3 w-full">
                        <div className="bg-bg3 p-2 rounded-full border border-glass-border shadow-sm group-hover:bg-primary/10 group-hover:shadow-md transition-all shrink-0">
                          <User size={14} className="text-muted group-hover:text-primary transition-colors" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-text group-hover:text-primary transition-colors truncate">{inv.customer_name || 'Walk-in'}</div>
                          {inv.customer_phone && <div className="text-[10px] text-muted font-medium mt-0.5 font-mono">{inv.customer_phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 w-36 shrink-0 text-xs text-muted flex items-center justify-center">
                      {formatDate(inv.date)}
                    </td>
                    <td className="px-4 py-3.5 w-36 shrink-0 text-xs text-muted truncate flex items-center justify-start">
                      {inv.doctor_name || '-'}
                    </td>
                    <td className="px-3 py-3.5 w-28 shrink-0 flex items-center justify-end text-right">
                      <span className="text-xs font-bold text-text">₹{Math.round(Number(inv.subtotal || 0))}</span>
                    </td>
                    <td className="px-3 py-3.5 w-28 shrink-0 flex items-center justify-end text-right">
                      <span className="text-xs font-bold text-green">₹{Math.round(Number(inv.total_amount || 0))}</span>
                    </td>
                    <td className="px-3 py-3.5 w-24 shrink-0 text-xs text-muted flex items-center justify-end text-right">
                      ₹{Math.round(Number(inv.discount || 0))}
                    </td>
                    <td className="px-3 py-3.5 w-24 shrink-0 flex items-center justify-center">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-bg3 text-muted border border-glass-border">
                        {inv.payment_medium || 'CASH'}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 w-32 shrink-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        {deleteConfirm === inv.id ? (
                          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-red/10 border border-red/20 w-full justify-center">
                            <button
                              onClick={() => handleDelete(inv.id)}
                              className="px-2 py-1 bg-red text-white rounded-md text-[9px] font-bold hover:bg-red/80 shadow-md transform hover:scale-105 transition-all"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 bg-white/10 text-text rounded-md text-[9px] font-bold hover:bg-white/20 shadow-sm transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => openView(inv)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-sky-500 hover:text-white border border-glass-border hover:border-sky-500 shadow-sm hover:shadow-[0_0_15px_rgba(14,165,233,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
                              title="View invoice details"
                            >
                              <FileText size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBarcode(inv.invoice_no, inv.id, inv.items);
                              }}
                              className="p-2 rounded-lg bg-bg2 hover:bg-purple-500 hover:text-white border border-glass-border hover:border-purple-500 shadow-sm hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
                              title="View & Print Barcodes (Return Invoice & Product Labels)"
                            >
                              <QrCode size={14} />
                            </button>
                            <button
                              onClick={() => openEdit(inv)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-primary hover:text-white border border-glass-border hover:border-primary shadow-sm hover:shadow-primary/30 text-muted transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
                              title="Edit bill in POS"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(inv.id)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-red hover:text-white border border-glass-border hover:border-red shadow-sm hover:shadow-[0_0_15px_rgba(220,38,38,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95"
                              title="Delete invoice"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </VirtualRow>
                );
              })
            )
          }
          footer={
            <InfiniteScrollStatus
              totalItems={totalItems}
              loadedCount={items.length}
              isFetching={isFetching}
              isFetchingNextPage={isFetchingNextPage}
              hasNextPage={hasNextPage}
              onLoadMore={fetchNextPage}
              sentinelRef={sentinelRef}
              itemName="invoices"
            />
          }
        />
      </div>

      {/* Edit Modal */}
      {editInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] overflow-y-auto border-primary/20">
            {/* Modal Header */}
            <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5 sticky top-0 z-10">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Edit3 size={18} className="text-primary" />
                  Edit Invoice: {editInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-1">Modify items, customer, or payment details</p>
              </div>
              <button
                onClick={() => setEditInvoice(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5">
              {/* Customer Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Customer Name</label>
                  <input
                    type="text"
                    value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                    placeholder="Customer name..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                    placeholder="Phone number..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Payment Method</label>
                  <select
                    value={editPaymentMedium}
                    onChange={e => setEditPaymentMedium(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-muted uppercase tracking-wider">Invoice Items</h4>
                  <span className="text-xs text-muted">{editItems.length} item{editItems.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="overflow-x-auto border border-glass-border rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Medicine</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Batch</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Expiry</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">Strips</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">Loose</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">CD %</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">MRP</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Unit Price</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Subtotal</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.map((item, idx) => {
                        const packSize = item.pack_size || 10;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={item.id} className="hover:bg-white/5">
                            <td className="p-3 border-b border-glass-border/50 text-sm font-semibold">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleOpenEnrichment(item)}
                                  className="text-primary hover:text-sky-400 p-1 bg-primary/10 rounded-lg transition-colors border border-primary/20 shadow-sm"
                                  title="View Medical Profile"
                                >
                                  <BookOpen size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (item.medicine_id) {
                                      setUniversalEditItem({
                                        name: item.medicine_name,
                                        mrp: item.mrp,
                                        pack_size: item.pack_size,
                                        batch_no: (item as any).batch_no || (item as any).batch || '',
                                        quantity: (item as any).qty || item.quantity || 1
                                      });
                                      setUniversalEditMedicineId(item.medicine_id);
                                    }
                                  }}
                                  disabled={!item.medicine_id}
                                  className={`p-1 rounded-lg transition-all border shadow-sm ${item.medicine_id ? 'bg-sky/10 border-sky/20 text-sky hover:text-white hover:bg-sky' : 'opacity-30 cursor-not-allowed border-glass-border text-muted bg-white/5'}`}
                                  title="Quick Edit Medicine"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <span>{item.medicine_name || `Item #${item.inventory_id}`}</span>
                              </div>
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded">{item.batch_number || '-'}</span>
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-[11px] text-muted">{item.expiry_date || '-'}</td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.quantity !== undefined && item.quantity !== null ? item.quantity : 0}
                                onChange={e => updateItemQty(idx, e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10)))}
                                className="w-16 px-2 py-1 bg-black/20 border border-glass-border rounded text-sm text-text text-center focus:outline-none focus:border-primary/50"
                                min={0}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={looseQty !== undefined && looseQty !== null ? looseQty : 0}
                                onChange={e => updateItemLooseQty(idx, e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10)))}
                                className="w-16 px-2 py-1 bg-amber/10 border border-amber/30 rounded text-sm text-amber text-center focus:outline-none focus:border-amber/50"
                                min={0}
                                max={packSize - 1}
                                title={`Loose units (max ${packSize - 1} per strip)`}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center">
                              <input
                                type="number"
                                value={item.discount_per || ''}
                                onChange={e => updateItemDiscountPer(idx, parseFloat(e.target.value) || 0)}
                                className="w-16 px-2 py-1 bg-sky/10 border border-sky/30 rounded text-sm text-sky text-center focus:outline-none focus:border-sky/50"
                                min={0}
                                max={100}
                                placeholder="%"
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.mrp || 0}
                                onChange={e => updateItemMrp(idx, parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 bg-purple/10 border border-purple/30 rounded text-sm text-purple text-right focus:outline-none focus:border-purple/50"
                                min={0}
                                step={0.01}
                                title="MRP (Maximum Retail Price)"
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.unit_price}
                                onChange={e => updateItemPrice(idx, parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 bg-black/20 border border-glass-border rounded text-sm text-text text-right focus:outline-none focus:border-primary/50"
                                min={0}
                                step={0.01}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-bold text-green text-right">
                              ₹{Math.round(itemTotal)}
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <button
                                onClick={() => removeItem(idx)}
                                className="p-1 rounded hover:bg-red/20 text-muted hover:text-red transition-all"
                                title="Remove item"
                              >
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-white/5">
                        <td colSpan={6} className="p-3 text-sm font-bold text-muted text-right">Subtotal:</td>
                        <td className="p-3 text-sm font-bold text-green text-right">
                          ₹{Math.round(editItems.reduce((sum, item) => {
                            const pSize = item.pack_size || 10;
                            const q = item.quantity || 0;
                            const l = item.loose_qty || 0;
                            const d = item.discount_per || 0;
                            const dPrice = item.unit_price * (1 - d / 100);
                            return sum + (q * dPrice) + (l * (dPrice / pSize));
                          }, 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Discount */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Discount (₹)</label>
                <input
                  type="number"
                  value={editDiscount}
                  onChange={e => setEditDiscount(parseFloat(e.target.value) || 0)}
                  className="w-24 px-3 py-1.5 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                  min={0}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-glass-border flex justify-between items-center bg-white/5 sticky bottom-0">
              <button
                onClick={() => setEditInvoice(null)}
                className="px-4 py-2 bg-white/10 text-muted rounded-lg text-sm font-semibold hover:bg-white/20 transition-all"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-muted">Total</div>
                  <div className="text-lg font-extrabold text-green">
                    ₹{Math.round(editItems.reduce((sum, item) => {
                      const pSize = item.pack_size || 10;
                      const q = item.quantity || 0;
                      const l = item.loose_qty || 0;
                      const d = item.discount_per || 0;
                      const dPrice = item.unit_price * (1 - d / 100);
                      return sum + (q * dPrice) + (l * (dPrice / pSize));
                    }, 0) - editDiscount)}
                  </div>
                </div>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/80 disabled:opacity-50 transition-all"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* View Modal */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] flex flex-col border-sky-500/20">
            {/* Modal Header */}
            <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5 shrink-0">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <FileText size={18} className="text-sky-500" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-1">Read-only view of the invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5 flex-1 overflow-y-auto">
              {/* Customer Info */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-bg2/50 p-4 rounded-xl border border-glass-border">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Customer Name</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Phone</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Doctor Name</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.doctor_name || 'Self / Direct'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Payment Method</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.payment_medium || 'CASH'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Date</div>
                  <div className="text-sm font-semibold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Scannable Barcode Section */}
              {barcodeData && barcodeData.invoiceNo === viewInvoice.invoice_no ? (
                <div className="bg-bg2/60 p-4 rounded-xl border border-glass-border flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img src={barcodeData.qrDataUrl} alt="Invoice QR" className="w-16 h-16 rounded bg-bg p-1 shrink-0 shadow-sm" />
                    <div>
                      <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <QrCode size={12} className="text-purple-400" /> Scannable Return Barcode (Code128 + QR)
                      </div>
                      <img src={barcodeData.code128DataUrl} alt="Invoice Code128" className="h-10 bg-bg p-1 rounded max-w-[220px]" />
                      <div className="text-[10px] font-mono text-muted mt-1">{barcodeData.barcodeText}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => window.open(barcodeData.pdfUrl, '_blank')}
                    className="px-3.5 py-2 bg-primary/20 hover:bg-primary text-primary hover:text-text rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border border-primary/30 shrink-0 cursor-pointer"
                  >
                    <Printer size={14} /> Print Barcode Label
                  </button>
                </div>
              ) : loadingBarcode ? (
                <div className="p-3 text-center text-xs text-muted bg-bg2/30 rounded-xl border border-glass-border">
                  Loading scannable invoice barcode...
                </div>
              ) : null}

              {/* Items Table */}
              <div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-muted uppercase tracking-wider">Invoice Items</h4>
                    <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item{(viewInvoice.items?.length || 0) !== 1 ? 's' : ''}</span>
                  </div>
                  {viewInvoice.items && viewInvoice.items.length > 0 && (
                    <button
                      onClick={() => handleGenerateProductBarcodes(viewInvoice.items || [])}
                      disabled={generatingProductBarcode}
                      className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-600 text-purple-300 hover:text-text rounded-lg text-xs font-bold border border-purple-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Generate product barcode labels for all items in this bill (for missing/torn box barcodes)"
                    >
                      <QrCode size={13} /> Print All Product Barcodes
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto border border-glass-border rounded-lg bg-bg2/40">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Medicine</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Batch</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Expiry</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">Qty (Strips/Loose)</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">CD %</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">MRP</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Unit Price</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Subtotal</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">Barcode Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewInvoice.items?.map((item, idx) => {
                        const packSize = item.pack_size || 10;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-bg3/50">
                            <td className="p-3 border-b border-glass-border/50 text-sm font-semibold">
                              {item.medicine_name || `Item #${item.inventory_id}`}
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <span className="text-[10px] font-mono bg-bg3 px-2 py-0.5 rounded text-text">{item.batch_number || '-'}</span>
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-xs font-mono text-muted">
                              {item.expiry_date ? formatDate(item.expiry_date) : '-'}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center text-sm">
                              {item.quantity} / {looseQty}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center text-sm">
                              {discPer}%
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm text-muted">
                              ₹{item.mrp || 0}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-medium">
                              ₹{discountedPrice.toFixed(2)}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-bold text-green">
                              ₹{Math.round(itemTotal)}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center">
                              <button
                                onClick={() => handleGenerateProductBarcodes([{ medicine_name: item.medicine_name || `Item #${item.inventory_id}`, batch_number: item.batch_number || 'N/A' }])}
                                disabled={generatingProductBarcode}
                                className="px-2 py-1 bg-purple-500/10 hover:bg-purple-600 text-purple-400 hover:text-text rounded-md text-[11px] font-bold border border-purple-500/30 transition-all flex items-center gap-1 mx-auto cursor-pointer disabled:opacity-50"
                                title="Generate product barcode label for missing/torn box barcode"
                              >
                                <QrCode size={11} /> Print Label
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(!viewInvoice.items || viewInvoice.items.length === 0) && (
                        <tr>
                          <td colSpan={9} className="p-8 text-center text-muted">No items found in this invoice</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discount & Tax Info */}
              <div className="flex justify-end pt-2 mt-6">
                <div className="w-72 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Subtotal:</span>
                    <span className="font-semibold">₹{Math.round(viewInvoice.subtotal || 0)}</span>
                  </div>
                  {(viewInvoice.discount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Discount:</span>
                      <span className="font-semibold text-amber-500">-₹{Math.round(viewInvoice.discount || 0)}</span>
                    </div>
                  )}
                  {(viewInvoice.tax_amount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Tax (GST):</span>
                      <span className="font-semibold text-sky-400">₹{Number(viewInvoice.tax_amount).toFixed(2)}</span>
                    </div>
                  )}
                  {viewInvoice.roff !== undefined && viewInvoice.roff !== null && viewInvoice.roff !== 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Round Off:</span>
                      <span className="font-semibold text-muted">
                        {viewInvoice.roff > 0 ? `+₹${viewInvoice.roff.toFixed(2)}` : `-₹${Math.abs(viewInvoice.roff).toFixed(2)}`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-glass-border/50">
                    <span className="text-text">Grand Total:</span>
                    <span className="text-green text-xl">₹{Math.round(viewInvoice.total_amount || 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-glass-border flex justify-between items-center bg-bg2/80 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-bg3 hover:bg-glass-border text-muted hover:text-text border border-glass-border rounded-lg text-sm font-semibold transition-all cursor-pointer"
              >
                Close Preview
              </button>

              <div className="flex items-center gap-3">
                {deleteConfirm === viewInvoice.id ? (
                  <div className="flex items-center gap-2 p-1 rounded-lg bg-red-500/10 border border-red-500/30">
                    <span className="text-xs text-red font-semibold px-2">Delete this bill?</span>
                    <button
                      onClick={() => handleDelete(viewInvoice.id)}
                      className="px-3 py-1.5 bg-red hover:bg-red/80 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer"
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1.5 bg-bg3 text-text rounded-lg text-xs font-bold hover:bg-glass-border transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(viewInvoice.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red text-red hover:text-white border border-red-500/30 rounded-lg text-sm font-bold transition-all cursor-pointer"
                    title="Delete invoice and restore inventory stock"
                  >
                    <Trash2 size={15} />
                    Delete Invoice
                  </button>
                )}

                <button
                  onClick={() => openEdit(viewInvoice)}
                  className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-bold transition-all cursor-pointer"
                >
                  <Edit3 size={15} />
                  Edit Invoice
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Sliding Details Drawer for OpenFDA Enrichment */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-full max-w-[450px] bg-[#121214]/95 backdrop-blur-xl border-l border-glass-border shadow-[-8px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-in-out z-drawer flex flex-col ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedEnrichedItem && (
          <>
            {/* Header */}
            <div className="p-6 border-b border-glass-border flex justify-between items-center bg-white/5">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-purple-400 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                  Medical Profile
                </span>
                <h4 className="text-xl font-bold mt-1 text-white">{selectedEnrichedItem.medicine_name}</h4>
              </div>
              <button 
                onClick={() => setPanelOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-muted hover:text-white transition-colors"
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
                      <span className="flex items-center gap-1">
                        <Factory size={12} /> Mfg: {enrichedData.manufacturer || 'Unknown'}
                      </span>
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
          initialData={universalEditItem}
          onClose={() => {
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
          }} 
          onSave={() => {
            // Refetch to reflect any potential naming changes if needed
            fetchInvoices(true);
          }} 
        />
      )}

      {/* Standalone Barcode Modal Portal */}
      {barcodeModalInvoice && !viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-lg p-6 border-purple-500/30 flex flex-col items-center space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-full flex justify-between items-center border-b border-glass-border pb-3">
              <h3 className="font-bold text-base flex items-center gap-2 text-text">
                <QrCode size={18} className="text-purple-400" />
                Barcode Generator: {barcodeModalInvoice}
              </h3>
              <button
                onClick={() => setBarcodeModalInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>
            {loadingBarcode ? (
              <div className="py-10 text-center text-sm text-muted flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin text-primary" />
                Generating return invoice barcode label...
              </div>
            ) : barcodeData ? (
              <div className="w-full flex flex-col items-center space-y-4 bg-bg2/80 p-5 rounded-xl border border-glass-border">
                <img src={barcodeData.qrDataUrl} alt="QR Code" className="w-32 h-32 bg-white p-2 rounded-lg shadow-md" />
                <div className="w-full text-center">
                  <div className="text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Code128 Barcode</div>
                  <img src={barcodeData.code128DataUrl} alt="Code128" className="h-14 bg-white p-2 rounded-lg w-full object-contain shadow-md" />
                  <div className="text-xs font-mono text-muted mt-2 font-bold">{barcodeData.barcodeText}</div>
                </div>

                <button
                  onClick={() => window.open(barcodeData.pdfUrl, '_blank')}
                  className="w-full py-2.5 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                >
                  <Printer size={16} /> Open & Print Return Invoice PDF Barcode Label
                </button>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted">Failed to generate barcode label.</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Floating Action Bar for Exporting Data */}
      <div className="fixed bottom-6 right-8 z-30 flex items-center gap-2 bg-bg2/95 backdrop-blur-md border border-glass-border p-1.5 rounded-full shadow-2xl transition-all">
        <button
          onClick={() => exportToCSV(items, exportColumns, 'sales_history.csv')}
          className="px-3.5 py-1.5 rounded-full bg-bg3 hover:bg-primary/20 text-text font-semibold hover:text-primary transition-all text-xs flex items-center gap-1.5 border border-glass-border cursor-pointer"
          title="Export to CSV"
        >
          <Download size={13} /> Export CSV
        </button>
        <button
          onClick={() => exportToPDF(items, exportColumns, 'sales_history.pdf', 'Sales History Report')}
          className="px-3.5 py-1.5 rounded-full bg-bg3 hover:bg-primary/20 text-text font-semibold hover:text-primary transition-all text-xs flex items-center gap-1.5 border border-glass-border cursor-pointer"
          title="Export to PDF"
        >
          <Download size={13} /> Export PDF
        </button>
      </div>

    </div>
  );
};

export default Sells;
