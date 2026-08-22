import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  AlertTriangle, 
  RefreshCw, 
  CheckCircle2,
  RotateCcw,
  FileText
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { getNDaysAgoString, toDateInputValue } from '../../utils/date';

interface ExpiryItem {
  id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  mrp: number;
  rack_location?: string;
  medicine_id?: number;
  purchase_invoice_no?: string;
  purchase_id?: number;
  purchase_item_id?: number;
  purchase_cost_price?: number;
  distributor_id?: number;
  distributor_name?: string;
}



let cachedExpiryItems: ExpiryItem[] | null = null;

const Expiry = () => {
  const navigate = useNavigate();
  const [pendingReviewsCount, setPendingReviewsCount] = useState(0);

  useEffect(() => {
    api.getExpiryReviews({ status: 'pending' }).then(res => {
      if (res?.stats) setPendingReviewsCount(res.stats.pendingCount || 0);
    }).catch(() => {});
  }, []);

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'expiry-date-range',
    defaultFrom: getNDaysAgoString(365), // Default to 1 year ago to show expired medicines
    defaultTo: getNDaysAgoString(-90),   // Default to 90 days in the future
    minDate: '2020-01-01',
    maxDate: '2035-12-31',
    futurePresets: true,
  });
  
  const queryClient = useQueryClient();
  const expiryKey = ['expiry', dateRangeHelper.dateRange.from, dateRangeHelper.dateRange.to] as const;
  const { data: items = [], isLoading: loading, isFetching: refreshing, refetch: refetchExpiry } = useApiQuery<ExpiryItem[]>(
    expiryKey,
    async () => {
      const res = await api.getExpiryList({
        date_from: dateRangeHelper.dateRange.from,
        date_to: dateRangeHelper.dateRange.to,
      });
      const list = Array.isArray(res) ? res : (res?.data || []);
      cachedExpiryItems = list;
      return list;
    },
    {
      initialData: cachedExpiryItems || undefined,
      staleTime: 10000,
    }
  );

  // P1 "events, not timers": refetch ONLY when stock/expiry data actually
  // changed (window events + SSE push) — no 15s polling of unchanged data.
  useEffect(() => {
    const handleStockWrite = () => {
      refetchExpiry().catch(() => {});
    };

    window.addEventListener('stock-write-completed', handleStockWrite);
    window.addEventListener('sse-inventory-changed', handleStockWrite);
    window.addEventListener('sse-invoice-saved', handleStockWrite);
    window.addEventListener('expiry-list-changed', handleStockWrite);

    return () => {
      window.removeEventListener('stock-write-completed', handleStockWrite);
      window.removeEventListener('sse-inventory-changed', handleStockWrite);
      window.removeEventListener('sse-invoice-saved', handleStockWrite);
      window.removeEventListener('expiry-list-changed', handleStockWrite);
    };
  }, [refetchExpiry]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // Custom Filters
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');
  const [] = useState(false);
  const [colFilterId, setColFilterId] = useState('');
  const [colFilterMedName, setColFilterMedName] = useState('');
  const [colFilterBatchNo, setColFilterBatchNo] = useState('');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterMinQty, setColFilterMinQty] = useState('');
  const [colFilterMaxQty, setColFilterMaxQty] = useState('');
  const [colFilterMinMrp, setColFilterMinMrp] = useState('');
  const [colFilterMaxMrp, setColFilterMaxMrp] = useState('');
  const [colFilterLocation, setColFilterLocation] = useState('');



  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    toastEvent.trigger(message, type, '/expiry');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSendToReturns = () => {
    const selected = filteredItems.filter(item => selectedIds.has(item.id));
    if (selected.length === 0) return;
    navigate('/returns', { state: { prefilledReturnItems: selected } });
  };

  const handleExport = async (format: 'pdf' | 'csv') => {
    try {
      const blob = await api.exportExpiryReport({
        date_from: dateRangeHelper.dateRange.from,
        date_to: dateRangeHelper.dateRange.to,
        format
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expiry_report_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showNotification(`Expiry report (${format.toUpperCase()}) exported successfully!`, 'success');
    } catch (err) {
      console.error(`Failed to export expiry report:`, err);
      showNotification('Failed to export expiry report.', 'error');
    }
  };

  // Calculations for Expiry Badging
  const getExpiryDaysDiff = (expiryDateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDateStr);
    exp.setHours(0, 0, 0, 0);
    
    const diffTime = exp.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getExpiryStatusDetails = (daysDiff: number) => {
    if (daysDiff <= 0) {
      return {
        label: 'EXPIRED',
        colorClass: 'bg-red-500/15 border-red-500/30 text-red font-bold',
        rowClass: 'border-red-500/10 bg-red-500/5',
        daysText: `${Math.abs(daysDiff)} days ago`
      };
    } else if (daysDiff <= 30) {
      return {
        label: 'CRITICAL',
        colorClass: 'bg-orange-500/15 border-orange-500/30 text-orange-500 font-bold',
        rowClass: 'border-orange-500/10 bg-orange-500/5',
        daysText: `in ${daysDiff} days`
      };
    } else if (daysDiff <= 60) {
      return {
        label: 'WARNING',
        colorClass: 'bg-amber-500/15 border-amber-500/30 text-amber-500 font-bold',
        rowClass: 'border-amber-500/5',
        daysText: `in ${daysDiff} days`
      };
    } else {
      return {
        label: 'NEAR EXPIRY',
        colorClass: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 font-semibold',
        rowClass: '',
        daysText: `in ${daysDiff} days`
      };
    }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.medicine_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.batch_no.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesMinQty = !minQty || item.quantity >= Number(minQty);
    const matchesMaxQty = !maxQty || item.quantity <= Number(maxQty);

    if (!(matchesSearch && matchesMinQty && matchesMaxQty)) {
      return false;
    }

    // Column-specific header filters
    if (colFilterId && !item.id.toString().includes(colFilterId)) {
      return false;
    }
    if (colFilterMedName && !item.medicine_name.toLowerCase().includes(colFilterMedName.toLowerCase())) {
      return false;
    }
    if (colFilterBatchNo && !item.batch_no.toLowerCase().includes(colFilterBatchNo.toLowerCase())) {
      return false;
    }
    if (colFilterDate) {
      const itemDate = item.expiry_date ? item.expiry_date.substring(0, 10) : '';
      if (itemDate !== colFilterDate) return false;
    }
    const qtyVal = item.quantity || 0;
    const minQ = colFilterMinQty ? Number(colFilterMinQty) : 0;
    const maxQ = colFilterMaxQty ? Number(colFilterMaxQty) : 100000000;
    if (qtyVal < minQ || qtyVal > maxQ) return false;

    const mrpVal = item.mrp || 0;
    const minM = colFilterMinMrp ? Number(colFilterMinMrp) : 0;
    const maxM = colFilterMaxMrp ? Number(colFilterMaxMrp) : 100000000;
    if (mrpVal < minM || mrpVal > maxM) return false;

    if (colFilterLocation && !(item.rack_location || '').toLowerCase().includes(colFilterLocation.toLowerCase())) {
      return false;
    }

    return true;
  });

  return (
    <div className="h-full flex flex-col fade-in gap-3">
      {/* Pending Expiry Returns Alert Banner */}
      {pendingReviewsCount > 0 && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm shrink-0">
          <div className="flex items-center gap-2.5 text-xs">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
              <AlertTriangle size={16} />
            </div>
            <div>
              <span className="text-text font-bold">
                {pendingReviewsCount} expired stock batch{pendingReviewsCount > 1 ? 'es' : ''} detected & awaiting pharmacist approval.
              </span>
              <p className="text-muted text-[11px] font-medium">Inventory is preserved until explicitly approved in Expiry Return Review.</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/returns?tab=expiry-review')}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-bg font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-sm"
          >
            <span>Open Review Hub</span>
            <RotateCcw size={12} />
          </button>
        </div>
      )}

      {/* Selection action bar — only visible when items are selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-1 select-none animate-in slide-in-from-top-1 duration-150">
          <span className="text-xs font-semibold text-muted">{selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected</span>
          <button
            onClick={handleSendToReturns}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all text-xs font-bold active:scale-95"
          >
            <RotateCcw size={12} />
            Send {selectedIds.size} to Returns ↗
          </button>
        </div>
      )}

      <div className="flex gap-4 flex-1 min-h-0">
        
        {/* LEFT SIDEBAR: Compact filters + summary stats (~22% width) */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-3 overflow-y-auto scrollbar-thin">

          {/* Date Range */}
          <div className="glass-panel p-4">
            <h3 className="font-bold text-[10px] text-muted uppercase tracking-wider mb-3">Date Range</h3>
            <DateRangeFilter
              helper={dateRangeHelper}
              label=""
              showInputs={true}
              presets={[
                { label: '30d', days: 30 },
                { label: '60d', days: 60 },
                { label: '90d', days: 90 },
                { label: '180d', days: 180 }
              ]}
            />
          </div>

          {/* Status Summary */}
          <div className="glass-panel p-4 flex flex-col gap-2">
            <h3 className="font-bold text-[10px] text-muted uppercase tracking-wider mb-1">Status Breakdown</h3>

            {[
              { label: 'Expired', color: 'bg-red-500', textColor: 'text-red-500', count: items.filter(i => getExpiryDaysDiff(i.expiry_date) <= 0).length },
              { label: 'Critical ≤30d', color: 'bg-orange-500', textColor: 'text-orange-500', count: items.filter(i => { const d = getExpiryDaysDiff(i.expiry_date); return d > 0 && d <= 30; }).length },
              { label: 'Warning ≤60d', color: 'bg-amber-500', textColor: 'text-amber-500', count: items.filter(i => { const d = getExpiryDaysDiff(i.expiry_date); return d > 30 && d <= 60; }).length },
              { label: 'Near ≤90d', color: 'bg-indigo-500', textColor: 'text-indigo-400', count: items.filter(i => { const d = getExpiryDaysDiff(i.expiry_date); return d > 60 && d <= 90; }).length },
            ].map(stat => (
              <div key={stat.label} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-bg3/40 border border-glass-border/30">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${stat.color} shrink-0`} />
                  <span className="text-[11px] font-semibold text-text">{stat.label}</span>
                </div>
                <span className={`font-mono text-sm font-bold ${stat.textColor}`}>{stat.count}</span>
              </div>
            ))}

            <div className="mt-1 pt-2 border-t border-glass-border/30 flex justify-between items-center">
              <span className="text-[10px] text-muted font-semibold">Total showing</span>
              <span className="font-mono text-xs font-bold text-text">{items.length}</span>
            </div>
          </div>

          {/* Quick Qty Filter */}
          <div className="glass-panel p-4">
            <h3 className="font-bold text-[10px] text-muted uppercase tracking-wider mb-3">Stock Qty Filter</h3>
            <div className="flex gap-2">
              <input
                type="number"
                value={minQty}
                onChange={e => setMinQty(e.target.value)}
                placeholder="Min"
                min="0"
                className="w-1/2 px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50"
              />
              <input
                type="number"
                value={maxQty}
                onChange={e => setMaxQty(e.target.value)}
                placeholder="Max"
                min="0"
                className="w-1/2 px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Table — fills remaining space */}
        <div className="flex-1 glass-panel flex flex-col overflow-hidden bg-bg2/80 border-glass-border min-h-0 shadow-sm rounded-2xl">
          
          {/* Table Toolbar */}
          <div className="px-3 py-2.5 border-b border-glass-border bg-bg3/40 flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search medicine or batch..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-bg3/80 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <span className="text-[11px] text-muted font-bold shrink-0">{filteredItems.length} items</span>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-auto bg-bg/40">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-bg2/95 backdrop-blur-md z-10 select-none border-b border-glass-border">
                <tr>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 w-8">
                    <input type="checkbox" className="rounded" onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(filteredItems.filter(i => i.purchase_invoice_no).map(i => i.id)));
                      else setSelectedIds(new Set());
                    }} checked={selectedIds.size === filteredItems.filter(i => i.purchase_invoice_no).length && filteredItems.length > 0} readOnly />
                  </th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">ID</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Medicine Name</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Batch Number</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Expiry Date</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Remaining Time</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Stock Qty</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-right">MRP Price</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Invoice Ref / Supplier</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Rack Location</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Actions</th>
                </tr>
                <tr className="bg-bg2 border-b border-glass-border/30">
                  <td className="p-2"></td>
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search ID..."
                      value={colFilterId}
                      onChange={e => setColFilterId(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 animate-in fade-in"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search name..."
                      value={colFilterMedName}
                      onChange={e => setColFilterMedName(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 animate-in fade-in"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search batch..."
                      value={colFilterBatchNo}
                      onChange={e => setColFilterBatchNo(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 animate-in fade-in"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      value={toDateInputValue(colFilterDate)}
                      onChange={e => setColFilterDate(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 animate-in fade-in"
                    />
                  </td>
                  <td className="p-2"></td>
                  <td className="p-2 flex gap-1">
                    <input
                      type="number"
                      placeholder="Min"
                      value={colFilterMinQty}
                      onChange={e => setColFilterMinQty(e.target.value)}
                      className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={colFilterMaxQty}
                      onChange={e => setColFilterMaxQty(e.target.value)}
                      className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={colFilterMinMrp}
                        onChange={e => setColFilterMinMrp(e.target.value)}
                        className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={colFilterMaxMrp}
                        onChange={e => setColFilterMaxMrp(e.target.value)}
                        className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  </td>
                  <td className="p-2">
                    {/* Invoice Ref / Supplier empty filter cell */}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-between gap-1">
                      <input
                        type="text"
                        placeholder="Search location..."
                        value={colFilterLocation}
                        onChange={e => setColFilterLocation(e.target.value)}
                        className="flex-1 px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 animate-in fade-in"
                      />
                      {(colFilterId || colFilterMedName || colFilterBatchNo || colFilterDate || colFilterMinQty || colFilterMaxQty || colFilterMinMrp || colFilterMaxMrp || colFilterLocation) && (
                        <button
                          onClick={() => {
                            setColFilterId('');
                            setColFilterMedName('');
                            setColFilterBatchNo('');
                            setColFilterDate('');
                            setColFilterMinQty('');
                            setColFilterMaxQty('');
                            setColFilterMinMrp('');
                            setColFilterMaxMrp('');
                            setColFilterLocation('');
                          }}
                          className="text-[10px] text-red hover:underline font-bold px-1"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    {/* Actions empty filter cell */}
                  </td>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="p-12 text-center text-muted font-semibold">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-primary opacity-60" />
                      Loading expiry register...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-16 text-center text-muted font-semibold">
                      <CheckCircle2 size={36} className="mx-auto mb-3 text-muted/30" />
                      <span>No items matching expiry thresholds in inventory.</span>
                      {colFilterMedName && colFilterMedName.trim().length >= 2 && (
                        <div className="mt-2 text-[12px] text-amber-500 font-medium">
                          🔍 No expiring items match "{colFilterMedName}". Please check spelling or clear medicine filter.
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map(item => {
                    const daysDiff = getExpiryDaysDiff(item.expiry_date);
                    const details = getExpiryStatusDetails(daysDiff);
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <tr 
                        key={item.id} 
                        className={`transition-all border-b border-glass-border/30 ${
                          isSelected 
                            ? 'bg-primary/15 border-l-4 border-l-primary text-text font-bold shadow-sm' 
                            : `hover:bg-bg3/40 ${details.rowClass}`
                        }`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded accent-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                              disabled={!item.purchase_invoice_no}
                            />
                            {isSelected && (
                              <span className="px-1.5 py-0.5 rounded bg-primary text-white text-[9px] font-black uppercase tracking-wider shadow-sm animate-in fade-in">
                                Selected
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-muted font-mono select-none">
                          {item.id}
                        </td>
                        <td className="p-4 font-bold text-text">
                          {item.medicine_name}
                        </td>
                        <td className="p-4 select-none">
                          <span className="font-mono bg-bg3/60 border border-glass-border/40 rounded-lg px-2.5 py-1 font-bold text-text">
                            {item.batch_no}
                          </span>
                        </td>
                        <td className="p-4 text-center font-mono select-none text-muted font-semibold">
                          {new Date(item.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' })}
                        </td>
                        <td className="p-4 text-center font-semibold select-none">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold border ${details.colorClass}`}>
                              {details.label}
                            </span>
                            <span className="text-[10px] text-muted font-medium">{details.daysText}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center font-extrabold font-mono text-text">
                          {item.quantity}
                        </td>
                        <td className="p-4 text-right font-mono font-extrabold text-sky">
                          ₹{item.mrp?.toFixed(2) || '0.00'}
                        </td>
                        <td className="p-4 select-none">
                          {item.purchase_invoice_no ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-lg text-[9px] font-bold font-mono w-max">
                                {item.purchase_invoice_no}
                              </span>
                              <span className="text-[10px] text-muted truncate max-w-[130px] font-semibold" title={item.distributor_name}>
                                {item.distributor_name}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted/65 italic font-medium">Unmatched (match manually)</span>
                          )}
                        </td>
                        <td className="p-4 text-muted font-medium select-none">
                          {item.rack_location || '-'}
                        </td>
                        <td className="p-4 text-center select-none">
                          <button
                            onClick={() => {
                              if (item.purchase_invoice_no) {
                                navigate('/returns', { state: { prefilledReturnItems: [item] } });
                              }
                            }}
                            disabled={!item.purchase_invoice_no}
                            className={`flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                              item.purchase_invoice_no
                                ? 'bg-red-500/15 border-red-500/30 text-red hover:bg-red-500/25 active:scale-95'
                                : 'opacity-40 bg-bg3 border-glass-border text-muted cursor-not-allowed'
                            }`}
                            title={item.purchase_invoice_no ? 'Create Return' : 'Cannot return: no purchase invoice found, match manually'}
                          >
                            <RotateCcw size={11} />
                            Return
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Live Multi-Distributor Selection Summary Bar */}
          {selectedIds.size > 0 && (() => {
            const selectedList = filteredItems.filter(i => selectedIds.has(i.id));
            const totalVal = selectedList.reduce((sum, item) => sum + (item.mrp || 0) * (item.quantity || 1), 0);
            
            const distCounts: Record<string, number> = {};
            selectedList.forEach(item => {
              const dName = item.distributor_name ? item.distributor_name.trim() : 'Unknown Supplier';
              distCounts[dName] = (distCounts[dName] || 0) + 1;
            });
            const distEntries = Object.entries(distCounts);

            return (
              <div className="p-3 border-t border-primary/30 bg-primary/10 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 px-5 animate-in slide-in-from-bottom-2">
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-extrabold text-text">
                      {selectedIds.size} Medicine{selectedIds.size !== 1 ? 's' : ''} Selected
                    </span>
                  </div>
                  <span className="text-muted font-bold">|</span>
                  <span className="font-extrabold text-emerald-400 font-mono">
                    Est. Value: ₹{totalVal.toFixed(2)}
                  </span>
                  <span className="text-muted font-bold">|</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-muted font-semibold">Suppliers ({distEntries.length}):</span>
                    {distEntries.map(([dName, count]) => (
                      <span key={dName} className="px-2 py-0.5 rounded-lg bg-bg2/90 border border-primary/30 text-text text-[10px] font-bold font-mono shadow-sm">
                        🏭 {dName}: <span className="text-primary">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-muted hover:text-red font-bold px-2 py-1"
                  >
                    Deselect All
                  </button>
                  <button
                    onClick={handleSendToReturns}
                    className="bg-red-500 hover:bg-red-600 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <RotateCcw size={14} />
                    <span>Generate Supplier Return Drafts ({distEntries.length} Supplier{distEntries.length !== 1 ? 's' : ''})</span>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Table Footer */}
          <div className="p-3.5 border-t border-glass-border bg-bg3/40 text-muted select-none flex justify-between items-center px-5 font-semibold">
            <span>Expired/Expiring Items: <strong className="text-text font-mono font-black">{filteredItems.length}</strong></span>
            {items.some(item => getExpiryDaysDiff(item.expiry_date) <= 0) && (
              <span className="flex items-center gap-1.5 text-xs text-red font-bold animate-pulse">
                <AlertTriangle size={13} />
                Attention required: Expired batches in stock
              </span>
            )}
          </div>

        </div>

      </div>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
        <button 
          onClick={() => queryClient.invalidateQueries({ queryKey: expiryKey })} 
          disabled={refreshing}
          className="p-3 rounded-full bg-glass-bg border border-glass-border hover:bg-bg3 text-text transition-all shadow-xl hover:scale-105 active:scale-95 cursor-pointer"
          title="Refresh Expiry List"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin text-primary' : ''} />
        </button>

        <button
          onClick={() => handleExport('csv')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-glass-bg border border-glass-border hover:bg-bg3 text-text transition-all hover:scale-105 active:scale-95 shadow-xl font-bold text-xs cursor-pointer"
        >
          <FileText size={16} className="text-primary" />
          Export CSV
        </button>

        <button
          onClick={() => handleExport('pdf')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-glass-bg border border-glass-border hover:bg-bg3 text-text transition-all hover:scale-105 active:scale-95 shadow-xl font-bold text-xs cursor-pointer"
        >
          <FileText size={16} className="text-red" />
          Export PDF
        </button>
      </div>
    </div>
  );
};

export default Expiry;
