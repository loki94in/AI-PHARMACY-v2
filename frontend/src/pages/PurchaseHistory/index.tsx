import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, apiClient } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Download, Eye, CheckCircle, AlertCircle, RefreshCw, Trash2, Edit, Calendar, Loader2, QrCode, Printer } from 'lucide-react';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { getTodayString, getNDaysAgoString, formatDisplayDate, toDateInputValue } from '../../utils/date';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { exportToCSV, exportToPDF } from '../../utils/export';
import { toastEvent } from '../../services/events';

interface LocalPurchaseItem {
  medicine_id?: number | null;
  medicine_name?: string | null;
  name?: string | null;
  batch_no?: string | null;
  batch_number?: string | null;
  batch?: string | null;
  expiry_date?: string | null;
  quantity?: number | null;
  free_qty?: number | null;
  cost_price?: number | string | null;
  mrp?: number | string | null;
  cgst_per?: number | null;
  sgst_per?: number | null;
  cd_per?: number | null;
  cd_value?: number | null;
}

interface LocalMatchedPurchase {
  id: number;
  invoice_no: string;
  app_invoice_no: string;
  total_amount: number;
  date: string;
}

interface LocalReconRow {
  email_uid: number;
  from: string;
  subject: string;
  body_snippet: string;
  date: string;
  is_seen: boolean;
  is_saved: boolean;
  extracted_distributor: string;
  extracted_invoice_no: string;
  matched_purchase: LocalMatchedPurchase | null;
  status: 'Missing' | 'Bounced' | 'Matched';
  medicine_names: string[];
  attachments: { filename: string; size: number; content_type: string }[];
}

interface LocalViewedPurchase {
  purchase: {
    id: number;
    invoice_no: string;
    distributor_name: string;
    date: string;
    total_amount: number;
    original_amount?: number;
    cn_amount: number;
    cn_number?: string;
  };
  items: LocalPurchaseItem[];
}

interface PurchaseTransaction {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  distributor_name: string;
  status?: string; // Paid, Pending, Refunded, Failed
  plan?: string;
  items?: LocalPurchaseItem[];
  total_qty?: number;
  cn_amount?: number;
  cn_number?: string;
  original_amount?: number;
}



// Module-level cache for instant re-mount

// Guards against out-of-order bill-barcode responses when switching purchases quickly
let billBarcodeSeq = 0;
const nextBillBarcodeRequestId = (): number => ++billBarcodeSeq;

const PurchaseHistory = () => {
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [colFilterId, setColFilterId] = useState('');
  const [colFilterDistributor, setColFilterDistributor] = useState('');
  const [colFilterInvoiceNo, setColFilterInvoiceNo] = useState('');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterMinAmount, setColFilterMinAmount] = useState('');
  const [colFilterMaxAmount, setColFilterMaxAmount] = useState('');

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'purchase-history-date-range',
    defaultFrom: getNDaysAgoString(15),
    defaultTo: getTodayString(),
  });

  // Client-side filtering logic
  const clientFilterFn = useCallback((t: PurchaseTransaction) => {
    if (colFilterId && !t.id.toString().includes(colFilterId)) {
      return false;
    }
    if (colFilterDistributor && !(t.distributor_name || '').toLowerCase().includes(colFilterDistributor.toLowerCase())) {
      return false;
    }
    if (colFilterInvoiceNo && !(t.invoice_no || '').toLowerCase().includes(colFilterInvoiceNo.toLowerCase())) {
      return false;
    }
    if (colFilterDate) {
      const pDate = t.date ? t.date.substring(0, 10) : '';
      if (pDate !== colFilterDate) return false;
    }
    const amountVal = t.total_amount || 0;
    const minVal = colFilterMinAmount ? Number(colFilterMinAmount) : 0;
    const maxVal = colFilterMaxAmount ? Number(colFilterMaxAmount) : 100000000;
    if (amountVal < minVal || amountVal > maxVal) {
      return false;
    }
    return true;
  }, [colFilterId, colFilterDistributor, colFilterInvoiceNo, colFilterDate, colFilterMinAmount, colFilterMaxAmount]);

  const isDateFiltered = !!(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to);

  // Infinite Scroll setup
  const {
    items,
    totalItems,
    meta,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    sentinelRef,
  } = useInfiniteScroll<PurchaseTransaction>({
    queryKey: 'purchase-history-list',
    cacheKey: 'purchase-history-cache',
    serverFilters: {
      search: searchQuery,
      start: dateRangeHelper.dateRange.from,
      end: dateRangeHelper.dateRange.to,
    },
    clientFilterFn,
    fetchPage: async (pageParam, filters) => {
      const isSearching = !!(filters.search && filters.search.trim().length >= 2);
      const response = await api.getPurchases({
        page: isDateFiltered && !isSearching ? undefined : pageParam,
        limit: isDateFiltered && !isSearching ? 10000 : 50,
        search: filters.search || undefined,
        start: isSearching ? undefined : (filters.start || undefined),
        end: isSearching ? undefined : (filters.end || undefined),
      });
      if (response && response.data) {
        return {
          data: response.data || [],
          totalItems: response.totalItems || 0,
          totalPages: response.totalPages || 1,
          meta: { totalAmount: response.totalAmount || 0 },
        };
      } else {
        const list = Array.isArray(response) ? response : [];
        const listAmount = list.reduce((sum: number, t: PurchaseTransaction) => sum + (t.total_amount || 0), 0);
        return {
          data: list,
          totalItems: list.length,
          totalPages: 1,
          meta: { totalAmount: listAmount },
        };
      }
    },
  });

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Reconciliation States
  const [activeTab, setActiveTab] = useState<'history' | 'reconciliation'>('history');
  const [selectedOrder, setSelectedOrder] = useState<LocalReconRow | null>(null);
  const [reissuingUid, setReissuingUid] = useState<number | null>(null);
  const [viewPurchase, setViewPurchase] = useState<LocalViewedPurchase | null>(null);
  const [generatingBarcodeId, setGeneratingBarcodeId] = useState<number | null>(null);
  const [generatingItemIndex, setGeneratingItemIndex] = useState<number | null>(null);
  const [billBarcode, setBillBarcode] = useState<{ billNo: string; barcodeText: string; qrDataUrl: string; code128DataUrl: string; pdfUrl: string } | null>(null);
  const [loadingBillBarcode, setLoadingBillBarcode] = useState(false);

  const handlePrintBillBarcodes = async (purchaseId: number, existingItems?: LocalPurchaseItem[]) => {
    setGeneratingBarcodeId(purchaseId);
    try {
      let billItems = existingItems;
      if (!billItems || billItems.length === 0) {
        const res = await api.getPurchase(purchaseId);
        billItems = res?.items || [];
      }

      const payload = (billItems || [])
        .filter((it: LocalPurchaseItem) => (it.name || it.medicine_name || '').trim().length > 0)
        .map((it: LocalPurchaseItem) => ({
          name: (it.name || it.medicine_name || 'Medicine').trim(),
          batch: (it.batch_no || it.batch_number || it.batch || 'N/A').trim(),
        }));

      if (payload.length === 0) {
        toastEvent.trigger('No valid items found in purchase bill for barcode generation', 'error');
        return;
      }

      const res = await api.generateMedicineBarcodes(payload);
      if (res && res.pdfUrl) {
        toastEvent.trigger(`Generated ${payload.length} product barcode label(s)`, 'success');
        window.open(res.pdfUrl, '_blank');
      } else {
        toastEvent.trigger('Failed to generate product barcode labels', 'error');
      }
    } catch (err) {
      console.error('Bill barcode generation error:', err);
      toastEvent.trigger('Failed to generate product barcode labels', 'error');
    } finally {
      setGeneratingBarcodeId(null);
    }
  };

  const handlePrintSingleProductBarcode = async (item: LocalPurchaseItem, itemIndex?: number) => {
    const name = (item.name || item.medicine_name || 'Medicine').trim();
    const batch = (item.batch_no || item.batch_number || item.batch || 'N/A').trim();
    if (!name) {
      toastEvent.trigger('Invalid product for barcode generation', 'error');
      return;
    }

    if (itemIndex !== undefined) setGeneratingItemIndex(itemIndex);
    try {
      const res = await api.generateMedicineBarcodes([{ name, batch }]);
      if (res && res.pdfUrl) {
        toastEvent.trigger(`Generated barcode label for ${name}`, 'success');
        window.open(res.pdfUrl, '_blank');
      } else {
        toastEvent.trigger('Failed to generate product barcode label', 'error');
      }
    } catch (err) {
      console.error('Product barcode generation error:', err);
      toastEvent.trigger('Failed to generate product barcode label', 'error');
    } finally {
      if (itemIndex !== undefined) setGeneratingItemIndex(null);
    }
  };

  // Reconciliation list via react-query; refreshed by DOM stock/purchase events below
  const {
    data: reconciliationData,
    isFetching: loadingRecon,
    refetch: fetchReconciliation,
  } = useApiQuery<LocalReconRow[]>(
    ['purchase-reconciliation'],
    () => api.getReconciliationList(),
  );
  const reconciliationList = reconciliationData || [];

  useEffect(() => {
    const handleUpdate = () => {
      refetch();
      fetchReconciliation();
    };
    window.addEventListener('stock-write-completed', handleUpdate);
    window.addEventListener('app-purchases-updated', handleUpdate);
    return () => {
      window.removeEventListener('stock-write-completed', handleUpdate);
      window.removeEventListener('app-purchases-updated', handleUpdate);
    };
  }, [refetch, fetchReconciliation]);

  const handleReissue = async (uid: number) => {
    try {
      setReissuingUid(uid);
      const previewData = await api.getReconciliationPreview(uid);
      if (selectedOrder?.email_uid === uid) {
        setSelectedOrder(null);
      }
      navigate('/purchases', {
        state: {
          prefilledPurchase: {
            distributorName: previewData.distributorName || '',
            invoiceNo: previewData.invoiceNo || '',
            date: previewData.date || '',
            totalAmount: previewData.totalAmount || 0,
            globalCdPer: previewData.globalCdPer || 0,
            items: previewData.items || []
          },
          emailSource: {
            email_uid: uid
          }
        }
      });
    } catch (err) {
      console.error('Reissue preview error:', err);
      navigate('/purchases');
    } finally {
      setReissuingUid(null);
    }
  };

  const openView = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      setBillBarcode(null);
      setLoadingBillBarcode(true);
      setViewPurchase(data);
      const reqId = nextBillBarcodeRequestId();
      api.getPurchaseBillBarcode(id)
        .then(barcode => {
          if (reqId === billBarcodeSeq) setBillBarcode(barcode);
        })
        .catch((err: unknown) => {
          console.error('Bill barcode load error:', err);
        })
        .finally(() => {
          if (reqId === billBarcodeSeq) setLoadingBillBarcode(false);
        });
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      alert('Failed to load purchase details.');
    }
  };

  const closeView = () => {
    setViewPurchase(null);
    setBillBarcode(null);
    setLoadingBillBarcode(false);
  };

  const openEdit = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      navigate('/purchases', {
        state: {
          prefilledPurchase: {
            editPurchaseId: data.purchase.id,
            distributor_id: data.purchase.distributor_id,
            distributorName: data.purchase.distributor_name,
            invoiceNo: data.purchase.invoice_no,
            date: data.purchase.date,
            totalAmount: data.purchase.total_amount,
            globalCdPer: 0,
            cnAmount: data.purchase.cn_amount || 0,
            cnNumber: data.purchase.cn_number || '',
            reconcileExpiryReturnId: data.purchase.reconcile_expiry_return_id || null,
            items: data.items.map((item: LocalPurchaseItem) => ({
              medicine_id: item.medicine_id,
              medicine_name: item.medicine_name,
              batch_no: item.batch_no,
              expiry_date: item.expiry_date,
              qty: item.quantity,
              free_qty: item.free_qty || 0,
              rate: item.cost_price,
              mrp: item.mrp,
              cgst_per: item.cgst_per,
              sgst_per: item.sgst_per,
              cd_per: item.cd_per || 0,
              cd_rs: item.cd_value || 0
            }))
          }
        }
      });
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      alert('Failed to load purchase details.');
    }
  };

  const { data: persistentSummary } = useApiQuery<{ totalAmount: number; totalInvoices: number; totalGst: number }>(
    'purchase-summary-cache',
    async () => {
      const res = await apiClient.get('/purchases/summary');
      return res.data;
    },
    { staleTime: 300000, refetchOnWindowFocus: false }
  );

  // Purchase Analytics — driven by pre-computed persistent summary & server aggregates
  const hasColumnFilters = !!(colFilterId || colFilterDistributor || colFilterInvoiceNo || colFilterDate || colFilterMinAmount || colFilterMaxAmount);
  const totalPurchases = hasColumnFilters ? items.length : (totalItems || persistentSummary?.totalInvoices || 0);
  const totalAmount = hasColumnFilters
    ? items.reduce((sum, t) => sum + (t.total_amount || 0), 0)
    : (meta.totalAmount || persistentSummary?.totalAmount || 0);
  const paidAmount = totalAmount; // Cash workflow, all are paid

  const handleExport = (type: 'csv' | 'pdf') => {
    const columns = [
      { key: 'id_formatted', label: 'Purchase ID' },
      { key: 'distributor_name', label: 'Distributor Name' },
      { key: 'invoice_no', label: 'Invoice No.' },
      { key: 'date_formatted', label: 'Date' },
      { key: 'total_qty', label: 'Qty' },
      { key: 'total_amount_formatted', label: 'Amount' },
    ];

    const formattedData = items.map(t => ({
      ...t,
      id_formatted: `#${t.id.toString().padStart(6, '0')}`,
      date_formatted: formatDisplayDate(t.date, true),
      total_amount_formatted: `₹${(t.total_amount || 0).toFixed(2)}`,
    }));

    if (type === 'csv') {
      exportToCSV(formattedData, columns, 'purchase_history.csv');
    } else {
      exportToPDF(formattedData, columns, 'purchase_history.pdf', 'Purchase History Report');
    }
  };

  const getUnreconciledCount = () => {
    return reconciliationList.filter(o => o.status === 'Missing' && !o.is_saved).length;
  };

  return (
    <div className="h-full flex-1 flex flex-col pt-1 px-4 gap-0 pb-4 animate-in fade-in duration-500 min-h-0">
      {/* Tabs */}
      <div className="flex border-b border-glass-border/30 mb-0 select-none">
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-text'
            }`}
        >
          Purchase History
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${activeTab === 'reconciliation'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-text'
            }`}
        >
          Reconcile Distributor Orders
          {getUnreconciledCount() > 0 && (
            <span className="bg-red text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">
              {getUnreconciledCount()} Missing
            </span>
          )}
        </button>
      </div>

      {activeTab === 'history' ? (
        <div className="glass-panel flex-1 flex flex-col overflow-hidden mt-3">
          {/* Purchase Analytics Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 bg-bg border-b border-glass-border text-xs shrink-0 select-none">
            <div className="p-4 border-r border-glass-border/30 flex flex-col gap-0.5">
              <span className="text-muted text-[10px] uppercase font-bold tracking-wider">Total Purchases</span>
              <span className="text-xl font-bold text-text font-mono">{totalPurchases}</span>
            </div>
            <div className="p-4 border-r border-glass-border/30 flex flex-col gap-0.5">
              <span className="text-muted text-[10px] uppercase font-bold tracking-wider">Total Value</span>
              <span className="text-xl font-bold text-primary font-mono">₹{totalAmount.toFixed(2)}</span>
            </div>
            <div className="p-4 flex flex-col gap-0.5">
              <span className="text-muted text-[10px] uppercase font-bold tracking-wider">Total Paid</span>
              <span className="text-xl font-bold text-green font-mono">₹{paidAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Search bar & Filter Toolbar */}
          <div className="px-4 py-3 border-b border-glass-border/30 bg-bg3/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex-1 min-w-[260px] relative">
              <input
                type="text"
                placeholder="Search by order ID, invoice number, or product name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text placeholder:text-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-bg3 border border-glass-border rounded-xl px-3 py-1.5 text-xs text-text">
                <Calendar size={13} className="text-muted" />
                <span className="text-muted text-[10px] uppercase font-bold">From:</span>
                <input
                  type="date"
                  value={toDateInputValue(dateRangeHelper.dateRange.from)}
                  onChange={(e) => dateRangeHelper.handleFromChange(e.target.value)}
                  className="bg-transparent text-xs text-text focus:outline-none cursor-pointer"
                />
                <span className="text-muted text-[10px] uppercase font-bold ml-1">To:</span>
                <input
                  type="date"
                  value={toDateInputValue(dateRangeHelper.dateRange.to)}
                  onChange={(e) => dateRangeHelper.handleToChange(e.target.value)}
                  className="bg-transparent text-xs text-text focus:outline-none cursor-pointer"
                />
                {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
                  <button
                    onClick={() => dateRangeHelper.clearFilters()}
                    className="text-[10px] text-red font-bold hover:underline ml-1 cursor-pointer"
                    title="Clear Date Range"
                  >
                    Clear
                  </button>
                )}
              </div>
              <button
                onClick={() => handleExport('csv')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-bg3 border-glass-border text-muted hover:text-text text-xs font-bold transition-all cursor-pointer"
                title="Export to CSV"
              >
                <Download size={13} />
                CSV
              </button>
              <button
                onClick={() => handleExport('pdf')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-bg3 border-glass-border text-muted hover:text-text text-xs font-bold transition-all cursor-pointer"
                title="Export to PDF"
              >
                <Download size={13} />
                PDF
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
            {isFetching && items.length === 0 ? (
              <div className="p-8 text-center text-muted font-semibold">
                <div className="flex justify-center items-center gap-2">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  Loading history...
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted p-12">
                <AlertCircle size={40} className="mb-3 opacity-30 text-muted" />
                <p className="text-base font-bold text-text">No transactions found</p>
                <p className="text-xs opacity-70 mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <InfiniteTable
                  totalSize={rowVirtualizer.getTotalSize()}
                  containerRef={parentRef}
                  className="border-0 bg-transparent text-xs"
                  header={
                    <tr className="flex items-center min-w-[1000px] bg-bg2/95 border-b border-glass-border text-xs font-bold text-muted uppercase tracking-wider select-none align-top">
                      <th className="w-32 shrink-0 px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span>Purchase ID</span>
                          <input
                            type="text"
                            placeholder="Search ID..."
                            value={colFilterId}
                            onChange={e => setColFilterId(e.target.value)}
                            className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          />
                        </div>
                      </th>
                      <th className="flex-1 min-w-[200px] px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span>Distributor Name</span>
                          <input
                            type="text"
                            placeholder="Search distributor..."
                            value={colFilterDistributor}
                            onChange={e => setColFilterDistributor(e.target.value)}
                            className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          />
                        </div>
                      </th>
                      <th className="w-40 shrink-0 px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span>Invoice No.</span>
                          <input
                            type="text"
                            placeholder="Search Invoice..."
                            value={colFilterInvoiceNo}
                            onChange={e => setColFilterInvoiceNo(e.target.value)}
                            className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          />
                        </div>
                      </th>
                      <th className="w-48 shrink-0 px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span>Date</span>
                          <input
                            type="date"
                            value={toDateInputValue(colFilterDate)}
                            onChange={e => setColFilterDate(e.target.value)}
                            className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text font-normal focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          />
                        </div>
                      </th>
                      <th className="w-28 shrink-0 text-right px-6 py-4">Qty</th>
                      <th className="w-40 shrink-0 px-6 py-4">
                        <div className="flex flex-col gap-1.5 text-right">
                          <span>Amount</span>
                          <div className="flex gap-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={colFilterMinAmount}
                              onChange={e => setColFilterMinAmount(e.target.value)}
                              className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50"
                            />
                            <input
                              type="number"
                              placeholder="Max"
                              value={colFilterMaxAmount}
                              onChange={e => setColFilterMaxAmount(e.target.value)}
                              className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 font-normal focus:outline-none focus:border-primary/50"
                            />
                          </div>
                        </div>
                      </th>
                      <th className="w-32 shrink-0 text-center px-6 py-4">
                        <div className="flex flex-col gap-1.5 items-center justify-center">
                          <span>Action</span>
                          {(colFilterId || colFilterDistributor || colFilterInvoiceNo || colFilterDate || colFilterMinAmount || colFilterMaxAmount) && (
                            <button
                              onClick={() => {
                                setColFilterId('');
                                setColFilterDistributor('');
                                setColFilterInvoiceNo('');
                                setColFilterDate('');
                                setColFilterMinAmount('');
                                setColFilterMaxAmount('');
                              }}
                              className="text-xs text-red hover:underline font-bold"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </th>
                    </tr>
                  }
                  body={
                    rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const tx = items[virtualRow.index];
                      if (!tx) return null;
                      return (
                        <VirtualRow
                          key={virtualRow.key}
                          ref={rowVirtualizer.measureElement}
                          start={virtualRow.start}
                          size={virtualRow.size}
                          className="min-w-[1000px] border-b border-glass-border/30 hover:bg-glass-bg transition-colors items-center flex"
                        >
                          <td className="w-32 shrink-0 px-6 py-4 text-muted font-mono">
                            #{tx.id.toString().padStart(6, '0')}
                          </td>
                          <td className="flex-1 min-w-[200px] px-6 py-4 text-text font-medium truncate" title={tx.distributor_name}>
                            {tx.distributor_name || '-'}
                          </td>
                          <td className="w-40 shrink-0 px-6 py-4 text-muted font-mono text-xs truncate" title={tx.invoice_no}>
                            {tx.invoice_no || '-'}
                          </td>
                          <td className="w-48 shrink-0 px-6 py-4 text-muted whitespace-nowrap">
                            {formatDisplayDate(tx.date, true)}
                          </td>
                          <td className="w-28 shrink-0 text-right px-6 py-4 text-muted font-medium">
                            {tx.total_qty || 0}
                          </td>
                          <td className="w-40 shrink-0 text-right px-6 py-4 whitespace-nowrap">
                            {tx.cn_amount && tx.cn_amount > 0 ? (
                              <div className="flex flex-col items-end">
                                <div className="flex items-center gap-1.5 justify-end">
                                  <span className="text-xs text-muted/60 line-through">
                                    ₹{(tx.original_amount || (tx.total_amount + tx.cn_amount)).toFixed(2)}
                                  </span>
                                  <span className="text-text font-medium">
                                    ₹{tx.total_amount?.toFixed(2) || '0.00'}
                                  </span>
                                </div>
                                <span className="text-[10px] text-primary font-semibold px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 mt-1 transition-all">
                                  CN Applied: -₹{tx.cn_amount.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-text font-medium">
                                ₹{tx.total_amount?.toFixed(2) || '0.00'}
                              </span>
                            )}
                          </td>
                          <td className="w-32 shrink-0 text-center px-6 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => openView(tx.id)} className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary/10" title="View Details">
                                <Eye size={16} />
                              </button>
                              <button
                                onClick={() => handlePrintBillBarcodes(tx.id, tx.items)}
                                disabled={generatingBarcodeId === tx.id}
                                className="text-muted hover:text-purple-400 transition-colors p-1 rounded hover:bg-purple-500/10 cursor-pointer disabled:opacity-50"
                                title="Generate & Print Product Barcodes for this Bill"
                              >
                                {generatingBarcodeId === tx.id ? <RefreshCw size={16} className="animate-spin text-purple-400" /> : <QrCode size={16} />}
                              </button>
                              <button onClick={() => openEdit(tx.id)} className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary/10" title="Edit Purchase">
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm('Are you sure you want to delete this purchase? This will reduce the stock in inventory.')) {
                                    api.deletePurchase(tx.id).then(() => {
                                      alert('Purchase deleted and stock reverted');
                                      refetch();
                                    }).catch((err) => {
                                      alert('Failed to delete purchase: ' + (err.response?.data?.error || err.message));
                                    });
                                  }
                                }}
                                className="text-muted hover:text-red transition-colors p-1 rounded hover:bg-red/10" title="Delete Purchase"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </VirtualRow>
                      );
                    })
                  }
                />
                {!isDateFiltered && (
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
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Reconciliation Tab */}
          <div className="flex justify-between items-center bg-bg2 border border-glass-border border-b-0 p-5 rounded-t-xl mt-3">
            <div>
              <h3 className="text-text font-semibold text-base">Unreconciled Distributor Orders</h3>
              <p className="text-xs text-muted mt-0.5">
                Automatically scans incoming email receipts to check if they have been successfully booked to inventory.
              </p>
            </div>
            <button
              onClick={() => fetchReconciliation()}
              className="p-2 rounded-lg bg-bg3 hover:bg-glass-bg border border-glass-border text-text text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <RefreshCw size={14} className={loadingRecon ? 'animate-spin' : ''} />
              Reload List
            </button>
          </div>

          <div className="bg-bg2 rounded-b-xl border border-glass-border flex-1 flex flex-col min-h-0 overflow-hidden shadow-xl">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-bg2 border-b border-glass-border">
                  <tr className="text-xs font-bold text-muted uppercase tracking-wider select-none">
                    <th className="px-6 py-4 whitespace-nowrap">Received Date</th>
                    <th className="px-6 py-4 whitespace-nowrap">Distributor / Sender</th>
                    <th className="px-6 py-4 whitespace-nowrap">Subject Line</th>
                    <th className="px-6 py-4 whitespace-nowrap">Extracted Invoice No.</th>
                    <th className="px-6 py-4 whitespace-nowrap">Medicines</th>
                    <th className="px-6 py-4 whitespace-nowrap text-center">Status</th>
                    <th className="px-6 py-4 whitespace-nowrap text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border/30 text-xs">
                  {loadingRecon ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-muted">
                        <div className="flex justify-center items-center gap-2">
                          <Loader2 size={18} className="animate-spin text-primary" />
                          Analyzing email receipts...
                        </div>
                      </td>
                    </tr>
                  ) : reconciliationList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-muted">
                        <div className="flex flex-col items-center justify-center">
                          <CheckCircle size={48} className="text-green mb-4 opacity-40" />
                          <p className="text-base font-bold text-text">All Clear!</p>
                          <p className="text-xs opacity-70 mt-1">No unreconciled or missing distributor orders detected from emails.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    reconciliationList.map((recon, idx) => (
                      <tr key={recon.email_uid || idx} className={`hover:bg-glass-bg transition-colors ${recon.is_saved ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4 text-muted whitespace-nowrap font-mono">
                          {new Date(recon.date).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-text font-medium">
                          {recon.extracted_distributor && recon.extracted_distributor.trim() && recon.extracted_distributor !== 'Unknown Dist.' && recon.extracted_distributor !== 'Unknown Distributor' && recon.extracted_distributor !== 'Default Distributor' ? (
                            recon.extracted_distributor
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                              <AlertCircle size={10} /> Unresolved Distributor
                            </span>
                          )}
                          <div className="text-xs text-muted font-normal mt-0.5 truncate max-w-[200px]">{recon.from}</div>
                        </td>
                        <td className="px-6 py-4 text-text/80 max-w-xs truncate">
                          {recon.subject}
                        </td>
                        <td className="px-6 py-4 font-mono text-text text-xs">
                          {recon.extracted_invoice_no || 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          {recon.medicine_names && recon.medicine_names.length > 0 ? (
                            <div className="text-text/80 max-w-xs truncate" title={recon.medicine_names.join(', ')}>
                              {recon.medicine_names.slice(0, 3).join(', ')}
                              {recon.medicine_names.length > 3 && ` +${recon.medicine_names.length - 3} more`}
                            </div>
                          ) : (
                            <span className="text-muted text-xs italic">No medicines detected</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {recon.is_saved ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border text-green bg-green/10 border-green/20">
                              <CheckCircle size={10} className="mr-1" /> Reconciled
                            </span>
                          ) : recon.status === 'Matched' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border text-green bg-green/10 border-green/20">
                              <CheckCircle size={10} className="mr-1" /> Matched
                            </span>
                          ) : recon.status === 'Bounced' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border text-yellow-500 bg-yellow-500/10 border-yellow-500/20" title={recon.medicine_names?.join(', ')}>
                              <AlertCircle size={10} className="mr-1" /> Bounced ({recon.medicine_names?.length || 0})
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border text-red bg-red/10 border-red/20">
                              <AlertCircle size={10} className="mr-1" /> Missing Bill
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setSelectedOrder(recon)}
                              className="text-muted hover:text-text transition-colors p-1.5 rounded bg-bg3 hover:bg-glass-bg border border-glass-border"
                              title="Investigate Order Metadata & Match Details"
                            >
                              <Eye size={14} />
                            </button>
                            {!recon.is_saved && (
                              <button
                                onClick={() => handleReissue(recon.email_uid)}
                                disabled={reissuingUid !== null}
                                className="text-green hover:text-green-600 transition-colors p-1.5 rounded bg-green/10 hover:bg-green/20 border border-green/20"
                                title="Reprocess & Open in Purchases page"
                              >
                                <RefreshCw size={14} className={reissuingUid === recon.email_uid ? 'animate-spin' : ''} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Investigation Modal */}
      {selectedOrder && createPortal(
        <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-glass-border flex justify-between items-start bg-bg2">
              <div>
                <h3 className="text-lg font-bold text-text flex items-center gap-2">
                  <AlertCircle size={20} className="text-primary" />
                  Investigate Distributor Order Metadata
                </h3>
                <p className="text-xs text-muted mt-1">
                  Email UID: #{selectedOrder.email_uid} &middot; Received {new Date(selectedOrder.date).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-muted hover:text-text bg-bg3 hover:bg-glass-bg p-1.5 rounded-lg border border-glass-border transition-all text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[65vh] space-y-5 text-xs">
              {/* Raw Body Snippet */}
              {selectedOrder.body_snippet && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide">Raw Email Body Snippet</h4>
                  <div className="bg-bg3 p-3 rounded-xl border border-glass-border text-muted font-mono text-[11px] leading-relaxed max-h-28 overflow-y-auto">
                    {selectedOrder.body_snippet}...
                  </div>
                </div>
              )}

              {/* Medicines List */}
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide">
                  {selectedOrder.status === 'Bounced' ? 'Bounced / Unmatched Medicines' : 'Medicines Detected in Order'}
                </h4>
                {selectedOrder.medicine_names && selectedOrder.medicine_names.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedOrder.medicine_names.map((name: string, i: number) => (
                      <div key={i} className="bg-bg3 border border-glass-border p-2.5 rounded-xl flex justify-between items-center">
                        <span className="font-medium text-xs text-text">{name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted italic">All items successfully matched or no missing medicines identified.</p>
                )}
              </div>

              {/* Matched Purchase Info */}
              {selectedOrder.matched_purchase && (
                <div className="bg-bg3 p-4 rounded-xl border border-glass-border space-y-1">
                  <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide">Matched DB Purchase Record</h4>
                  <p className="text-text font-medium">Invoice: #{selectedOrder.matched_purchase.invoice_no || selectedOrder.matched_purchase.app_invoice_no} &middot; Total: ₹{selectedOrder.matched_purchase.total_amount}</p>
                  <p className="text-[11px] text-muted">Booked on: {new Date(selectedOrder.matched_purchase.date).toLocaleDateString()}</p>
                </div>
              )}

              {/* Distributor Details */}
              <div className="bg-bg3 p-4 rounded-xl border border-glass-border space-y-1">
                <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide">Distributor</h4>
                {selectedOrder.extracted_distributor && selectedOrder.extracted_distributor.trim() && selectedOrder.extracted_distributor !== 'Unknown Dist.' && selectedOrder.extracted_distributor !== 'Unknown Distributor' && selectedOrder.extracted_distributor !== 'Default Distributor' ? (
                  <p className="text-text font-medium">{selectedOrder.extracted_distributor}</p>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-500 font-bold">
                    <AlertCircle size={12} />
                    <span>Unresolved Distributor — Please assign legitimate distributor before booking.</span>
                  </div>
                )}
                <p className="text-[11px] text-muted">Sender: {selectedOrder.from}</p>
              </div>

              {/* Reconciliation Status / Action */}
              <div className="bg-bg3 p-4 rounded-xl border border-glass-border">
                <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1">Reconciliation Status</h4>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${selectedOrder.is_saved ? 'bg-green/10 text-green border border-green/20' : selectedOrder.status === 'Matched' ? 'bg-green/10 text-green border border-green/20' : selectedOrder.status === 'Bounced' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 'bg-red/10 text-red border border-red/20'
                    }`}>
                    <CheckCircle size={12} />
                    {selectedOrder.is_saved ? 'Reconciled & Saved' : selectedOrder.status === 'Matched' ? 'Matched Purchase' : selectedOrder.status === 'Bounced' ? 'Bounced Items Detected' : 'Missing Invoice Bill'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-glass-border bg-bg2 flex flex-wrap gap-3 justify-end">
              {!selectedOrder.is_saved && (
                <>
                  <button
                    onClick={async () => {
                      try {
                        await api.resolveOrderManually(selectedOrder.email_uid);
                        toastEvent.trigger('Marked as reconciled', 'success');
                        setSelectedOrder(null);
                        fetchReconciliation();
                      } catch (_e) {
                        toastEvent.trigger('Failed to update status', 'error');
                      }
                    }}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-green/10 hover:bg-green/20 text-green border border-green/20 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckCircle size={14} />
                    Link & Mark Reconciled
                  </button>
                  <button
                    onClick={() => handleReissue(selectedOrder.email_uid)}
                    disabled={reissuingUid !== null}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    {reissuingUid === selectedOrder.email_uid ? 'Opening Purchases...' : 'Reprocess & Open in Purchases'}
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-bg3 hover:bg-glass-bg text-muted hover:text-text border border-glass-border transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* View Purchase Modal */}
      {viewPurchase && createPortal(
        <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-4xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-glass-border flex justify-between items-center bg-bg2">
              <div>
                <h3 className="text-lg font-bold text-text flex items-center gap-2">
                  <Eye size={20} className="text-primary" />
                  View Purchase Invoice: {viewPurchase.purchase.invoice_no || 'N/A'}
                </h3>
                <p className="text-xs text-muted mt-1">
                  Distributor: {viewPurchase.purchase.distributor_name} &middot; Date: {formatDisplayDate(viewPurchase.purchase.date)}
                </p>
              </div>
              <button
                onClick={closeView}
                className="text-muted hover:text-text bg-bg3 hover:bg-glass-bg p-1.5 rounded-lg border border-glass-border transition-all text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-bg3 p-4 rounded-xl border border-glass-border">
                <div>
                  <span className="text-xs text-muted block mb-1">Invoice No.</span>
                  <strong className="text-text text-sm font-mono">{viewPurchase.purchase.invoice_no || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-xs text-muted block mb-1">Date</span>
                  <strong className="text-text text-sm">{formatDisplayDate(viewPurchase.purchase.date)}</strong>
                </div>
                <div>
                  <span className="text-xs text-muted block mb-1">Distributor</span>
                  <strong className="text-text text-sm">{viewPurchase.purchase.distributor_name}</strong>
                </div>
                <div>
                  <span className="text-xs text-muted block mb-1">Total Amount</span>
                  <strong className="text-green text-sm font-bold font-mono">₹{viewPurchase.purchase.total_amount?.toFixed(2) || '0.00'}</strong>
                </div>
              </div>

              {viewPurchase.purchase.cn_amount > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold text-lg font-mono">
                      CN
                    </div>
                    <div>
                      <span className="text-xs text-primary font-semibold block">Credit Note Applied</span>
                      <span className="text-xs text-muted font-mono">No: {viewPurchase.purchase.cn_number || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <span className="text-xs text-muted block">Original Bill Total</span>
                      <span className="text-sm text-muted font-medium line-through">
                        ₹{(viewPurchase.purchase.original_amount || (viewPurchase.purchase.total_amount + viewPurchase.purchase.cn_amount)).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-primary block">CN Discount</span>
                      <span className="text-sm text-primary font-semibold">
                        -₹{viewPurchase.purchase.cn_amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-muted block">Net Amount Paid</span>
                      <span className="text-sm text-green font-bold">
                        ₹{viewPurchase.purchase.total_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Purchase Bill QR & Barcode */}
              <div className="bg-bg2/60 p-4 rounded-xl border border-glass-border flex flex-col sm:flex-row items-center justify-between gap-3">
                {billBarcode ? (
                  <>
                    <div className="flex items-center gap-4">
                      <img src={billBarcode.qrDataUrl} alt="Bill QR" className="w-16 h-16 rounded bg-bg p-1 shrink-0 shadow-sm" />
                      <div>
                        <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <QrCode size={12} /> Purchase Bill Barcode (Code128 + QR)
                        </div>
                        <img src={billBarcode.code128DataUrl} alt="Bill Code128" className="h-10 bg-bg p-1 rounded max-w-[220px]" />
                        <div className="text-[10px] font-mono text-muted mt-1">{billBarcode.barcodeText}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => window.open(billBarcode.pdfUrl, '_blank')}
                      className="px-3.5 py-2 bg-primary/20 hover:bg-primary text-primary hover:text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border border-primary/30 shrink-0 cursor-pointer"
                      title="Print the scannable QR + barcode label for this purchase bill"
                    >
                      <Printer size={14} /> Print Bill Label
                    </button>
                  </>
                ) : loadingBillBarcode ? (
                  <span className="text-xs text-muted py-2 flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Loading bill barcode...</span>
                ) : (
                  <span className="text-xs text-muted py-2">Bill barcode unavailable</span>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-text mb-3">Items</h4>
                <div className="border border-glass-border rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-bg3 text-muted border-b border-glass-border uppercase font-semibold">
                      <tr>
                        <th className="px-4 py-3">Medicine</th>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Expiry</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Free</th>
                        <th className="px-4 py-3 text-right">Rate</th>
                        <th className="px-4 py-3 text-right">MRP</th>
                        <th className="px-4 py-3 text-center">Barcode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/30">
                      {viewPurchase.items && viewPurchase.items.map((item: LocalPurchaseItem, i: number) => (
                        <tr key={i} className="hover:bg-glass-bg">
                          <td className="px-4 py-3 text-text font-medium">{item.medicine_name}</td>
                          <td className="px-4 py-3 text-muted font-mono">{item.batch_no || '-'}</td>
                          <td className="px-4 py-3 text-muted">{item.expiry_date || '-'}</td>
                          <td className="px-4 py-3 text-right text-muted">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-muted">{item.free_qty || 0}</td>
                          <td className="px-4 py-3 text-right text-muted font-mono">₹{(Number(item.cost_price) || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-muted font-mono">₹{(Number(item.mrp) || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handlePrintSingleProductBarcode(item, i)}
                              disabled={generatingItemIndex === i}
                              className="text-purple-400 hover:text-purple-300 p-1.5 transition-colors cursor-pointer disabled:opacity-50 hover:bg-purple-500/10 rounded"
                              title="Print Barcode sticker for this specific product (missing/damaged barcode)"
                            >
                              {generatingItemIndex === i ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-glass-border bg-bg2 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => handlePrintBillBarcodes(viewPurchase.purchase.id, viewPurchase.items)}
                disabled={generatingBarcodeId === viewPurchase.purchase.id}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                title="Generate and print barcodes for all products in this bill"
              >
                {generatingBarcodeId === viewPurchase.purchase.id ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
                Print All Barcodes
              </button>
              <button
                onClick={closeView}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-bg3 hover:bg-glass-bg text-muted hover:text-text border border-glass-border transition-all cursor-pointer"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  const idToEdit = viewPurchase.purchase.id;
                  closeView();
                  openEdit(idToEdit);
                }}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Edit size={16} />
                Edit Purchase
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PurchaseHistory;
