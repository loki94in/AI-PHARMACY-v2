import React, { useState, useMemo } from 'react';
import {
  ShieldCheck, ShieldX, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, RefreshCw, PlayCircle,
  FileText, AlertCircle, Info, Wrench, Eye, History, Loader2,
} from 'lucide-react';
import { apiClient } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useApiQuery, useApiMutation } from '../../hooks/useApiQuery';

// ── Types (mirror src/utils/auditEngine.ts) ─────────────────────────────────
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type CategoryStatus = 'CLEAN' | 'ISSUE';

interface AuditFinding {
  id: string; category: string; severity: Severity;
  summary: string; where: string;
  codeFixAvailable: boolean; userActionRequired: boolean;
  exactAction: string; evidenceCount?: number;
}
interface CategoryResult { category: string; status: CategoryStatus; findings: AuditFinding[]; }
interface AuditReport {
  id?: number; storedAt?: string;
  timestamp: string; appVersion: string; buildId: string;
  categories: CategoryResult[]; findings: AuditFinding[];
  totalCategories: number; cleanCategories: number; issueCategories: number;
  blockingCount: number; status: 'PROJECT READY' | 'PROJECT NOT READY';
}
interface AuditHistoryRow { id: number; storedAt: string; description: string; status: string; blockingCount: number; }
type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

const CATEGORY_ORDER = [
  'POS', 'Inventory', 'Purchases', 'Purchase History', 'Sales',
  'Customer Returns', 'Supplier Returns', 'Expiry', 'OCR', 'Email Import',
  'Migration', 'Mobile', 'WhatsApp', 'Compliance', 'Reports',
  'PDF Invoices', 'Settings', 'Database Integrity',
];

const severityConfig: Record<Severity, { color: string; bg: string }> = {
  CRITICAL: { color: 'text-red-300', bg: 'bg-red-500/20 border-red-500/50' },
  HIGH: { color: 'text-orange-300', bg: 'bg-orange-500/15 border-orange-500/40' },
  MEDIUM: { color: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/30' },
  LOW: { color: 'text-blue-300', bg: 'bg-blue-500/10 border-blue-500/25' },
  INFO: { color: 'text-text/50', bg: 'bg-white/5 border-border' },
};

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// ── FindingRow ───────────────────────────────────────────────────────────────
function FindingRow({ f }: { f: AuditFinding }) {
  const sv = severityConfig[f.severity];
  return (
    <div className={`border rounded-lg p-3 space-y-2 ${sv.bg}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${sv.bg} ${sv.color}`}>{f.severity}</span>
        <span className="text-xs font-mono text-muted">{f.id}</span>
        {typeof f.evidenceCount === 'number' && (
          <span className="text-[10px] text-muted bg-white/5 border border-border px-2 py-0.5 rounded-full">
            {f.evidenceCount} affected row{f.evidenceCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs text-text/90 leading-relaxed">{f.summary}</p>
      <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-start gap-1.5 text-muted"><FileText size={11} className="mt-0.5 shrink-0" /><span className="font-mono">{f.where}</span></div>
        <div className="flex items-start gap-1.5 text-muted">
          <Wrench size={11} className="mt-0.5 shrink-0" />
          <span>{f.codeFixAvailable ? 'Code-level fix available' : 'No automatic code fix — data correction needed'}</span>
        </div>
      </div>
      {f.userActionRequired && (
        <div className="p-2.5 bg-black/10 border border-white/10 rounded-md">
          <div className="flex items-center gap-1.5 mb-1 text-amber-300">
            <AlertTriangle size={11} /><span className="text-[10px] font-black uppercase tracking-wider">Required Action</span>
          </div>
          <p className="text-[11px] text-text/80 leading-relaxed">{f.exactAction}</p>
        </div>
      )}
    </div>
  );
}

// ── CategoryRow ──────────────────────────────────────────────────────────────
function CategoryRow({ result }: { result: CategoryResult | undefined; }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;
  const clean = result.status === 'CLEAN';
  return (
    <div className={`border rounded-xl overflow-hidden ${clean ? 'border-border' : 'border-red-500/30'}`}>
      <button
        onClick={() => result.findings.length > 0 && setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${result.findings.length > 0 ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'}`}
        aria-expanded={open}
      >
        {result.findings.length > 0 ? (open ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />) : <span className="w-[13px] shrink-0" />}
        <span className="flex-1 text-sm font-semibold text-text">{result.category}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full border ${
          clean ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {clean ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {clean ? 'CLEAN' : 'ISSUE'}
        </span>
      </button>
      {open && result.findings.length > 0 && (
        <div className="px-4 pb-4 pt-1 space-y-2 border-t border-border/50">
          {result.findings.map(f => <FindingRow key={f.id} f={f} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div className="bg-glass-bg border border-glass-border rounded-xl p-4 flex flex-col gap-1">
      <span className={`text-2xl font-black tabular-nums ${color ?? 'text-text'}`}>{value}</span>
      <span className="text-[11px] font-semibold text-text/80">{label}</span>
      {sub && <span className="text-[10px] text-muted">{sub}</span>}
    </div>
  );
}

let cachedAuditReport: AuditReport | null = null;
let cachedAuditHistory: AuditHistoryRow[] = [];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditCenter() {
  const [viewingHistoryId, setViewingHistoryId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const latestQuery = useApiQuery<AuditReport | null>(
    ['audit-latest'],
    async () => {
      const res = await apiClient.get('/audit/latest');
      if (res.data) cachedAuditReport = res.data;
      return res.data;
    },
    {
      initialData: cachedAuditReport || undefined,
      staleTime: 60000,
      refetchOnWindowFocus: false,
    }
  );
  const historyQuery = useApiQuery<AuditHistoryRow[]>(
    ['audit-history'],
    async () => {
      const res = await apiClient.get('/audit/history');
      const list = res.data || [];
      cachedAuditHistory = list;
      return list;
    },
    {
      initialData: cachedAuditHistory.length > 0 ? cachedAuditHistory : undefined,
      staleTime: 60000,
      refetchOnWindowFocus: false,
    }
  );
  const historicalQuery = useApiQuery<AuditReport>(
    ['audit-detail', viewingHistoryId],
    () => apiClient.get(`/audit/${viewingHistoryId}`).then(r => r.data),
    { enabled: viewingHistoryId != null }
  );

  const runMutation = useApiMutation<AuditReport, void>(
    () => apiClient.post('/audit/run').then(r => r.data),
    {
      invalidateKeys: [['audit-latest'], ['audit-history']],
      onSuccess: (data) => {
        setViewingHistoryId(null);
        toastEvent.trigger(`Audit complete — ${data.status}`, data.status === 'PROJECT READY' ? 'success' : 'error');
      },
      onError: (err: unknown) => {
        const e = err as LocalApiError;
        toastEvent.trigger('Audit run failed: ' + (e?.response?.data?.error || e?.message || 'Server error'), 'error');
      },
    }
  );

  const report: AuditReport | null | undefined = viewingHistoryId != null ? historicalQuery.data : latestQuery.data;
  const isLoading = viewingHistoryId != null ? historicalQuery.isLoading : latestQuery.isLoading;
  const isViewingHistory = viewingHistoryId != null;

  const categoryByName = useMemo(() => {
    const map = new Map<string, CategoryResult>();
    report?.categories?.forEach(c => map.set(c.category, c));
    return map;
  }, [report]);

  const isReady = report?.status === 'PROJECT READY';

  return (
    <div className="h-full flex flex-col overflow-hidden text-text">
      {/* Header */}
      <div className="flex-none p-5 border-b border-border bg-glass-bg/60 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              {report ? (isReady ? <ShieldCheck size={24} className="text-green-400" /> : <ShieldX size={24} className="text-red-400" />)
                : <ShieldCheck size={24} className="text-muted" />}
              <h1 className="text-2xl font-black tracking-tight text-text">Project Readiness Audit</h1>
              {report && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-bg3 border border-border text-muted">
                  v{report.appVersion} · {report.buildId}
                </span>
              )}
            </div>
            <p className="text-sm text-muted">
              {report
                ? `${isViewingHistory ? 'Viewing historical audit' : 'Last run'}: ${fmtTime(report.storedAt || report.timestamp)}`
                : 'No audit has been run yet.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border bg-glass-bg hover:bg-bg3 text-text/80 cursor-pointer"
            >
              <History size={15} /> History
            </button>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-black rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {runMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
              {runMutation.isPending ? 'Running Audit…' : 'Run Audit'}
            </button>
          </div>
        </div>

        {report && (
          <div className={`mt-3 flex items-center gap-3 px-5 py-3 rounded-xl border-2 font-black text-base ${
            isReady ? 'bg-green-500/15 border-green-500/50 text-green-300' : 'bg-red-500/15 border-red-500/50 text-red-300'
          }`}>
            {isReady ? <><CheckCircle2 size={20} /> PROJECT READY</> : <><XCircle size={20} /> PROJECT NOT READY</>}
            <span className="font-normal text-sm opacity-80">
              {isReady ? 'No critical or high-severity business-data issues remain.' : `${report.blockingCount} blocking issue(s) must be resolved before this project can be finalized.`}
            </span>
          </div>
        )}

        {isViewingHistory && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300">
            <AlertCircle size={12} />
            You are viewing a past audit result (id #{viewingHistoryId}), not the latest state.
            <button onClick={() => setViewingHistoryId(null)} className="underline hover:text-amber-200 cursor-pointer">Return to latest</button>
          </div>
        )}
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="flex-none border-b border-border p-4 bg-glass-bg/30 max-h-56 overflow-y-auto">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Audit History</div>
          {(historyQuery.data || []).length === 0 && <p className="text-xs text-muted">No past audits recorded yet.</p>}
          <div className="space-y-1.5">
            {(historyQuery.data || []).map(h => (
              <button
                key={h.id}
                onClick={() => { setViewingHistoryId(h.id); setShowHistory(false); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border hover:bg-white/5 text-left cursor-pointer"
              >
                <span className="text-xs text-text/80">{fmtTime(h.storedAt)}</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                  h.status === 'PROJECT READY' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>{h.status}</span>
                <span className="text-[10px] text-muted">{h.blockingCount} blocking</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <Loader2 size={24} className="animate-spin mb-3" />
            <p className="text-sm">Loading audit…</p>
          </div>
        )}

        {!isLoading && !report && (
          <div className="flex flex-col items-center justify-center py-16 text-muted text-center">
            <ShieldCheck size={32} className="mb-3 opacity-40" />
            <p className="text-sm mb-3">No audit result on record. Run the audit to check business-data integrity across every module.</p>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-black rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {runMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
              Run Audit
            </button>
          </div>
        )}

        {!isLoading && report && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
              <StatCard label="Categories" value={report.totalCategories} />
              <StatCard label="Clean" value={report.cleanCategories} color="text-green-400" />
              <StatCard label="With Issues" value={report.issueCategories} color={report.issueCategories > 0 ? 'text-red-400' : 'text-text/60'} />
              <StatCard label="Blocking" value={report.blockingCount} color={report.blockingCount > 0 ? 'text-red-400' : 'text-green-400'} />
              <StatCard label="Total Findings" value={report.findings.length} />
              <StatCard label="Status" value={isReady ? 'READY' : 'NOT READY'} color={isReady ? 'text-green-400' : 'text-red-400'} />
            </div>

            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-1.5">
              <Eye size={11} /> Project Readiness by Category
            </div>
            <div className="space-y-2">
              {CATEGORY_ORDER.map(cat => <CategoryRow key={cat} result={categoryByName.get(cat)} />)}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {report && (
        <div className="flex-none px-5 py-3 border-t border-border bg-glass-bg/40 flex items-center justify-between flex-wrap gap-2 text-[10px] text-muted">
          <div className="flex items-center gap-3">
            <RefreshCw size={11} />
            <span>{fmtTime(report.storedAt || report.timestamp)} · app v{report.appVersion} · build {report.buildId}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Info size={11} />
            <span>Every check runs live against the current database on each "Run Audit" — nothing here is precomputed.</span>
          </div>
        </div>
      )}
    </div>
  );
}
