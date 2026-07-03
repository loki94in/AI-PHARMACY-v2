import React from 'react';
import { Loader2 } from 'lucide-react';

interface InfiniteScrollStatusProps {
  totalItems: number;
  loadedCount: number;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore?: () => void;
  sentinelRef?: (node: HTMLDivElement | null) => void;
  itemName?: string;
}

export function InfiniteScrollStatus({
  totalItems,
  loadedCount,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  sentinelRef,
  itemName = 'items',
}: InfiniteScrollStatusProps) {
  return (
    <div className="flex flex-col items-center justify-center p-4 border-t border-glass-border/40 bg-white/5 select-none text-[11px] gap-3 shrink-0">
      <div className="flex items-center justify-between w-full max-w-4xl text-muted px-2 font-medium">
        <div>
          Showing <span className="font-bold text-text font-mono">{loadedCount.toLocaleString()}</span> of{' '}
          <span className="font-bold text-text font-mono">{totalItems.toLocaleString()}</span> {itemName}
        </div>
        
        {isFetching && !isFetchingNextPage && (
          <div className="flex items-center gap-1.5 text-primary">
            <Loader2 size={12} className="animate-spin" />
            <span>Syncing database...</span>
          </div>
        )}
      </div>

      {/* Sentinel observer target for infinite scroll trigger */}
      {hasNextPage && (
        <div ref={sentinelRef} className="h-6 w-full flex items-center justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted text-[11px] font-semibold">
              <Loader2 size={14} className="animate-spin text-primary" />
              <span>Loading more {itemName}...</span>
            </div>
          ) : (
            onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                className="px-4 py-1.5 rounded-lg border border-glass-border bg-white/5 hover:bg-white/10 text-muted font-bold tracking-wider hover:text-text transition-all text-[11px] uppercase"
              >
                Load More
              </button>
            )
          )}
        </div>
      )}

      {!hasNextPage && totalItems > 0 && (
        <div className="text-[11px] text-muted font-bold uppercase tracking-wider mt-1">
          ✓ All {itemName} loaded
        </div>
      )}
    </div>
  );
}
