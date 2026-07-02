import { useState, useEffect, useCallback } from 'react';
import { Beaker, Play, CheckCircle, AlertTriangle, XCircle, Save, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { api } from '../../services/api';

interface EnrichmentStatus {
  total: number;
  enriched: number;
  needsReview: number;
  unmatched: number;
  pending: number;
  isRunning: boolean;
}

interface QueueItem {
  id: number;
  name: string;
  manufacturer: string;
  api_reference: string | null;
  enrichment_status: string;
  enrichment_confidence: number;
  suggested_composition?: string;
  ref_name?: string;
}

// Module-level cache for instant re-mount
let cachedStatus: EnrichmentStatus | null = null;
let cachedQueue: QueueItem[] = [];

export default function CompositionQueue() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(cachedStatus);
  const [queue, setQueue] = useState<QueueItem[]>(cachedQueue);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editValues, setEditValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.getEnrichmentStatus();
      cachedStatus = data;
      setStatus(data);
    } catch (err) {
      console.error('Failed to load enrichment status:', err);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEnrichmentQueue(page, 50, filter);
      setQueue(data.data || []);
      cachedQueue = data.data || [];
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.totalItems || 0);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Poll status while enrichment is running
  useEffect(() => {
    if (!status?.isRunning) return;
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [status?.isRunning, loadStatus]);

  const handleStartEnrichment = async () => {
    setStarting(true);
    try {
      await api.startEnrichment();
      // Poll status immediately
      setTimeout(loadStatus, 1000);
    } catch (err) {
      console.error('Failed to start enrichment:', err);
    } finally {
      setStarting(false);
    }
  };

  const handleSave = async (id: number) => {
    const composition = editValues[id];
    if (!composition?.trim()) return;

    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await api.updateComposition(id, composition.trim());
      // Remove from queue
      setQueue(prev => prev.filter(item => item.id !== id));
      setTotalItems(prev => prev - 1);
      loadStatus();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleAcceptSuggestion = async (item: QueueItem) => {
    if (!item.suggested_composition) return;
    setSaving(prev => ({ ...prev, [item.id]: true }));
    try {
      await api.updateComposition(item.id, item.suggested_composition);
      setQueue(prev => prev.filter(q => q.id !== item.id));
      setTotalItems(prev => prev - 1);
      loadStatus();
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
    } finally {
      setSaving(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const enrichedPct = status ? Math.round((status.enriched / Math.max(status.total, 1)) * 100) : 0;

  return (
    <div className="h-full flex flex-col fade-in relative px-4 pb-4 pt-2 gap-3">

      {/* Status Dashboard */}
      <div className="glass-panel p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
              <Beaker size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text">Composition Enrichment</h2>
              <p className="text-xs text-muted">Auto-fill medicine compositions from reference database</p>
            </div>
          </div>

          <button
            onClick={handleStartEnrichment}
            disabled={starting || status?.isRunning}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold text-sm flex items-center gap-2 hover:from-violet-500 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
          >
            {status?.isRunning ? (
              <><Loader2 size={16} className="animate-spin" /> Running...</>
            ) : starting ? (
              <><Loader2 size={16} className="animate-spin" /> Starting...</>
            ) : (
              <><Play size={16} /> Start Enrichment</>
            )}
          </button>
        </div>

        {/* Progress Bar */}
        {status && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted mb-1.5">
              <span>{status.enriched.toLocaleString()} / {status.total.toLocaleString()} enriched</span>
              <span className="font-bold text-violet-400">{enrichedPct}%</span>
            </div>
            <div className="h-2.5 bg-bg3 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-700"
                style={{ width: `${enrichedPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats Row */}
        {status && (
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="bg-bg3/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-emerald-400">{status.enriched.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Matched</div>
            </div>
            <div className="bg-bg3/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-amber-400">{status.needsReview.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Review</div>
            </div>
            <div className="bg-bg3/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-red-400">{status.unmatched.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Unmatched</div>
            </div>
            <div className="bg-bg3/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-sky-400">{status.pending.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Pending</div>
            </div>
          </div>
        )}
      </div>

      {/* Queue Table */}
      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        {/* Filter Tabs */}
        <div className="p-3 border-b border-glass-border flex items-center gap-2">
          <span className="text-xs text-muted mr-2">Filter:</span>
          {[
            { key: 'all', label: 'All', icon: <Beaker size={13} /> },
            { key: 'needs_review', label: 'Needs Review', icon: <AlertTriangle size={13} /> },
            { key: 'unmatched', label: 'Unmatched', icon: <XCircle size={13} /> }
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                filter === f.key
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'bg-bg3/50 text-muted hover:text-text border border-transparent'
              }`}
            >
              {f.icon} {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">{totalItems.toLocaleString()} items</span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-bg/95 backdrop-blur z-10">
              <tr>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border w-16">ID</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Medicine Name</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Status</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Confidence</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border min-w-[300px]">Composition</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted">
                  <Loader2 size={20} className="animate-spin inline mr-2" /> Loading...
                </td></tr>
              ) : queue.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted">
                  <Sparkles size={20} className="inline mr-2 text-emerald-400" />
                  {status?.enriched ? 'All items have been processed!' : 'Run enrichment to start matching compositions.'}
                </td></tr>
              ) : queue.map(item => (
                <tr key={item.id} className="hover:bg-bg3/50 transition-colors border-b border-glass-border/50">
                  <td className="p-3 text-xs text-muted/60 font-mono">{item.id}</td>
                  <td className="p-3">
                    <div className="font-semibold text-text text-sm">{item.name}</div>
                    {item.manufacturer && <div className="text-[10px] text-muted mt-0.5">{item.manufacturer}</div>}
                  </td>
                  <td className="p-3">
                    {item.enrichment_status === 'needs_review' ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase">Review</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold uppercase">No Match</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted font-mono">
                    {item.enrichment_confidence ? `${Math.round(item.enrichment_confidence * 100)}%` : '-'}
                  </td>
                  <td className="p-3">
                    {item.enrichment_status === 'needs_review' && item.suggested_composition ? (
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-amber-300/80 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">
                          <span className="text-[10px] text-muted">Suggested:</span> {item.suggested_composition}
                        </div>
                        <input
                          type="text"
                          placeholder="Or type manually..."
                          className="w-full bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-violet-500/50"
                          value={editValues[item.id] || ''}
                          onChange={e => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="Enter composition..."
                        className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-violet-500/50"
                        value={editValues[item.id] || ''}
                        onChange={e => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(item.id); }}
                      />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1.5">
                      {item.enrichment_status === 'needs_review' && item.suggested_composition && (
                        <button
                          onClick={() => handleAcceptSuggestion(item)}
                          disabled={saving[item.id]}
                          className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          title="Accept suggestion"
                        >
                          {saving[item.id] ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        </button>
                      )}
                      {editValues[item.id]?.trim() && (
                        <button
                          onClick={() => handleSave(item.id)}
                          disabled={saving[item.id]}
                          className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                          title="Save manual entry"
                        >
                          {saving[item.id] ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-glass-border flex items-center justify-between">
            <span className="text-xs text-muted">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded bg-bg3 text-muted hover:text-text disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded bg-bg3 text-muted hover:text-text disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
