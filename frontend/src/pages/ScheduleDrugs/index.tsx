import React, { useState, memo } from 'react';
import { ShieldCheck, Search, FileText, Pill, Ban, PackageSearch } from 'lucide-react';
import { api, type ScheduleDrugItem } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { formatINR, formatCount } from '../../utils/currency';
import ReviewQueue from './ReviewQueue';

// Module-level caches (SPA contract): revisits paint instantly, refreshes are silent.
interface ScheduleSummary {
  success: boolean;
  h1: number;
  h: number;
  x: number;
  total: number;
}
interface ListPayload {
  success: boolean;
  page: number;
  limit: number;
  hasMore: boolean;
  items: ScheduleDrugItem[];
}
let cachedSummary: ScheduleSummary | null = null;
const listCache = new Map<string, ListPayload>();

type SchedFilter = 'ALL' | 'H1' | 'H' | 'X';
type StockFilter = '' | 'in' | 'out';

interface View {
  type: SchedFilter;
  q: string;
  stock: StockFilter;
  page: number;
}

const PAGE_SIZE = 50;

// Module-level loaders/helpers (react-compiler purity: no render-scope mutations)
const loadSummary = async (): Promise<ScheduleSummary> => {
  const s = await api.getScheduleDrugSummary();
  if (!cachedSummary) cachedSummary = s;
  return s;
};

const listKey = (v: Pick<View, 'type' | 'q' | 'stock'>) => `${v.type}|${v.q.trim().toLowerCase()}|${v.stock}`;

const loadListPage = async (v: View): Promise<ListPayload> => {
  const payload = await api.getScheduleDrugs({
    type: v.type === 'ALL' ? undefined : v.type,
    q: v.q.trim() || undefined,
    stock: v.stock || undefined,
    page: v.page,
    limit: PAGE_SIZE,
  });
  listCache.set(listKey(v), payload);
  return payload;
};

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleSearchCommit = (val: string, commit: (committed: string) => void) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => commit(val), 300);
};

const SCHEDULE_BADGE: Record<string, string> = {
  H1: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  H: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  X: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

const normalizeBadgeType = (raw: string | null): string =>
  String(raw || '').trim().toUpperCase().replace(/^SCHEDULE\s*/, '');

const SummaryChip = memo(({
  active,
  label,
  count,
  icon,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number | null;
  icon: React.ReactNode;
  tone: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all cursor-pointer ${
      active
        ? `${tone}`
        : 'bg-bg2 border-glass-border hover:bg-bg3'
    }`}
  >
    <span className="shrink-0">{icon}</span>
    <span className="text-left">
      <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      <span className="block text-lg font-black leading-none mt-0.5">
        {count === null ? '—' : formatCount(count)}
      </span>
    </span>
  </button>
));

const ScheduleDrugsPage: React.FC = () => {
  const isActive = usePageActive();
  const [tab, setTab] = useState<'classified' | 'review'>('classified');
  const [view, setView] = useState<View>({ type: 'ALL', q: '', stock: '', page: 1 });
  const [searchInput, setSearchInput] = useState('');

  const patch = (p: Partial<View>) => setView((v) => ({ ...v, ...p }));

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    scheduleSearchCommit(val, (committed) => patch({ q: committed, page: 1 }));
  };

  const summary = useApiQuery<ScheduleSummary>(
    ['schedule-drugs-summary'],
    loadSummary,
    { initialData: cachedSummary ?? undefined, staleTime: 60_000, enabled: isActive },
  );

  const key = listKey(view);
  const list = useApiQuery<ListPayload>(
    ['schedule-drugs-list', view.type, view.q.trim().toLowerCase(), view.stock, String(view.page)],
    () => loadListPage(view),
    { initialData: listCache.get(key), staleTime: 60_000, enabled: isActive },
  );

  const items = list.data?.items ?? [];
  const hasMore = list.data?.hasMore ?? false;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-glass-border pb-5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-text tracking-tight">Schedule Medicine Hub</h1>
            <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              D&amp;C Rules 1945
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Every medicine in your master database classified against India&apos;s official drug schedules —
            Schedule H1 (GSR 588(E)/2013 · 46 drugs), Schedule X and Schedule H — in one place.
          </p>
        </div>
      </div>

      {/* Mode tabs: browse classified / review new medicines */}
      <div className="flex items-center gap-2">
        {([
          ['classified', 'Classified Medicines'],
          ['review', 'Review New Medicines'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              tab === id
                ? 'bg-primary/15 border-primary/40 text-text'
                : 'bg-bg2 border-glass-border text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'review' ? (
        <ReviewQueue active={isActive} />
      ) : (
      <>
      {/* Schedule category chips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryChip
          active={view.type === 'ALL'}
          label="All Scheduled"
          count={summary.data ? summary.data.total : null}
          icon={<ShieldCheck size={22} className="text-emerald-400" />}
          tone="bg-emerald-500/10 border border-emerald-500/40 text-text"
          onClick={() => patch({ type: 'ALL', page: 1 })}
        />
        <SummaryChip
          active={view.type === 'H1'}
          label="Schedule H1"
          count={summary.data ? summary.data.h1 : null}
          icon={<FileText size={22} className="text-amber-400" />}
          tone="bg-amber-500/10 border border-amber-500/40 text-text"
          onClick={() => patch({ type: 'H1', page: 1 })}
        />
        <SummaryChip
          active={view.type === 'H'}
          label="Schedule H"
          count={summary.data ? summary.data.h : null}
          icon={<Pill size={22} className="text-sky-400" />}
          tone="bg-sky-500/10 border border-sky-500/40 text-text"
          onClick={() => patch({ type: 'H', page: 1 })}
        />
        <SummaryChip
          active={view.type === 'X'}
          label="Schedule X"
          count={summary.data ? summary.data.x : null}
          icon={<Ban size={22} className="text-rose-400" />}
          tone="bg-rose-500/10 border border-rose-500/40 text-text"
          onClick={() => patch({ type: 'X', page: 1 })}
        />
      </div>

      {/* Filters */}
      <div className="p-4 bg-bg2 border border-glass-border rounded-2xl flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search scheduled medicines by name (min 2 letters)"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-full pl-8 pr-3 py-2.5 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
          />
        </div>
        <select
          value={view.stock}
          onChange={(e) => patch({ stock: e.target.value as StockFilter, page: 1 })}
          className="px-3 py-2.5 bg-bg3 border border-glass-border rounded-xl text-xs font-bold text-text focus:outline-none focus:border-primary"
        >
          <option value="">Any Stock</option>
          <option value="in">In Stock Only</option>
          <option value="out">Out of Stock</option>
        </select>
        <span className="text-[10px] text-muted font-bold uppercase tracking-wider whitespace-nowrap">
          Page {view.page}
        </span>
      </div>

      {/* List */}
      <div className="bg-bg2 border border-glass-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_100px] sm:grid-cols-[minmax(0,1fr)_180px_110px_100px_120px] gap-2 px-4 py-3 border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-wider">
          <span>Medicine</span>
          <span className="hidden sm:block">Manufacturer</span>
          <span>Schedule</span>
          <span>Stock</span>
          <span className="text-right">MRP</span>
        </div>

        {list.isLoading && items.length === 0 && (
          <div className="py-14 text-center text-xs text-muted font-semibold">Loading scheduled medicines…</div>
        )}

        {!list.isLoading && items.length === 0 && (
          <div className="py-14 text-center">
            <PackageSearch size={28} className="mx-auto text-muted mb-2" />
            <p className="text-xs text-muted font-semibold">No scheduled medicines match this filter.</p>
          </div>
        )}

        <ul className="divide-y divide-glass-border">
          {items.map((m) => {
            const sched = normalizeBadgeType(m.schedule_type);
            const stock = m.stock ?? 0;
            return (
              <li
                key={m.id}
                className="grid grid-cols-[minmax(0,1fr)_110px_90px_100px] sm:grid-cols-[minmax(0,1fr)_180px_110px_100px_120px] gap-2 px-4 py-2.5 items-center hover:bg-bg3/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text truncate">{m.name}</p>
                  {m.generic_name && (
                    <p className="text-[10px] text-muted truncate mt-0.5">{m.generic_name}</p>
                  )}
                </div>
                <span className="hidden sm:block text-[11px] text-muted truncate pr-2">
                  {m.manufacturer || '—'}
                </span>
                <span
                  className={`justify-self-start text-[9px] font-black px-2 py-1 rounded-full border uppercase tracking-wide ${SCHEDULE_BADGE[sched] || 'bg-bg3 text-muted border-glass-border'}`}
                >
                  {sched || '?'}
                </span>
                <span className={`text-[11px] font-bold ${stock > 0 ? 'text-emerald-400' : 'text-muted'}`}>
                  {stock > 0 ? `✓ ${formatCount(stock)}` : 'Out'}
                </span>
                <span className="text-right text-[11px] font-bold text-text">
                  {m.mrp != null && m.mrp > 0 ? `₹${formatINR(m.mrp)}` : '—'}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Pagination */}
        {(hasMore || view.page > 1) && items.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-glass-border">
            <button
              onClick={() => patch({ page: Math.max(1, view.page - 1) })}
              disabled={view.page <= 1 || list.isFetching}
              className="px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-xs font-bold text-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg2 transition-all cursor-pointer"
            >
              ← Previous
            </button>
            <button
              onClick={() => patch({ page: view.page + 1 })}
              disabled={!hasMore || list.isFetching}
              className="px-4 py-2 bg-primary hover:bg-primary/90 rounded-xl text-xs font-bold text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted leading-relaxed max-w-3xl">
        Classification source: Drugs and Cosmetics Rules, 1945 — Schedule H1 per Gazette Notification GSR 588(E)
        dated 30-08-2013 (46 drugs incl. anti-TB &amp; habit-forming drugs), Schedule X appendix (habit-forming
        substances), and the consolidated Schedule H list (Drugs &amp; Cosmetics 2nd Amendment Rules, 2006,
        including its Antibiotics class entry). Molecules outside these official lists stay unclassified — nothing
        is guessed. Sales of H1/H/X items auto-feed the H1 Compliance register at billing time.
      </p>
      </>
      )}
    </div>
  );
};

export default ScheduleDrugsPage;
