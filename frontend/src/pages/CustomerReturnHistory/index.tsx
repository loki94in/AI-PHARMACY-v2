import React, { useState, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import { History, Search, ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { InfiniteTable } from '../../components/InfiniteTable';
import { VirtualRow } from '../../components/VirtualRow';
import { InfiniteScrollStatus } from '../../components/InfiniteScrollStatus';
import { exportToCSV, exportToPDF } from '../../utils/export';

export default function CustomerReturnHistory() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const dateRangeHelper = usePersistedDateRange({
    storageKey: 'customer-returns-date-range',
    defaultFrom: '',
    defaultTo: '',
  });

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
    queryKey: 'customer-returns-history-list',
    cacheKey: 'customer-returns-history-cache',
    serverFilters: {
      search: searchQuery,
      start: dateRangeHelper.dateRange.from,
      end: dateRangeHelper.dateRange.to,
    },
    fetchPage: async (pageParam, filters) => {
      const response = await api.getCustomerReturnsHistory({
        page: pageParam,
        limit: 50,
        search: filters.search || undefined,
        start: filters.start || undefined,
        end: filters.end || undefined,
      });
      if (response && response.data) {
        return {
          data: response.data || [],
          totalItems: response.totalItems || 0,
          totalPages: response.totalPages || 1,
        };
      } else {
        const list = Array.isArray(response) ? response : [];
        return {
          data: list,
          totalItems: list.length,
          totalPages: 1,
        };
      }
    },
  });

  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  const handleExport = (type: 'csv' | 'pdf') => {
    const columns = [
      { key: 'return_no', label: 'Return No' },
      { key: 'date_formatted', label: 'Date' },
      { key: 'original_invoice_no', label: 'Original Invoice' },
      { key: 'items_formatted', label: 'Items Returned' },
      { key: 'refund_formatted', label: 'Refund Amount' },
    ];

    const formattedData = items.map(row => ({
      ...row,
      date_formatted: new Date(row.date).toLocaleString(),
      items_formatted: (row.items || []).map((i: any) => `${i.quantity}x ${i.medicine_name}`).join('; '),
      refund_formatted: `₹${(row.total_amount || 0).toFixed(2)}`,
    }));

    if (type === 'csv') {
      exportToCSV(formattedData, columns, 'customer_return_history.csv');
    } else {
      exportToPDF(formattedData, columns, 'customer_return_history.pdf', 'Customer Return History Report');
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-end shrink-0">
        <div>
          <button 
            onClick={() => navigate('/customer-returns')}
            className="text-muted hover:text-text text-sm flex items-center gap-1 mb-2 transition-colors cursor-pointer bg-transparent border-0"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Returns
          </button>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <History className="w-6 h-6 text-sky" />
            Customer Return History
          </h1>
        </div>
      </div>

      {/* Top Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center bg-white/5 border border-white/10 p-4 rounded-xl shrink-0">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by Invoice No, Return No, Medicine, Reason..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-black/20 border border-glass-border rounded-xl text-sm text-white placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        
        {/* Date Filters */}
        <div className="flex items-center gap-2 border-r border-glass-border/30 pr-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted font-black uppercase">From</span>
            <input
              type="date"
              value={dateRangeHelper.dateRange.from}
              onChange={e => dateRangeHelper.handleFromChange(e.target.value)}
              className="px-2.5 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs font-semibold text-text focus:outline-none focus:border-primary/50 hover:border-glass-border/60 transition-colors w-32"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted font-black uppercase">To</span>
            <input
              type="date"
              value={dateRangeHelper.dateRange.to}
              onChange={e => dateRangeHelper.handleToChange(e.target.value)}
              className="px-2.5 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs font-semibold text-text focus:outline-none focus:border-primary/50 hover:border-glass-border/60 transition-colors w-32"
            />
          </div>
          {(dateRangeHelper.dateRange.from || dateRangeHelper.dateRange.to) && (
            <button
              onClick={() => dateRangeHelper.clearFilters()}
              className="px-2.5 py-1.5 rounded bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs font-bold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* CSV/PDF Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-xs font-bold transition-all cursor-pointer"
            title="Export to CSV"
          >
            <Download size={13} />
            CSV
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-bg3 border-glass-border text-muted hover:text-text hover:border-glass-border/60 text-xs font-bold transition-all cursor-pointer"
            title="Export to PDF"
          >
            <Download size={13} />
            PDF
          </button>
        </div>
      </div>

      <div className="premium-card p-0 flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {isFetching && items.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <div className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin text-primary" />
              Loading history...
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <History className="w-8 h-8 text-muted" />
            </div>
            <h3 className="text-lg font-medium text-text mb-1">No Returns Yet</h3>
            <p className="text-sm text-muted">Customer returns will appear here.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <InfiniteTable
              totalSize={rowVirtualizer.getTotalSize()}
              containerRef={parentRef}
              className="border-0 bg-transparent text-sm"
              header={
                <tr className="flex items-center min-w-[900px] bg-white/5 border-b border-white/10 text-muted font-medium select-none align-top">
                  <th className="w-32 shrink-0 p-4">Return No</th>
                  <th className="w-48 shrink-0 p-4">Date</th>
                  <th className="w-36 shrink-0 p-4">Original Invoice</th>
                  <th className="flex-1 min-w-[250px] p-4">Items Returned</th>
                  <th className="w-32 shrink-0 text-right p-4">Refund Amount</th>
                </tr>
              }
              body={
                rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = items[virtualRow.index];
                  if (!row) return null;
                  return (
                    <VirtualRow
                      key={virtualRow.key}
                      ref={rowVirtualizer.measureElement}
                      start={virtualRow.start}
                      size={virtualRow.size}
                      className="min-w-[900px] border-b border-white/5 hover:bg-white/5 transition-colors items-center flex"
                    >
                      <td className="w-32 shrink-0 p-4 font-medium text-text">{row.return_no}</td>
                      <td className="w-48 shrink-0 p-4 text-muted">
                        {new Date(row.date).toLocaleDateString()}
                        <div className="text-xs text-muted/50 mt-0.5">
                          {new Date(row.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="w-36 shrink-0 p-4 text-sky">{row.original_invoice_no}</td>
                      <td className="flex-1 min-w-[250px] p-4">
                        <div className="text-xs space-y-1">
                          {row.items?.map((i: any, idx: number) => (
                            <div key={idx} className="text-muted truncate">
                              {i.quantity}x {i.medicine_name}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="w-32 shrink-0 p-4 text-right font-medium text-emerald">
                        ₹{row.total_amount?.toFixed(2)}
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
              itemName="returns"
            />
          </div>
        )}
      </div>
    </div>
  );
}
