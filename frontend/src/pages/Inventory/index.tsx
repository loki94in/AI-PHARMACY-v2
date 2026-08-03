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
  const [colFilters, setColFilters] = useState({
    medicine: '', id: '', batch: '', expiry: '', packs: '', loose: '', mrp: '', rack: ''
  });
  const [stockFilter, setStockFilter] = useState<string>('all');

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
      ...(col('packs') ? [{ key: 'stock_quantity', label: 'Packs' }] : []),
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
      stock_filter: stockFilter,
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
        stock_filter: filters.stock_filter,
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

  return (
    <div className="h-full flex flex-col fade-in relative gap-0">
      <div className="glass-panel flex-1 flex flex-col overflow-hidden">

        {/* ── Top Toolbar ───────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-glass-border/30 flex items-center justify-between bg-bg2/50 shrink-0">
          {/* Left: item count */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <PackageSearch size={14} className="text-primary" />
              <span className="text-xs text-muted">
                <span className="text-text font-bold font-mono">{items.length.toLocaleString()}</span>
                {totalItems > 0 && (
                  <span className="text-muted"> / <span className="font-mono font-bold text-text">{totalItems.toLocaleString()}</span></span>
                )}
                <span className="ml-1">medicines</span>
              </span>
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            {/* Stock Filter */}
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="h-7 px-2.5 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text text-[11px] font-semibold transition-all cursor-pointer focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 appearance-none"
            >
              <option value="all">All Stock</option>
              <option value="positive">In Stock (&gt;0)</option>
              <option value="zero">Zero Stock</option>
              <option value="negative">Negative Stock</option>
            </select>

            {/* Export CSV */}
            <button
              onClick={() => handleExport('csv')}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:bg-bg2 text-[11px] font-semibold transition-all"
              title="Export to CSV"
            >
              <Download size={12} />
              CSV
            </button>

            {/* Export PDF */}
            <button
              onClick={() => handleExport('pdf')}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:bg-bg2 text-[11px] font-semibold transition-all"
              title="Export to PDF"
            >
              <Download size={12} />
              PDF
            </button>

            {/* Columns toggle */}
            <div className="relative" ref={colMenuRef}>
              <button
                onClick={() => setShowColMenu(p => !p)}
                className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg border text-[11px] font-semibold transition-all ${
                  showColMenu
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-bg3 border-glass-border text-muted hover:text-text hover:bg-bg2'
                }`}
                title="Toggle columns"
              >
                <Columns3 size={12} />
                Columns
                {visibleCols.size < COL_KEYS.length && (
                  <span className="px-1 rounded-full bg-primary/20 text-primary font-mono text-[9px]">
                    {COL_KEYS.length - visibleCols.size} hidden
                  </span>
                )}
              </button>
              {showColMenu && (
                <div className="absolute right-0 top-full mt-2 z-[200] w-44 bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-glass-border/30">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">Columns</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setVisibleCols(defaultVisible);
                          localStorage.setItem('inv-page-cols', JSON.stringify([...defaultVisible]));
                        }}
                        className="text-[9px] font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        Reset
                      </button>
                      <button onClick={() => setShowColMenu(false)} className="text-muted hover:text-text">
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

        {/* ── Virtual Table ─────────────────────────────────────────────── */}
        <InfiniteTable
          totalSize={rowVirtualizer.getTotalSize()}
          containerRef={parentRef}
          header={
            <tr className="flex items-stretch w-full bg-bg2/95 border-b border-glass-border select-none">
              {/* Medicine */}
              <th className="p-2.5 text-left flex-1 align-bottom">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Medicine</span>
                  <input
                    type="text"
                    placeholder="Search..."
                    value={colFilters.medicine}
                    onChange={e => setColFilters({ ...colFilters, medicine: e.target.value })}
                    className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text font-normal placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                </div>
              </th>
              {col('id') && (
                <th className="p-2.5 text-left w-16 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">ID</span>
                    <input type="text" placeholder="..." value={colFilters.id} onChange={e => setColFilters({ ...colFilters, id: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('batch') && (
                <th className="p-2.5 text-left w-28 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Batch</span>
                    <input type="text" placeholder="..." value={colFilters.batch} onChange={e => setColFilters({ ...colFilters, batch: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('expiry') && (
                <th className="p-2.5 text-left w-24 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Expiry</span>
                    <input type="text" placeholder="MM/YY" value={colFilters.expiry} onChange={e => setColFilters({ ...colFilters, expiry: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('packs') && (
                <th className="p-2.5 text-left w-28 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Packs</span>
                    <input type="text" placeholder="..." value={colFilters.packs} onChange={e => setColFilters({ ...colFilters, packs: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('loose') && (
                <th className="p-2.5 text-left w-24 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Loose</span>
                    <input type="text" placeholder="..." value={colFilters.loose} onChange={e => setColFilters({ ...colFilters, loose: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('mrp') && (
                <th className="p-2.5 text-left w-24 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">MRP</span>
                    <input type="text" placeholder="₹..." value={colFilters.mrp} onChange={e => setColFilters({ ...colFilters, mrp: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
              {col('rack') && (
                <th className="p-2.5 text-left w-24 shrink-0 align-bottom">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/70">Rack</span>
                    <input type="text" placeholder="..." value={colFilters.rack} onChange={e => setColFilters({ ...colFilters, rack: e.target.value })} className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-md text-[11px] text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all" />
                  </div>
                </th>
              )}
            </tr>
          }
          body={
            items.length === 0 ? (
              <tr className="flex items-center justify-center p-12 text-muted text-sm w-full absolute top-0 left-0">
                <td className="flex flex-col items-center gap-3">
                  <PackageSearch size={36} className="text-muted/30" />
                  <span>No medicines found.</span>
                </td>
              </tr>
            ) : (
              rowVirtualizer.getVirtualItems().map(virtualRow => {
                const item = items[virtualRow.index];
                if (!item) return null;
                const pendingMatches = specialOrders.filter(o => {
                  const itemName = (item.name || '').toLowerCase().trim();
                  const prodName = (o.product || '').toLowerCase().trim();
                  return prodName === itemName || itemName.includes(prodName);
                });
                const hasPending = pendingMatches.length > 0;
                const stockQty = item.stock_quantity || 0;
                const stockBadge =
                  stockQty <= 0
                    ? 'bg-red/10 border-red/25 text-red'
                    : stockQty < 10
                    ? 'bg-amber/10 border-amber/25 text-amber'
                    : stockQty < 30
                    ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400'
                    : 'bg-green/10 border-green/25 text-green';

                return (
                  <VirtualRow
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    start={virtualRow.start}
                    size={virtualRow.size}
                    onClick={() => handleRowClick(item)}
                  >
                    {/* Medicine name */}
                    <td className="px-3 py-0 text-[13px] font-semibold flex-1 flex items-center gap-2 truncate min-w-0">
                      <span className="truncate text-text">{item.name || item.medicine_name || item.batch_number || 'Unnamed Item'}</span>
                      {hasPending && (
                        <span className="inline-flex items-center gap-1 bg-amber/10 border border-amber/30 text-amber px-1.5 py-0.5 rounded-md text-[10px] font-bold shrink-0">
                          ⚠ {pendingMatches[0].qty} req
                        </span>
                      )}
                    </td>
                    {col('id') && <td className="px-3 py-0 text-[12px] text-muted w-16 shrink-0 font-mono">{item.id}</td>}
                    {col('batch') && <td className="px-3 py-0 text-[12px] text-muted w-28 shrink-0 font-mono truncate">{item.batch_number || 'B-NEW'}</td>}
                    {col('expiry') && (
                      <td className="px-3 py-0 text-[12px] w-24 shrink-0">
                        <span className="text-muted font-mono">{formatExpiryToMMYY(item.expiry_date) || '12/28'}</span>
                      </td>
                    )}
                    {col('packs') && (
                      <td className="px-3 py-0 w-28 shrink-0">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-[12px] font-bold ${stockBadge}`}>
                          {stockQty}
                        </span>
                      </td>
                    )}
                    {col('loose') && (
                      <td className="px-3 py-0 w-24 shrink-0">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-[12px] font-bold ${
                          !item.loose_quantity || item.loose_quantity <= 0
                            ? 'bg-glass-bg border-glass-border text-muted/50'
                            : 'bg-primary/10 border-primary/25 text-primary'
                        }`}>
                          {item.loose_quantity || 0}
                        </span>
                      </td>
                    )}
                    {col('mrp') && (
                      <td className="px-3 py-0 text-[12px] w-24 shrink-0 font-semibold text-green">
                        ₹{item.mrp?.toFixed(2) || '0.00'}
                      </td>
                    )}
                    {col('rack') && (
                      <td className="px-3 py-0 text-[12px] text-muted w-24 shrink-0 truncate font-mono">
                        {item.rack_location || <span className="opacity-30">—</span>}
                      </td>
                    )}
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

      {/* ── Sliding Details Drawer ─────────────────────────────────────── */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-full max-w-[460px] bg-bg/97 backdrop-blur-2xl border-l border-glass-border shadow-[-12px_0_48px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-in-out z-drawer flex flex-col ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {selectedItem && (
            <>
              {/* Drawer Header */}
              <div className="px-6 py-4 border-b border-glass-border bg-bg2/60 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md inline-block mb-2">
                      {selectedItem.item_type || 'Medicine'}
                    </span>
                    {isEditing ? (
                      <input
                        type="text"
                        className="text-lg font-bold w-full px-3 py-1.5 bg-bg3 border border-glass-border rounded-xl text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                        value={editForm.name ?? ''}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="Medicine Name"
                      />
                    ) : (
                      <h4 className="text-lg font-bold text-text truncate leading-tight" title={selectedItem.name || selectedItem.medicine_name}>
                        {selectedItem.name || selectedItem.medicine_name}
                      </h4>
                    )}
                  </div>
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-colors shrink-0 mt-0.5"
                    aria-label="Close panel"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-3">
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
                            rack_location: selectedItem.rack_location,
                          });
                        }}
                        className="flex-1 py-1.5 rounded-xl border border-glass-border hover:bg-bg3 text-muted hover:text-text text-sm font-semibold transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-all flex items-center justify-center gap-2"
                      >
                        {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                        Save Changes
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 border border-glass-border hover:bg-bg2 text-muted hover:text-text text-[12px] font-semibold transition-all"
                        title="Edit batch details"
                      >
                        <Edit size={13} />
                        Edit Batch
                      </button>
                      <button
                        onClick={() => { setPanelOpen(false); setUniversalEditMedicineId(selectedItem.medicine_id || (selectedItem as any).id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky/10 border border-sky/30 hover:bg-sky/20 text-sky text-[12px] font-bold transition-all"
                        title="Edit globally across the app"
                      >
                        <Edit size={13} />
                        Universal Edit
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto">
                {/* Special Request Alert */}
                {specialOrders.filter(
                  o => o.product.toLowerCase().trim() === selectedItem.name.toLowerCase().trim() ||
                       selectedItem.name.toLowerCase().includes(o.product.toLowerCase().trim())
                ).map(o => (
                  <div key={o.id} className="mx-4 mt-4 bg-amber/10 border border-amber/30 text-amber-200 p-3.5 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="text-amber shrink-0 mt-0.5" size={16} />
                    <div>
                      <div className="font-bold text-[11px] text-amber uppercase tracking-wide">Pending Special Request</div>
                      <p className="text-[11px] text-amber-300/80 mt-1 leading-relaxed">
                        <strong>{o.requester}</strong> ({o.phone}) needs <strong>{o.qty}</strong> unit(s). Reserve when restocking.
                      </p>
                    </div>
                  </div>
                ))}

                {/* Stock Info Grid */}
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Stock Qty */}
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">Stock Packs</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setEditForm({ ...editForm, stock_quantity: Math.max(0, (editForm.stock_quantity || 0) - 1) })} className="p-1.5 rounded-lg bg-bg3 hover:bg-bg2 text-text transition-colors border border-glass-border">
                            <Minus size={13} />
                          </button>
                          <input type="number" className="flex-1 min-w-0 px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-text text-center focus:border-primary focus:outline-none transition-all" value={editForm.stock_quantity ?? ''} onChange={e => setEditForm({ ...editForm, stock_quantity: Number(e.target.value) })} />
                          <button onClick={() => setEditForm({ ...editForm, stock_quantity: (editForm.stock_quantity || 0) + 1 })} className="p-1.5 rounded-lg bg-bg3 hover:bg-bg2 text-text transition-colors border border-glass-border">
                            <Plus size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className={`text-2xl font-black ${(selectedItem.stock_quantity || 0) <= 0 ? 'text-red' : (selectedItem.stock_quantity || 0) < 10 ? 'text-amber' : 'text-green'}`}>
                          {selectedItem.stock_quantity}
                        </span>
                      )}
                    </div>

                    {/* MRP */}
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">MRP Price</span>
                      {isEditing ? (
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-sm">₹</span>
                          <input type="number" step="0.01" className="w-full pl-6 pr-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-green font-bold focus:border-primary focus:outline-none transition-all" value={editForm.mrp ?? ''} onChange={e => setEditForm({ ...editForm, mrp: Number(e.target.value) })} />
                        </div>
                      ) : (
                        <span className="text-2xl font-black text-green">₹{selectedItem.mrp?.toFixed(2) || '0.00'}</span>
                      )}
                    </div>

                    {/* Loose Units */}
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">Loose Units</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setEditForm({ ...editForm, loose_quantity: Math.max(0, (editForm.loose_quantity || 0) - 1) })} className="p-1.5 rounded-lg bg-bg3 hover:bg-bg2 text-text transition-colors border border-glass-border">
                            <Minus size={13} />
                          </button>
                          <input type="number" className="flex-1 min-w-0 px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-text text-center focus:border-primary focus:outline-none transition-all" value={editForm.loose_quantity ?? ''} onChange={e => setEditForm({ ...editForm, loose_quantity: Number(e.target.value) })} />
                          <button onClick={() => setEditForm({ ...editForm, loose_quantity: (editForm.loose_quantity || 0) + 1 })} className="p-1.5 rounded-lg bg-bg3 hover:bg-bg2 text-text transition-colors border border-glass-border">
                            <Plus size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-2xl font-black text-primary">{selectedItem.loose_quantity || 0}</span>
                      )}
                    </div>

                    {/* Rack */}
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">Rack Location</span>
                      {isEditing ? (
                        <input type="text" className="w-full px-2.5 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-primary focus:outline-none transition-all" value={editForm.rack_location ?? ''} onChange={e => setEditForm({ ...editForm, rack_location: e.target.value })} />
                      ) : (
                        <span className="text-lg font-black text-text font-mono">{selectedItem.rack_location || <span className="text-muted/40">—</span>}</span>
                      )}
                    </div>
                  </div>

                  {/* Batch + Expiry */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">Batch No.</span>
                      {isEditing ? (
                        <input type="text" className="w-full px-2.5 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-primary focus:outline-none transition-all" value={editForm.batch_number ?? ''} onChange={e => setEditForm({ ...editForm, batch_number: e.target.value })} />
                      ) : (
                        <span className="text-sm font-bold text-text font-mono">{selectedItem.batch_number || 'B-NEW'}</span>
                      )}
                    </div>
                    <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-1.5">Expiry Date</span>
                      {isEditing ? (
                        <input type="text" placeholder="MM/YY" className="w-full px-2.5 py-1.5 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-primary focus:outline-none transition-all" value={editForm.expiry_date ?? ''} onChange={e => setEditForm({ ...editForm, expiry_date: formatExpiryToMMYY(e.target.value) })} />
                      ) : (
                        <span className="text-sm font-bold text-text font-mono">{selectedItem.expiry_date || '12/28'}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Medical Profile (openFDA) */}
                <div className="px-4 pb-6 space-y-3">
                  <div className="flex items-center gap-2 border-t border-glass-border/50 pt-4">
                    <BookOpen size={13} className="text-muted" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted">Medical Profile · OpenFDA</span>
                  </div>

                  {detailsLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <RefreshCw className="animate-spin text-primary" size={22} />
                      <span className="text-sm text-muted">Fetching OpenFDA monograph…</span>
                    </div>
                  ) : enrichedData ? (
                    <div className="space-y-3 fade-in">
                      {/* Active Ingredients */}
                      <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted block mb-2">Active Ingredients</span>
                        <div className="flex flex-wrap gap-1.5">
                          {enrichedData.activeIngredients && enrichedData.activeIngredients.length > 0 ? (
                            enrichedData.activeIngredients.map((ing: string, i: number) => (
                              <span key={i} className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                {ing}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-muted italic">Generic formula not indexed.</span>
                          )}
                        </div>
                      </div>

                      {/* Indications */}
                      <div className="bg-bg2/60 border border-glass-border rounded-xl p-3.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-sky flex items-center gap-1.5 mb-2">
                          <BookOpen size={11} /> Indications &amp; Usage
                        </span>
                        <p className="text-[12px] text-muted leading-relaxed max-h-28 overflow-y-auto">{enrichedData.indications || 'Not available.'}</p>
                      </div>

                      {/* Warnings */}
                      <div className="bg-amber/5 border border-amber/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber flex items-center gap-1.5 mb-2">
                          <AlertTriangle size={11} /> Warnings
                        </span>
                        <p className="text-[12px] text-amber-300/80 leading-relaxed max-h-28 overflow-y-auto">{enrichedData.warnings || 'No active safety warnings.'}</p>
                      </div>

                      {/* Adverse Reactions */}
                      <div className="bg-red/5 border border-red/20 rounded-xl p-3.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-red flex items-center gap-1.5 mb-2">
                          <ShieldAlert size={11} /> Adverse Reactions
                        </span>
                        <p className="text-[12px] text-red-300 leading-relaxed max-h-28 overflow-y-auto">{enrichedData.sideEffects || 'No adverse reactions logged.'}</p>
                      </div>

                      {/* Source */}
                      <div className="flex items-center justify-between text-[11px] text-muted px-1">
                        <span className="flex items-center gap-1.5"><Factory size={12} /> {enrichedData.manufacturer || selectedItem.manufacturer || 'Unknown manufacturer'}</span>
                        <span className="px-2 py-0.5 rounded-full bg-green/10 text-green font-bold uppercase text-[10px] border border-green/20">
                          {enrichedData.enrichmentSource || 'FDA'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-bg2/40 border border-glass-border rounded-xl p-6 flex flex-col items-center gap-2 text-center">
                      <PackageSearch size={24} className="text-muted/30" />
                      <span className="text-sm text-muted italic">No enrichment profile found.</span>
                    </div>
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
