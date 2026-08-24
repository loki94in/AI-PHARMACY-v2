import React, { useState, memo } from 'react';
import { Globe, ChevronLeft, ChevronRight, PackageSearch, Search } from 'lucide-react';
import { api, type ScheduleUnclassifiedItem } from '../../../services/api';
import { useApiQuery } from '../../../hooks/useApiQuery';
import ScheduleResearchModal from './ScheduleResearchModal';

// Module-level cache (SPA contract): revisits repaint instantly.
type QueuePayload = Awaited<ReturnType<typeof api.getScheduleDrugReviewQueue>>;
let cachedQueue: QueuePayload | null = null;

const loadQueuePage = async (q: string, page: number): Promise<QueuePayload> => {
  const payload = await api.getScheduleDrugReviewQueue({ q: q || undefined, page, limit: 50 });
  if (page === 1) cachedQueue = payload;
  return payload;
};

let queueSearchTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleQueueSearchCommit = (val: string, commit: (committed: string) => void) => {
  if (queueSearchTimer) clearTimeout(queueSearchTimer);
  queueSearchTimer = setTimeout(() => commit(val), 300);
};

interface Props {
  active: boolean;
}

const ReviewQueue: React.FC<Props> = ({ active }) => {
  const [view, setView] = useState<{ q: string; page: number }>({ q: '', page: 1 });
  const [searchInput, setSearchInput] = useState('');
  const [researchItem, setResearchItem] = useState<ScheduleUnclassifiedItem | null>(null);

  const patch = (p: Partial<{ q: string; page: number }>) => setView((v) => ({ ...v, ...p }));

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    scheduleQueueSearchCommit(val, (committed) => patch({ q: committed, page: 1 }));
  };

  const list = useApiQuery<QueuePayload>(
    ['schedule-drugs-review', view.q.trim().toLowerCase(), String(view.page)],
    () => loadQueuePage(view.q.trim().toLowerCase(), view.page),
    { initialData: cachedQueue ?? undefined, staleTime: 60_000, enabled: active },
  );

  const items = list.data?.items ?? [];

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-text uppercase tracking-wide">Review New Medicines</h2>
            <p className="text-[11px] text-muted mt-0.5">
              Master medicines the offline classifier could not place. Run the ONE-Google-search lookup per medicine,
              read the highlighted screenshot, then confirm its schedule — saved only on your click.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search new medicines by name"
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="w-full pl-8 pr-3 py-2.5 bg-bg2 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
        </div>

        <div className="bg-bg2 border border-glass-border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_150px_110px] gap-2 px-4 py-3 border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-wider">
            <span>Medicine (newest first)</span>
            <span className="hidden sm:block">Company / Packing</span>
            <span className="text-right">Schedule Lookup</span>
          </div>

          {list.isLoading && items.length === 0 && (
            <div className="py-14 text-center text-xs text-muted font-semibold">Loading review queue…</div>
          )}
          {!list.isLoading && items.length === 0 && (
            <div className="py-14 text-center">
              <PackageSearch size={28} className="mx-auto text-muted mb-2" />
              <p className="text-xs text-muted font-semibold">Nothing pending — every searched medicine is classified.</p>
            </div>
          )}

          <ul className="divide-y divide-glass-border">
            {items.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[minmax(0,1fr)_150px_110px] gap-2 px-4 py-2.5 items-center hover:bg-bg3/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text truncate">{m.name}</p>
                  {m.generic_name && <p className="text-[10px] text-muted truncate mt-0.5">{m.generic_name}</p>}
                </div>
                <span className="hidden sm:block text-[11px] text-muted truncate pr-2">
                  {[m.manufacturer, m.packaging].filter(Boolean).join(' · ') || '—'}
                </span>
                <button
                  onClick={() => setResearchItem(m)}
                  disabled={list.isFetching}
                  className="justify-self-end px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-primary/20"
                >
                  <Globe size={12} /> Research
                </button>
              </li>
            ))}
          </ul>

          {(list.data?.hasMore || view.page > 1) && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-glass-border">
              <button
                onClick={() => patch({ page: Math.max(1, view.page - 1) })}
                disabled={view.page <= 1 || list.isFetching}
                className="px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-xs font-bold text-text disabled:opacity-40 hover:bg-bg2 transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                <ChevronLeft size={13} /> Previous
              </button>
              <button
                onClick={() => patch({ page: view.page + 1 })}
                disabled={!list.data?.hasMore || list.isFetching}
                className="px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-xs font-bold text-text disabled:opacity-40 hover:bg-bg2 transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {researchItem && (
        <ScheduleResearchModal
          item={researchItem}
          onClose={() => setResearchItem(null)}
          onClassified={() => {
            setResearchItem(null);
            cachedQueue = null;
            patch({ page: 1 });
          }}
        />
      )}
    </>
  );
};

export default memo(ReviewQueue);
