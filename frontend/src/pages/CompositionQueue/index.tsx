import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Beaker, Play, Square, CheckCircle, AlertTriangle, XCircle, Save, ChevronLeft, ChevronRight, Loader2, Sparkles, Upload, Download, Search, RotateCcw, ChevronUp } from 'lucide-react';
import { api } from '../../services/api';
import { useFetchMode } from '../../hooks/useFetchMode';

interface EnrichmentStatus {
  total: number;
  enriched: number;
  needsReview: number;
  unmatched: number;
  nonPharma: number;
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Token Chip Editor (inline panel for unmatched rows) ─────────────────────
interface Token { text: string; included: boolean; }

function SearchTermEditor({ item, onEnriched }: { item: QueueItem; onEnriched: (id: number) => void }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Fetch default token classification from backend on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getTokenPreview(item.name)
      .then(data => {
        if (cancelled) return;
        setTokens(data.tokens);
        setPreview(data.preview);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback: show all tokens as single chip
        setTokens([{ text: item.name, included: true }]);
        setPreview(item.name.toUpperCase());
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [item.name]);

  // Recompute preview whenever tokens change
  const computedPreview = tokens
    .filter(t => t.included)
    .map(t => t.text.toUpperCase())
    .join(' ');

  const toggleToken = (idx: number) => {
    setTokens(prev => prev.map((t, i) => i === idx ? { ...t, included: !t.included } : t));
  };

  const resetToDefault = () => {
    // Reset: re-fetch defaults
    setLoading(true);
    api.getTokenPreview(item.name)
      .then(data => { setTokens(data.tokens); setPreview(data.preview); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const handleSearch = async () => {
    const term = computedPreview.trim();
    if (!term) { setError('Select at least one token'); return; }
    setError('');
    setSearching(true);
    try {
      // 1. Save the custom search term to DB
      await api.setSearchTerm(item.id, term);
      // 2. Trigger the full online enrichment pipeline
      await api.triggerOnlineEnrichment(item.id);
      setDone(true);
      // Give the background enrichment ~8s to complete, then notify parent
      setTimeout(() => onEnriched(item.id), 8000);
    } catch {
      setError('Search failed — check server connection');
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" /> Analyzing name tokens...
      </div>
    );
  }

  if (done) {
    return (
      <div className="px-4 py-3 flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle size={13} /> Search triggered — result will appear in ~30 seconds. Refresh page to see update.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-sky-500/5 border-t border-sky-500/10">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted uppercase tracking-wider font-bold">Select tokens to search:</span>
        <button
          onClick={resetToDefault}
          className="ml-auto text-[10px] text-muted hover:text-text flex items-center gap-1 transition-colors"
          title="Reset to defaults"
        >
          <RotateCcw size={10} /> Reset
        </button>
      </div>

      {/* Token chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tokens.map((tok, idx) => (
          <button
            key={idx}
            onClick={() => toggleToken(idx)}
            title={tok.included ? 'Click to exclude from search' : 'Click to include in search'}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all select-none ${
              tok.included
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                : 'bg-bg3/50 text-muted/40 border-glass-border/30 hover:text-muted hover:border-glass-border line-through'
            }`}
          >
            {tok.text}
          </button>
        ))}
      </div>

      {/* Live query preview */}
      <div className="flex items-center gap-2 mb-3">
        <Search size={12} className="text-sky-400 shrink-0" />
        <span className="text-[11px] text-muted">Google will search:</span>
        <span className="text-[11px] font-mono text-sky-300 font-bold">
          &quot;{computedPreview || '—'} API&quot;
        </span>
      </div>

      {error && <p className="text-[10px] text-red-400 mb-2">{error}</p>}

      <button
        onClick={handleSearch}
        disabled={searching || !computedPreview.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all"
      >
        {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
        {searching ? 'Searching...' : 'Search Now'}
      </button>
    </div>
  );
}

export default function CompositionQueue() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight') ? parseInt(searchParams.get('highlight')!) : null;

  const statusPollControl = useFetchMode('composition.statusPoll');

  const [status, setStatus] = useState<EnrichmentStatus | null>(cachedStatus);
  const [queue, setQueue] = useState<QueueItem[]>(cachedQueue);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [expandedTokenEditor, setExpandedTokenEditor] = useState<number | null>(null); // id of row with open editor
  const fileInputRef = useRef<HTMLInputElement>(null);
  const highlightRowRef = useRef<HTMLTableRowElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.getEnrichmentStatus();
      cachedStatus = data;
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      console.error('Failed to load enrichment status:', err);
      if (!cachedStatus?.isRunning) {
        setStatusError('Could not reach server. Enrichment may still be running in the background.');
      }
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
      setQueueError(null);
    } catch (err) {
      console.error('Failed to load queue:', err);
      setQueueError('Failed to load queue data. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    if (!status?.isRunning || !statusPollControl.shouldFetch) return;
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [status?.isRunning, loadStatus, statusPollControl.shouldFetch]);

  useEffect(() => {
    if (!highlightId || loading) return;
    const inPage = queue.find(q => q.id === highlightId);
    if (inPage) {
      setTimeout(() => {
        highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = highlightRowRef.current?.querySelector('input');
        input?.focus();
      }, 150);
    }
  }, [highlightId, queue, loading]);

  const handleStartEnrichment = async () => {
    setStarting(true);
    try {
      await api.startEnrichment();
      await loadStatus();
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 409) {
        await loadStatus();
      } else {
        console.error('Failed to start enrichment:', err);
        setStatusError('Could not start enrichment. Check the server.');
        setTimeout(() => setStatusError(null), 5000);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleStopEnrichment = async () => {
    setStopping(true);
    try {
      await api.stopEnrichment();
      const poll = setInterval(async () => {
        await loadStatus();
        if (!cachedStatus?.isRunning) {
          clearInterval(poll);
          setStopping(false);
          loadQueue();
        }
      }, 2000);
    } catch (err: any) {
      console.error('Failed to stop enrichment:', err);
      setStopping(false);
    }
  };

  const handleSave = async (id: number) => {
    const composition = editValues[id];
    if (!composition?.trim()) return;
    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      await api.updateComposition(id, composition.trim());
      setQueue(prev => prev.filter(item => item.id !== id));
      setTotalItems(prev => prev - 1);
      setEditValues(prev => { const n = { ...prev }; delete n[id]; return n; });
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

  // Called by SearchTermEditor after triggering online search — removes row after delay
  const handleOnlineEnriched = (id: number) => {
    setExpandedTokenEditor(null);
    // Reload queue after delay to pick up any result the background worker produced
    setTimeout(() => { loadQueue(); loadStatus(); }, 10000);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg('');
    try {
      const result = await api.importReferenceCsv(file);
      setImportMsg(`Imported ${result.loaded} medicines into reference`);
      setTimeout(() => setImportMsg(''), 4000);
    } catch (err) {
      setImportMsg('Import failed');
      setTimeout(() => setImportMsg(''), 4000);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportMaster = async () => {
    try {
      const blob = await api.exportReferenceCsv();
      downloadBlob(blob, 'reference_medicines.csv');
    } catch (err) {
      console.error('Export master failed:', err);
    }
  };

  const handleExportVerified = async () => {
    try {
      const blob = await api.exportVerifiedCsv('manual');
      downloadBlob(blob, 'verified_medicines.csv');
    } catch (err) {
      console.error('Export verified failed:', err);
    }
  };

  const enrichedPct = status ? Math.round((status.enriched / Math.max(status.total, 1)) * 100) : 0;
  const isRunning = !!status?.isRunning;

  return (
    <div className="h-full flex flex-col fade-in relative px-4 pb-4 pt-2 gap-3">
      <div className="glass-panel p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
              <Beaker size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text">Composition Enrichment</h2>
              <p className="text-xs text-muted">Auto-fills at 85%+ match. 60-85% needs review. Below is unmatched. Verified compositions power same-salt substitutes in billing.</p>
              {statusError && (
                <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
                  <AlertTriangle size={11} />{statusError}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-3 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border text-xs font-medium flex items-center gap-1.5 transition-all disabled:opacity-50"
              title="Import Salt Master CSV"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Import Master
            </button>
            <button
              onClick={handleExportMaster}
              className="px-3 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border text-xs font-medium flex items-center gap-1.5 transition-all"
            >
              <Download size={14} /> Export Master
            </button>
            <button
              onClick={handleExportVerified}
              className="px-3 py-2 rounded-xl bg-bg3 text-muted hover:text-text border border-glass-border text-xs font-medium flex items-center gap-1.5 transition-all"
            >
              <Download size={14} /> Export Verified
            </button>

            {isRunning && (
              <button
                onClick={handleStopEnrichment}
                disabled={stopping}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-semibold text-sm flex items-center gap-2 hover:from-red-500 hover:to-rose-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/20"
                title="Stop enrichment at next batch boundary"
              >
                {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                {stopping ? 'Stopping...' : 'Stop'}
              </button>
            )}

            <button
              onClick={handleStartEnrichment}
              disabled={starting || isRunning}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold text-sm flex items-center gap-2 hover:from-violet-500 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
            >
              {isRunning ? (
                <><Loader2 size={16} className="animate-spin" /> Running...</>
              ) : starting ? (
                <><Loader2 size={16} className="animate-spin" /> Starting...</>
              ) : (
                <><Play size={16} /> Start Enrichment</>
              )}
            </button>
          </div>
        </div>

        {importMsg && (
          <div className="mt-2 text-xs px-3 py-1 rounded-lg w-fit bg-emerald-500/10 text-emerald-400">
            {importMsg}
          </div>
        )}

        {status && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted mb-1.5">
              <span>{status.enriched.toLocaleString()} / {status.total.toLocaleString()} enriched</span>
              <span className="font-bold text-violet-400">{enrichedPct}%</span>
            </div>
            <div className="h-2.5 bg-bg3 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 bg-gradient-to-r from-violet-500 to-purple-500 ${isRunning ? 'animate-pulse' : ''}`}
                style={{ width: `${enrichedPct}%` }}
              />
            </div>
            {isRunning && (
              <p className="text-[10px] text-violet-400/70 mt-1 flex items-center gap-1">
                <Loader2 size={9} className="animate-spin" /> Enrichment is running in the background...
              </p>
            )}
          </div>
        )}

        {status && (
          <div className="grid grid-cols-5 gap-3 mt-4">
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
              <div className="text-lg font-bold text-slate-400">{status.nonPharma.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Non-Pharma</div>
            </div>
            <div className="bg-bg3/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-sky-400">{status.pending.toLocaleString()}</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Pending</div>
            </div>
          </div>
        )}
      </div>

      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
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

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-bg/95 backdrop-blur z-10">
              <tr>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border w-16">ID</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Medicine Name</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Status</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Confidence</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border min-w-[300px]">Composition</th>
                <th className="p-3 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted">
                  <Loader2 size={20} className="animate-spin inline mr-2" /> Loading...
                </td></tr>
              ) : queueError ? (
                <tr><td colSpan={6} className="p-8 text-center">
                  <div className="inline-flex flex-col items-center gap-2 bg-red-500/10 text-red-400 px-6 py-4 rounded-xl border border-red-500/20">
                    <div className="flex items-center gap-2 font-semibold"><XCircle size={18} />{queueError}</div>
                    <button onClick={loadQueue} className="px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium transition-colors">Retry</button>
                  </div>
                </td></tr>
              ) : queue.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted">
                  <Sparkles size={20} className="inline mr-2 text-emerald-400" />
                  {status?.enriched ? 'All items have been processed!' : 'Run enrichment to start matching compositions.'}
                </td></tr>
              ) : queue.map(item => {
                const isHighlighted = item.id === highlightId;
                const hasSuggestion = item.enrichment_status === 'needs_review' && !!item.suggested_composition;
                const hasTyped = !!editValues[item.id]?.trim();
                return (
                  <React.Fragment key={item.id}>
                  <tr
                    ref={isHighlighted ? highlightRowRef : undefined}
                    className={`hover:bg-bg3/50 transition-colors border-b border-glass-border/50 ${isHighlighted ? 'ring-2 ring-violet-500/40 bg-violet-500/5' : ''}`}
                  >
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
                      {hasSuggestion ? (
                        <div className="flex flex-col gap-1">
                          <div className="text-xs text-amber-300/80 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">
                            <span className="text-[10px] text-muted">Suggested:</span> {item.suggested_composition}
                          </div>
                          <input
                            type="text"
                            placeholder="Or type to override..."
                            className="w-full bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-violet-500/50"
                            value={editValues[item.id] || ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(item.id); }}
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
                      <div className="flex gap-1.5 items-center">
                        {hasSuggestion && (
                          <button
                            onClick={() => handleAcceptSuggestion(item)}
                            disabled={saving[item.id]}
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            title="Accept suggestion"
                          >
                            {saving[item.id] ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          </button>
                        )}
                        {hasTyped && (
                          <button
                            onClick={() => handleSave(item.id)}
                            disabled={saving[item.id]}
                            className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                            title="Save manual entry"
                          >
                            {saving[item.id] ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          </button>
                        )}
                        {/* Google search token editor toggle — only for unmatched rows */}
                        {item.enrichment_status === 'unmatched' && (
                          <button
                            onClick={() => setExpandedTokenEditor(prev => prev === item.id ? null : item.id)}
                            title={expandedTokenEditor === item.id ? 'Close search editor' : 'Edit Google search terms'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              expandedTokenEditor === item.id
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-bg3 text-muted hover:text-sky-400'
                            }`}
                          >
                            {expandedTokenEditor === item.id ? <ChevronUp size={14} /> : <Search size={14} />}
                          </button>
                        )}
                        {!hasSuggestion && !hasTyped && item.enrichment_status !== 'unmatched' && (
                          <span className="text-[10px] text-muted/40 italic">Type above</span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Inline token editor panel for unmatched rows */}
                  {item.enrichment_status === 'unmatched' && expandedTokenEditor === item.id && (
                    <tr key={`editor-${item.id}`} className="bg-bg3/20">
                      <td colSpan={6} className="py-0">
                        <SearchTermEditor item={item} onEnriched={handleOnlineEnriched} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

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
