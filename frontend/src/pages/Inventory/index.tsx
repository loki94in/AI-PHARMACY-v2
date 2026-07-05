import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { PackageSearch, Plus, Minus, RefreshCw, X, AlertTriangle, ShieldAlert, BookOpen, Factory, Send, ChevronDown, Edit, Save, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Columns3, Check, Download } from 'lucide-react';
import { api, type InventoryItem } from '../../services/api';
// import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { createPortal } from 'react-dom';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { useRef } from 'react';
import { exportToCSV, exportToPDF } from '../../utils/export';

const UniversalMedicineEditModal = lazy(() => import('../../components/UniversalMedicineEditModal').then(m => ({ default: m.UniversalMedicineEditModal })));

const ModalSkeleton = () => (
  <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden slide-up">
      <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary animate-pulse" />
          <div className="space-y-1">
            <div className="h-5 w-48 bg-bg2/50 rounded animate-pulse" />
            <div className="h-3 w-32 bg-bg2/50 rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    </div>
  </div>
);

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

let cachedItems: any[] | null = null;
let cachedSpecialOrders: any[] | null = null;

const Inventory = () => {
  const queryClient = useQueryClient();
  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'inventory-date-range',
    defaultFrom: '',
    defaultTo: '',
  });
  const [colFilters, setColFilters] = useState({
    medicine: '', id: '', batch: '', expiry: '', packs: '', loose: '', mrp: '', rack: ''
  });

  // Column Visibility — persisted in localStorage
  const COL_KEYS = [
    { key: 'id',     label: 'ID' },
    { key: 'batch',  label: 'Batch' },
    { key: 'expiry', label: 'Expiry' },
    { key: 'packs',  label: 'Packs' },
    { key: 'loose',  label: 'Loose' },
    { key: 'mrp',    label: 'MRP' },
    { key: 'rack',   label: 'Rack' },
  ] as const;
  type ColKey = typeof COL_KEYS[number]['key'];
  const defaultVisible = new Set<ColKey>(COL_KEYS.map(c => c.key));
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => {
    try {
      const saved = localStorage.getItem('inv-page-cols');
      if (saved) {
        const arr = JSON.parse(saved) as ColKey[];
        return new Set(arr.filter(k => COL_KEYS.some(c => c.key === k)));
      }
    } catch { /* ignore */ }
    return defaultVisible;
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const toggleCol = (key: ColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('inv-page-cols', JSON.stringify([...next]));
      return next;
    });
  };
  const col = (key: ColKey) => visibleCols.has(key);

  const handleExport = (type: 'csv' | 'pdf') => {
    const columns = [
      { key: 'name', label: 'Medicine' },
      ...(col('id') ? [{ key: 'id', label: 'ID' }] : []),
      ...(col('batch') ? [{ key: 'batch_number', label: 'Batch' }] : []),
      ...(col('expiry') ? [{ key: 'expiry_date', label: 'Expiry' }] : []),
      ...(col('packs') ? [{ key: 'quantity', label: 'Packs' }] : []),
      ...(col('loose') ? [{ key: 'loose_quantity', label: 'Loose' }] : []),
      ...(col('mrp') ? [{ key: 'mrp', label: 'MRP' }] : []),
      ...(col('rack') ? [{ key: 'rack_location', label: 'Rack' }] : []),
    ];

    const formattedData = items.map(item => ({
      ...item,
      expiry_date: formatExpiryToMMYY(item.expiry_date) || '12/28'
    }));

    if (type === 'csv') {
      exportToCSV(formattedData, columns, 'inventory_stock.csv');
    } else {
      exportToPDF(formattedData, columns, 'inventory_stock.pdf', 'Inventory Stock Report');
    }
  };

  // Close col menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Enriched Details Drawer states
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [enrichedData, setEnrichedData] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<InventoryItem>>({});
  
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);

  const { data: specialOrders = [] } = useApiQuery<any[]>(
    'pos-special-orders',
    () => api.getOrders().then(data => Array.isArray(data) ? data.filter(o => o.status === 'Pending' || o.status === 'Ordered') : [])
  );

  // Debounced column filter states for server search
  const [debouncedFilters, setDebouncedFilters] = useState({
    medicine: '', id: '', batch: '', expiry: '', packs: '', loose: '', mrp: '', rack: ''
  });

  // Debounce column searches to avoid database request saturation
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedFilters({
        medicine: colFilters.medicine,
        id: colFilters.id,
        batch: colFilters.batch,
        expiry: colFilters.expiry,
        packs: colFilters.packs,
        loose: colFilters.loose,
        mrp: colFilters.mrp,
        rack: colFilters.rack
      });
    }, 300);
    return () => clearTimeout(handler);
  }, [colFilters]);

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
  } = useInfiniteScroll<InventoryItem>({
    queryKey: 'inventory-list',
    cacheKey: 'inventory-items-cache',
    serverFilters: {
      medicine: debouncedFilters.medicine,
      id: debouncedFilters.id,
      batch: debouncedFilters.batch,
      expiry: debouncedFilters.expiry,
      packs: debouncedFilters.packs,
      loose: debouncedFilters.loose,
      mrp: debouncedFilters.mrp,
      rack: debouncedFilters.rack,
      date_from: dateRangeHelper.dateRange.from,
      date_to: dateRangeHelper.dateRange.to,
    },
    fetchPage: async (pageParam, filters) => {
      const res = await api.getInventory({
        page: pageParam,
        limit: 150,
        medicine: filters.medicine,
        id: filters.id,
        batch: filters.batch,
        expiry: filters.expiry,
        packs: filters.packs,
        loose: filters.loose,
        mrp: filters.mrp,
        rack: filters.rack,
        date_from: filters.date_from,
        date_to: filters.date_to,
      });
      const data = res && res.data ? res.data : res;
      const totalPages = res && res.totalPages ? res.totalPages : 1;
      const totalItems = res && res.totalItems !== undefined ? res.totalItems : data.length;
      return {
        data,
        totalItems,
        totalPages,
      };
    },
  });

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  const loading = isFetching && items.length === 0;

  const loadInventory = useCallback(() => {
    refetch();
  }, [refetch]);



  const handleRowClick = (item: InventoryItem) => {
    setSelectedItem(item);
    setIsEditing(false);
    setEditForm({
      name: item.name || item.medicine_name,
      stock_quantity: item.stock_quantity,
      mrp: item.mrp,
      batch_number: item.batch_number,
      expiry_date: item.expiry_date,
      loose_quantity: item.loose_quantity,
      rack_location: item.rack_location
    });
    setPanelOpen(true);
    setDetailsLoading(true);
    setEnrichedData(null);

    // Call the new enrichment route we implemented in the backend
    api.getEnrichedMedicine(item.id)
      .then(res => {
        if (res.success) {
          setEnrichedData(res.enrichment);
        }
        setDetailsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setDetailsLoading(false);
      });
  };

  const handleSave = () => {
    if (!selectedItem) return;
    setIsSaving(true);
    api.updateMedicine(selectedItem.id, editForm)
      .then(() => {
        setIsSaving(false);
        setIsEditing(false);
        setSelectedItem({ ...selectedItem, ...editForm } as InventoryItem);
        loadInventory();
        queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      })
      .catch(err => {
        console.error('Failed to update item:', err);
        setIsSaving(false);
      });
  };

  const filteredItems = items;

  return (
    <div className="h-full flex flex-col fade-in relative gap-2">
      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        



        {/* Header bar — count + columns toggle */}
        <div className="px-3 py-2 border-b border-glass-border/30 flex items-center justify-between bg-bg2/40 shrink-0 select-none text-xs">
          <span className="text-muted">
            Showing <strong className="text-text font-bold font-mono">{items.length.toLocaleString()}</strong>
            {totalItems > 0 && <> of <strong className="text-text font-bold font-mono">{totalItems.toLocaleString()}</strong></>} medicines
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-[10px] font-bold transition-all cursor-pointer"
              title="Export to CSV"
            >
              <Download size={12} />
              CSV
            </button>
            <button
              onClick={() => handleExport('pdf')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-[10px] font-bold transition-all cursor-pointer"
              title="Export to PDF"
            >
              <Download size={12} />
              PDF
            </button>

            {/* Column visibility toggle */}
            <div className="relative" ref={colMenuRef}>
              <button
                onClick={() => setShowColMenu(p => !p)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                  showColMenu
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60'
                }`}
                title="Toggle column visibility"
              >
                <Columns3 size={12} />
                Columns
                {visibleCols.size < COL_KEYS.length && (
                  <span className="px-1 py-0 rounded-full bg-primary/20 text-primary font-mono">
                    {COL_KEYS.length - visibleCols.size} hidden
                  </span>
                )}
              </button>
              {showColMenu && (
                <div className="absolute right-0 top-full mt-1.5 z-[200] w-44 bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-glass-border/30">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Visible Columns</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setVisibleCols(defaultVisible);
                          localStorage.setItem('inv-page-cols', JSON.stringify([...defaultVisible]));
                        }}
                        className="text-[9px] font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        All
                      </button>
                      <button onClick={() => setShowColMenu(false)} className="text-muted hover:text-text transition-colors">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="py-1">
                    {COL_KEYS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => toggleCol(key)}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-primary/5 transition-colors text-left"
                      >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                          visibleCols.has(key)
                            ? 'bg-primary border-primary'
                            : 'bg-transparent border-glass-border/60'
                        }`}>
                          {visibleCols.has(key) && <Check size={9} className="text-white" />}
                        </span>
                        <span className={`text-[11px] font-semibold ${ visibleCols.has(key) ? 'text-text' : 'text-muted/60' }`}>
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

        <InfiniteTable
          totalSize={rowVirtualizer.getTotalSize()}
          containerRef={parentRef}
          header={
            <tr className="flex items-center w-full bg-bg2/95 border-b border-glass-border select-none">
              {/* Medicine — always visible, has search */}
              <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider flex-1 align-middle">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted">Medicine</span>
                  <input
                    type="text"
                    placeholder="Filter medicine..."
                    value={colFilters.medicine}
                    onChange={e => setColFilters({ ...colFilters, medicine: e.target.value })}
                    className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                </div>
              </th>
              {col('id') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-16 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">ID</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.id}
                      onChange={e => setColFilters({ ...colFilters, id: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('batch') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Batch</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.batch}
                      onChange={e => setColFilters({ ...colFilters, batch: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('expiry') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Expiry</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.expiry}
                      onChange={e => setColFilters({ ...colFilters, expiry: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('packs') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Packs</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.packs}
                      onChange={e => setColFilters({ ...colFilters, packs: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('loose') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Loose</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.loose}
                      onChange={e => setColFilters({ ...colFilters, loose: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('mrp') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">MRP</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.mrp}
                      onChange={e => setColFilters({ ...colFilters, mrp: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
              {col('rack') && (
                <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider w-24 shrink-0 align-middle">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Rack</span>
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={colFilters.rack}
                      onChange={e => setColFilters({ ...colFilters, rack: e.target.value })}
                      className="w-full px-2 py-0.5 bg-bg3 border border-glass-border rounded text-[10px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </th>
              )}
            </tr>
          }
          body={
            items.length === 0 ? (
              <tr className="flex items-center justify-center p-8 text-muted text-sm w-full absolute top-0 left-0">
                <td>No medicines found.</td>
              </tr>
            ) : (
              rowVirtualizer.getVirtualItems().map(virtualRow => {
                const item = items[virtualRow.index];
                if (!item) return null;
                const pendingMatches = specialOrders.filter(
                  o => {
                    const itemName = (item.name || '').toLowerCase().trim();
                    const prodName = (o.product || '').toLowerCase().trim();
                    return prodName === itemName || itemName.includes(prodName);
                  }
                );
                const hasPending = pendingMatches.length > 0;
                return (
                  <VirtualRow
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    start={virtualRow.start}
                    size={virtualRow.size}
                    onClick={() => handleRowClick(item)}
                  >
                    {/* Medicine — always visible */}
                    <td className="p-4 text-sm font-semibold flex-1 flex items-center gap-2 truncate">
                      <span className="truncate">{item.name}</span>
                      {hasPending && (
                        <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 px-1.5 py-0.5 rounded text-[10px] font-bold animate-pulse shrink-0">
                          ⚠️ Requested ({pendingMatches[0].qty})
                        </span>
                      )}
                    </td>
                    {col('id') && <td className="p-4 text-sm text-muted w-16 shrink-0">{item.id}</td>}
                    {col('batch') && <td className="p-4 text-sm w-24 shrink-0 truncate">{item.batch_number || 'B-NEW'}</td>}
                    {col('expiry') && <td className="p-4 text-sm w-24 shrink-0">{formatExpiryToMMYY(item.expiry_date) || '12/28'}</td>}
                    {col('packs') && (
                      <td className="p-4 text-sm w-24 shrink-0">
                        <div className="flex items-center gap-1.5 animate-in fade-in" title="Full Packs Available">
                          <span className={`px-2 py-1 rounded-md border text-xs font-bold shadow-sm ${item.stock_quantity <= 0 ? 'bg-red/10 border-red/20 text-red' : item.stock_quantity < 20 ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-green/10 border-green/20 text-green'}`}>
                            {item.stock_quantity || 0}
                          </span>
                        </div>
                      </td>
                    )}
                    {col('loose') && (
                      <td className="p-4 text-sm w-24 shrink-0">
                        <div className="flex items-center gap-1.5 animate-in fade-in" title="Loose Units Available">
                          <span className={`px-2 py-1 rounded-md border text-xs font-bold shadow-sm ${!item.loose_quantity || item.loose_quantity <= 0 ? 'bg-white/5 border-glass-border text-muted opacity-50' : 'bg-primary/10 border-primary/20 text-primary'}`}>
                            {item.loose_quantity || 0}
                          </span>
                        </div>
                      </td>
                    )}
                    {col('mrp') && <td className="p-4 text-sm w-24 shrink-0">₹{item.mrp?.toFixed(2) || '0.00'}</td>}
                    {col('rack') && <td className="p-4 text-sm text-muted w-24 shrink-0 truncate">{item.rack_location || '-'}</td>}
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
              itemName="medicines"
            />
          }
        />
      </div>

      {/* Sliding Details Drawer */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-[450px] bg-[#121214]/95 backdrop-blur-xl border-l border-glass-border shadow-[-8px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-in-out z-[999999] flex flex-col ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {selectedItem && (
            <>
              {/* Header */}
              <div className="p-6 border-b border-glass-border flex justify-between items-center bg-white/5">
                <div className="min-w-0 flex-1 mr-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary px-2 py-0.5 rounded bg-primary/10 inline-block mb-1">
                    {selectedItem.item_type || 'Medicine'} Details
                  </span>
                  {isEditing ? (
                    <input 
                      type="text" 
                      className="text-xl font-bold mt-1 w-full px-2 py-1 bg-black/40 border border-glass-border rounded-lg text-white focus:border-primary focus:outline-none transition-all"
                      value={editForm.name ?? ''} 
                      onChange={e => setEditForm({...editForm, name: e.target.value})} 
                      placeholder="Medicine Name"
                    />
                  ) : (
                    <h4 className="text-xl font-bold mt-1 text-white truncate" title={selectedItem.name || selectedItem.medicine_name}>{selectedItem.name || selectedItem.medicine_name}</h4>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {isEditing ? (
                    <>
                      <button 
                        onClick={() => {
                          setIsEditing(false);
                          setEditForm({
                            name: selectedItem.name || selectedItem.medicine_name,
                            stock_quantity: selectedItem.stock_quantity,
                            mrp: selectedItem.mrp,
                            batch_number: selectedItem.batch_number,
                            expiry_date: selectedItem.expiry_date,
                            loose_quantity: selectedItem.loose_quantity,
                            rack_location: selectedItem.rack_location
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-glass-border hover:bg-white/10 text-muted hover:text-white text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold transition-colors flex items-center gap-2"
                      >
                        {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                        Save
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-glass-border hover:bg-white/10 text-muted hover:text-white text-sm font-medium transition-colors flex items-center gap-2"
                        title="Edit this specific batch details"
                      >
                        <Edit size={14} />
                        Edit Batch
                      </button>
                      <button 
                        onClick={() => setUniversalEditMedicineId(selectedItem.medicine_id || (selectedItem as any).id)}
                        className="px-3 py-1.5 rounded-lg bg-sky/10 border border-sky/30 hover:bg-sky/20 text-sky text-sm font-bold transition-colors flex items-center gap-2"
                        title="Edit global medicine details universally across the app"
                      >
                        <Edit size={14} />
                        Universal Edit
                      </button>
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setPanelOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-muted hover:text-white transition-colors ml-2"
                  aria-label="Close panel"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Special Request Alert Banner */}
                {specialOrders.filter(
                  o => o.product.toLowerCase().trim() === selectedItem.name.toLowerCase().trim() ||
                       selectedItem.name.toLowerCase().includes(o.product.toLowerCase().trim())
                ).map(o => (
                  <div key={o.id} className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                    <div>
                      <div className="font-bold text-xs">Pending Out-of-Stock Special Request</div>
                      <p className="text-[11px] text-amber-300/80 mt-1">
                        Customer <strong>{o.requester}</strong> ({o.phone}) requested <strong>{o.qty}</strong> unit(s) of this item. Please reserve/reconcile this stock when receiving purchases.
                      </p>
                    </div>
                  </div>
                ))}

                {/* Batch Info Card */}
                <div className="grid grid-cols-2 gap-4 bg-white/5 p-4 rounded-xl border border-glass-border">
                  <div>
                    <span className="text-xs text-muted block uppercase font-semibold">Stock Quantity</span>
                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-1">
                        <button 
                          onClick={() => setEditForm({...editForm, stock_quantity: Math.max(0, (editForm.stock_quantity || 0) - 1)})}
                          className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <input 
                          type="number" 
                          className="w-full px-2 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-white text-center focus:border-primary focus:outline-none transition-all"
                          value={editForm.stock_quantity ?? ''} 
                          onChange={e => setEditForm({...editForm, stock_quantity: Number(e.target.value)})} 
                        />
                        <button 
                          onClick={() => setEditForm({...editForm, stock_quantity: (editForm.stock_quantity || 0) + 1})}
                          className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-white mt-0.5 block">{selectedItem.stock_quantity} packs</span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-muted block uppercase font-semibold">MRP Price</span>
                    {isEditing ? (
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">₹</span>
                        <input 
                          type="number" 
                          step="0.01"
                          className="w-full pl-7 pr-3 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-green font-bold focus:border-primary focus:outline-none transition-all"
                          value={editForm.mrp ?? ''} 
                          onChange={e => setEditForm({...editForm, mrp: Number(e.target.value)})} 
                        />
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-green mt-0.5 block">₹{selectedItem.mrp?.toFixed(2) || '0.00'}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-muted block uppercase font-semibold">Loose Units</span>
                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-1">
                        <button 
                          onClick={() => setEditForm({...editForm, loose_quantity: Math.max(0, (editForm.loose_quantity || 0) - 1)})}
                          className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <input 
                          type="number" 
                          className="w-full px-2 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-white text-center focus:border-primary focus:outline-none transition-all"
                          value={editForm.loose_quantity ?? ''} 
                          onChange={e => setEditForm({...editForm, loose_quantity: Number(e.target.value)})} 
                        />
                        <button 
                          onClick={() => setEditForm({...editForm, loose_quantity: (editForm.loose_quantity || 0) + 1})}
                          className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm font-bold text-white mt-0.5 block">{selectedItem.loose_quantity || 0}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-muted block uppercase font-semibold">Rack</span>
                    {isEditing ? (
                      <input 
                        type="text" 
                        className="mt-1 w-full px-3 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-white focus:border-primary focus:outline-none transition-all"
                        value={editForm.rack_location ?? ''} 
                        onChange={e => setEditForm({...editForm, rack_location: e.target.value})} 
                      />
                    ) : (
                      <span className="text-sm font-bold text-white mt-0.5 block">{selectedItem.rack_location || '-'}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-muted block uppercase font-semibold">Batch Number</span>
                    {isEditing ? (
                      <input 
                        type="text" 
                        className="mt-1 w-full px-3 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-white focus:border-primary focus:outline-none transition-all"
                        value={editForm.batch_number ?? ''} 
                        onChange={e => setEditForm({...editForm, batch_number: e.target.value})} 
                      />
                    ) : (
                      <span className="text-sm font-bold text-white mt-0.5 block">{selectedItem.batch_number || 'B-NEW'}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-muted block uppercase font-semibold">Expiry Date</span>
                    {isEditing ? (
                      <input 
                        type="text" 
                        placeholder="MM/YY"
                        className="mt-1 w-full px-3 py-1.5 bg-black/40 border border-glass-border rounded-lg text-sm text-white focus:border-primary focus:outline-none transition-all"
                        value={editForm.expiry_date ?? ''} 
                        onChange={e => setEditForm({...editForm, expiry_date: formatExpiryToMMYY(e.target.value)})} 
                      />
                    ) : (
                      <span className="text-sm font-bold text-white mt-0.5 block">{selectedItem.expiry_date || '12/28'}</span>
                    )}
                  </div>
                </div>

                {/* Enrichment Section */}
                <div className="space-y-5">
                  <h5 className="text-xs font-bold uppercase tracking-widest text-muted border-b border-glass-border pb-2">Medical Profile (openFDA)</h5>

                  {detailsLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-3">
                      <RefreshCw className="animate-spin text-primary" size={24} />
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
                              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
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
                          <BookOpen size={14} className="text-sky" /> Indications & Usage
                        </span>
                        <div className="bg-white/5 p-3 rounded-lg border border-glass-border text-sm text-muted leading-relaxed max-h-36 overflow-y-auto">
                          {enrichedData.indications || 'Not available.'}
                        </div>
                      </div>

                      {/* Warnings */}
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-amber">
                          <AlertTriangle size={14} /> Warnings & Precautions
                        </span>
                        <div className="bg-amber/5 p-3 rounded-lg border border-amber/20 text-sm text-amber-300 leading-relaxed max-h-36 overflow-y-auto">
                          {enrichedData.warnings || 'No active drug safety warnings.'}
                        </div>
                      </div>

                      {/* Side Effects */}
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-red">
                          <ShieldAlert size={14} /> Adverse Reactions
                        </span>
                        <div className="bg-red/5 p-3 rounded-lg border border-red/20 text-sm text-red-300 leading-relaxed max-h-36 overflow-y-auto">
                          {enrichedData.sideEffects || 'No common adverse reactions logged.'}
                        </div>
                      </div>

                      {/* Source and Manufacturer */}
                      <div className="pt-2 flex justify-between items-center text-xs text-muted">
                        <span className="flex items-center gap-1"><Factory size={12} /> Mfg: {enrichedData.manufacturer || selectedItem.manufacturer || 'Unknown'}</span>
                        <span className="px-2 py-0.5 rounded bg-green/10 text-green font-bold uppercase text-[10px] tracking-wide">
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
        <Suspense fallback={<ModalSkeleton />}>
          <UniversalMedicineEditModal 
            medicineId={universalEditMedicineId} 
            onClose={() => setUniversalEditMedicineId(null)} 
            onSave={() => {
              loadInventory();
              if (selectedItem) {
                // Optionally reload enriched data
                setPanelOpen(false);
                setTimeout(() => handleRowClick(selectedItem), 300);
              }
            }} 
          />
        </Suspense>
      )}

    </div>
  );
};

export default Inventory;
