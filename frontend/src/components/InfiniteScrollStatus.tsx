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
  className?: string;
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
  className = '',
}: InfiniteScrollStatusProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-1.5 px-3 border-t border-glass-border/30 bg-bg2/40 select-none text-xs gap-1 shrink-0 ${className}`}>
      <div className="flex items-center justify-between w-full text-muted font-medium">
        <div className="text-[11px]">
          Showing <span className="font-bold text-text font-mono">{loadedCount.toLocaleString()}</span> of{' '}
          <span className="font-bold text-text font-mono">{totalItems.toLocaleString()}</span> {itemName}
        </div>
        
        {isFetching && !isFetchingNextPage && (
          <div className="flex items-center gap-1.5 text-primary text-[11px]">
            <Loader2 size={11} className="animate-spin" />
            <span>Syncing...</span>
          </div>
        )}
      </div>

      {/* Sentinel observer target for infinite scroll trigger */}
      {hasNextPage && (
        <div ref={sentinelRef} className="h-4 w-full flex items-center justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-1.5 text-muted text-[10px] font-semibold">
              <Loader2 size={12} className="animate-spin text-primary" />
              <span>Loading more {itemName}...</span>
            </div>
          ) : (
            onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                className="px-3 py-0.5 rounded border border-glass-border bg-bg3 hover:bg-bg2 text-muted font-bold tracking-wider hover:text-text transition-all text-[10px] uppercase cursor-pointer"
              >
                Load More
              </button>
            )
          )}
        </div>
      )}

      {!hasNextPage && totalItems > 0 && (
        <div className="text-[10px] text-muted font-bold uppercase tracking-wider">
          ✓ All {itemName} loaded
        </div>
      )}
    </div>
  );
}
