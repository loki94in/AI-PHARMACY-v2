import { useState, useEffect, useCallback, Fragment, useRef } from 'react';
import { Edit3, Trash2, X, User, FileText, Save, AlertTriangle, BookOpen, RefreshCw, ShieldAlert, Factory, Calendar, RotateCcw, Download } from 'lucide-react';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useQueryClient } from '@tanstack/react-query';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, getNDaysAgoString, formatDisplayDate } from '../../utils/date';
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
  const queryClient = useQueryClient();
  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'sells-date-range',
    defaultFrom: '',
    defaultTo: '',
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

  // Date Filter Popover state
  const [showDatePopover, setShowDatePopover] = useState(false);

  const todayStr = getTodayString();
  const isDateFilterExcludingToday = !!(
    (dateRangeHelper.dateRange.from && dateRangeHelper.dateRange.from > todayStr) ||
    (dateRangeHelper.dateRange.to && dateRangeHelper.dateRange.to < todayStr)
  );

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`; // e.g. "03/07"
    }
    return dateStr;
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

  // Client-side instant filter function for invoices
  const clientFilterFn = useCallback((inv: SaleInvoice) => {
    const total = Number(inv.total_amount) || 0;

    if (colFilterNo && !inv.invoice_no.toLowerCase().includes(colFilterNo.toLowerCase())) {
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
    
    const colMin = colFilterMinAmount ? Number(colFilterMinAmount) : 0;
    const colMax = colFilterMaxAmount ? Number(colFilterMaxAmount) : 100000000;
    if (total < colMin || total > colMax) return false;

    if (colFilterPayVia && inv.payment_medium !== colFilterPayVia) {
      return false;
    }

    return true;
  }, [colFilterNo, colFilterName, colFilterDrName, colFilterMinAmount, colFilterMaxAmount, colFilterPayVia]);

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
    },
    clientFilterFn,
    fetchPage: async (pageParam, filters) => {
      const res = await api.listSales({
        page: pageParam - 1,
        limit: 100,
        date_from: filters.date_from,
        date_to: filters.date_to,
        include_items: 'true',
      });
      const data = res.invoices || [];
      const totalItems = res.meta?.total || data.length;
      const totalPages = Math.ceil(totalItems / 100);
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

  const openView = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(full);
    } catch (err) {
      toastEvent.trigger('Failed to load invoice details', 'error');
    }
  };

  const openEdit = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(null);
      setEditInvoice(full);
      setEditItems(full.items || []);
      setEditCustomerName(full.customer_name || '');
      setEditCustomerPhone(full.customer_phone || '');
      setEditPaymentMedium(full.payment_medium || 'CASH');
      setEditDiscount(0);
    } catch (err) {
      toastEvent.trigger('Failed to load invoice details', 'error');
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
    <div className="h-full flex flex-col px-6 py-6 animate-in fade-in duration-500 gap-4">
      
      {/* Header with Export Buttons */}
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-xl font-bold text-text uppercase tracking-wider flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Sales History Ledger
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToCSV(items, exportColumns, 'sales_history.csv')}
            className="px-3 py-1.5 rounded-lg border border-glass-border bg-white/5 hover:bg-white/10 text-muted font-bold hover:text-text transition-all text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={() => exportToPDF(items, exportColumns, 'sales_history.pdf', 'Sales History Report')}
            className="px-3 py-1.5 rounded-lg border border-glass-border bg-white/5 hover:bg-white/10 text-muted font-bold hover:text-text transition-all text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Download size={13} /> Export PDF
          </button>
        </div>
      </div>

      {/* Date filter exclusion warning banner */}
      {isDateFilterExcludingToday && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs shrink-0 animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>
              Today's sales are hidden because your date filter is currently set to{' '}
              <strong className="text-amber-100">
                {dateRangeHelper.dateRange.from ? formatShortDate(dateRangeHelper.dateRange.from) : 'start'}
                {' to '}
                {dateRangeHelper.dateRange.to ? formatShortDate(dateRangeHelper.dateRange.to) : 'end'}
              </strong>.
            </span>
          </div>
          <button
            onClick={() => dateRangeHelper.clearFilters()}
            className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-bold transition-all cursor-pointer"
          >
            Show All Dates / Today
          </button>
        </div>
      )}

      {/* Invoices Table */}
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-0 border border-white/20 flex-1 flex flex-col overflow-hidden min-h-0">
        
        <InfiniteTable
          totalSize={rowVirtualizer.getTotalSize()}
          containerRef={parentRef}
          header={
            <>
              <tr className="flex items-center w-full bg-[#18181b]/95 select-none">
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-28 shrink-0">No.</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider flex-1 min-w-0">Name of the patient</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-44 shrink-0">Date</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-32 shrink-0">Dr Name</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0">Bill Amount</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0">Final Amount</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-20 shrink-0">Discount</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-20 shrink-0">Pay Via</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider w-32 shrink-0">Actions</th>
              </tr>
              <tr className="bg-bg2 border-b border-glass-border/30 flex items-center w-full select-none">
                <td className="p-2 w-28 shrink-0">
                  <input
                    type="text"
                    placeholder="Search No..."
                    value={colFilterNo}
                    onChange={e => setColFilterNo(e.target.value)}
                    className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </td>
                <td className="p-2 flex-1 min-w-0">
                  <input
                    type="text"
                    placeholder="Search patient/phone/medicine..."
                    value={colFilterName}
                    onChange={e => setColFilterName(e.target.value)}
                    className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </td>
                <td className="p-2 w-44 shrink-0 relative">
                  <button
                    onClick={() => setShowDatePopover(!showDatePopover)}
                    className="w-full flex items-center justify-between gap-1 px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs text-text hover:bg-white/5 transition-all text-left"
                  >
                    <div className="flex items-center gap-1 truncate text-muted">
                      <Calendar size={11} className="text-primary shrink-0" />
                      <span className="truncate text-[11px]">
                        {dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to
                          ? `${formatShortDate(dateRangeHelper.dateRange.from)} - ${formatShortDate(dateRangeHelper.dateRange.to)}`
                          : 'All Dates'}
                      </span>
                    </div>
                    {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dateRangeHelper.clearFilters();
                        }}
                        className="hover:text-red p-0.5 rounded"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </button>

                  {showDatePopover && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowDatePopover(false)} />
                      <div className="absolute top-full left-0 mt-1.5 z-50 w-72 glass-panel p-3 border border-glass-border shadow-2xl flex flex-col gap-3 text-xs bg-bg2 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex justify-between items-center pb-2 border-b border-glass-border/30">
                          <span className="font-bold text-text text-[11px]">Filter by Date</span>
                          <button
                            onClick={() => {
                              dateRangeHelper.clearFilters();
                              setShowDatePopover(false);
                            }}
                            className="text-[10px] text-muted hover:text-red transition-all flex items-center gap-1 font-bold"
                          >
                            <RotateCcw size={10} /> Reset
                          </button>
                        </div>

                        {/* Presets */}
                        <div className="flex flex-wrap items-center gap-1">
                          {[
                            { label: '7 Days', days: 7 },
                            { label: '30 Days', days: 30 },
                            { label: '90 Days', days: 90 },
                          ].map(p => (
                            <button
                              key={p.days}
                              type="button"
                              onClick={() => {
                                dateRangeHelper.setPreset(p.days);
                              }}
                              className="px-2 py-0.5 rounded bg-white/5 border border-glass-border/50 text-[10px] text-muted hover:text-text hover:bg-white/10"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted font-bold">FROM</span>
                            <input
                              type="date"
                              value={dateRangeHelper.dateRange.from}
                              onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
                              className="px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 w-full"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted font-bold">TO</span>
                            <input
                              type="date"
                              value={dateRangeHelper.dateRange.to}
                              onChange={e => dateRangeHelper.handleToChange(e.target.value)}
                              className="px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 w-full"
                            />
                          </div>
                        </div>
                        
                        <button
                          onClick={() => setShowDatePopover(false)}
                          className="w-full py-1 rounded bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all"
                        >
                          Apply Filter
                        </button>
                      </div>
                    </>
                  )}
                </td>
                <td className="p-2 w-32 shrink-0">
                  <input
                    type="text"
                    placeholder="Search doctor..."
                    value={colFilterDrName}
                    onChange={e => setColFilterDrName(e.target.value)}
                    className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </td>
                <td className="p-2 w-24 shrink-0 flex gap-1">
                  <input
                    type="number"
                    placeholder="Min"
                    value={colFilterMinAmount}
                    onChange={e => setColFilterMinAmount(e.target.value)}
                    className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={colFilterMaxAmount}
                    onChange={e => setColFilterMaxAmount(e.target.value)}
                    className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                  />
                </td>
                <td className="p-2 w-24 shrink-0"></td>
                <td className="p-2 w-20 shrink-0"></td>
                <td className="p-2 w-20 shrink-0">
                  <select
                    value={colFilterPayVia}
                    onChange={e => setColFilterPayVia(e.target.value)}
                    className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50"
                  >
                    <option value="">All</option>
                    <option value="CASH">CASH</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">CARD</option>
                    <option value="CREDIT">CREDIT</option>
                  </select>
                </td>
                <td className="p-2 w-32 shrink-0 text-center">
                  {(colFilterNo || colFilterName || colFilterDrName || colFilterMinAmount || colFilterMaxAmount || colFilterPayVia) && (
                    <button
                      onClick={() => {
                        setColFilterNo('');
                        setColFilterName('');
                        setColFilterDrName('');
                        setColFilterMinAmount('');
                        setColFilterMaxAmount('');
                        setColFilterPayVia('');
                      }}
                      className="text-xs text-red hover:underline font-bold"
                    >
                      Clear
                    </button>
                  )}
                </td>
              </tr>
            </>
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
                    <td className="p-4 w-28 shrink-0 relative">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary to-purple-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center"></div>
                      <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20 shadow-sm">{inv.invoice_no}</span>
                    </td>
                    <td className="p-4 flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="bg-white/5 p-2 rounded-full border border-glass-border shadow-sm group-hover:bg-white/10 group-hover:shadow-md transition-all shrink-0">
                          <User size={14} className="text-muted group-hover:text-primary transition-colors" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-text group-hover:text-primary transition-colors truncate">{inv.customer_name || 'Walk-in'}</div>
                          {inv.customer_phone && <div className="text-[10px] text-muted font-medium mt-0.5 font-mono">{inv.customer_phone}</div>}
                          {inv.items && inv.items.length > 0 && (
                            <div className="text-[11px] text-muted mt-1 truncate max-w-[300px] font-sans" title={inv.items.map(it => `${it.medicine_name} (${it.quantity} Str${it.loose_qty ? `, ${it.loose_qty} Tab` : ''})`).join(', ')}>
                              <span className="font-semibold text-primary/80">Items:</span> {inv.items.map(it => `${it.medicine_name} (${it.quantity} Str${it.loose_qty ? `, ${it.loose_qty} Tab` : ''})`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 w-44 shrink-0 text-sm text-muted">
                      {formatDate(inv.date)}
                    </td>
                    <td className="p-4 w-32 shrink-0 text-sm text-muted truncate">
                      {inv.doctor_name || '-'}
                    </td>
                    <td className="p-4 w-24 shrink-0">
                      <span className="text-sm font-bold text-text">₹{Math.round(Number(inv.subtotal || 0))}</span>
                    </td>
                    <td className="p-4 w-24 shrink-0">
                      <span className="text-sm font-bold text-green">₹{Math.round(Number(inv.total_amount || 0))}</span>
                    </td>
                    <td className="p-4 w-20 shrink-0 text-sm text-muted">
                      ₹{Math.round(Number(inv.discount || 0))}
                    </td>
                    <td className="p-4 w-20 shrink-0">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-muted">
                        {inv.payment_medium || 'CASH'}
                      </span>
                    </td>
                    <td className="p-4 w-32 shrink-0" onClick={e => e.stopPropagation()}>
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
                              className="p-2 rounded-lg bg-white/5 hover:bg-sky-500 hover:text-white border border-glass-border hover:border-sky-500 shadow-sm hover:shadow-[0_0_15px_rgba(14,165,233,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95"
                              title="View invoice"
                            >
                              <FileText size={14} />
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
                                    if (item.medicine_id) setUniversalEditMedicineId(item.medicine_id);
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
                                value={item.quantity}
                                onChange={e => updateItemQty(idx, parseInt(e.target.value) || 0)}
                                className="w-16 px-2 py-1 bg-black/20 border border-glass-border rounded text-sm text-text text-center focus:outline-none focus:border-primary/50"
                                min={0}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={looseQty}
                                onChange={e => updateItemLooseQty(idx, parseInt(e.target.value) || 0)}
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
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/5 p-4 rounded-xl border border-glass-border">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Customer Name</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Phone</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_phone || '-'}</div>
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

              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-muted uppercase tracking-wider">Invoice Items</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item{(viewInvoice.items?.length || 0) !== 1 ? 's' : ''}</span>
                </div>
                <div className="overflow-x-auto border border-glass-border rounded-lg bg-black/20">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Medicine</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Batch</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">Qty (Strips/Loose)</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">CD %</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">MRP</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Unit Price</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Subtotal</th>
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
                          <tr key={idx} className="hover:bg-white/5">
                            <td className="p-3 border-b border-glass-border/50 text-sm font-semibold">
                              {item.medicine_name || `Item #${item.inventory_id}`}
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded">{item.batch_number || '-'}</span>
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
                          </tr>
                        );
                      })}
                      {(!viewInvoice.items || viewInvoice.items.length === 0) && (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-muted">No items found in this invoice</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discount & Tax Info */}
              <div className="flex justify-end pt-2 mt-6">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Subtotal:</span>
                    <span className="font-semibold">₹{Math.round(viewInvoice.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Discount:</span>
                    <span className="font-semibold text-amber-500">-₹{Math.round(viewInvoice.discount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-glass-border/50">
                    <span className="text-text">Grand Total:</span>
                    <span className="text-green text-xl">₹{Math.round(viewInvoice.total_amount || 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-glass-border flex justify-between items-center bg-white/5 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-white/10 text-muted rounded-lg text-sm font-semibold hover:bg-white/20 transition-all"
              >
                Close Preview
              </button>
              <button
                onClick={() => openEdit(viewInvoice)}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/80 transition-all"
              >
                <Edit3 size={14} />
                Edit Invoice
              </button>
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
          onClose={() => setUniversalEditMedicineId(null)} 
          onSave={() => {
            // Refetch to reflect any potential naming changes if needed
            fetchInvoices(true);
          }} 
        />
      )}

    </div>
  );
};

export default Sells;
