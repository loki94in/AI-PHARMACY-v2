import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingDown,
  TrendingUp,
  Building2,
  Calendar,
  Package,
  ChevronDown,
  ChevronUp,
  Star,
  Loader,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import { api } from '../services/api';

interface PriceRecord {
  date: string;
  distributor_name: string;
  batch_no: string;
  expiry_date: string;
  rate: number;
  mrp: number;
  cgst_per: number;
  sgst_per: number;
  cd_rs: number;
  qty?: number;
}

interface DistributorSummary {
  distributor: string;
  lastRate: number;
  lastMrp: number;
  lastDate: string;
  lastQty: number;
  bestRate: number;
  count: number;
}

interface PriceIntelPanelProps {
  medicineName: string;
  currentRate?: number;
  currentDistributorId?: number | null;
  /** If true, the panel starts expanded */
  defaultExpanded?: boolean;
}

export const PriceIntelPanel: React.FC<PriceIntelPanelProps> = ({
  medicineName,
  currentRate,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<PriceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!medicineName || medicineName.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMedicinePriceHistory(medicineName);
      const data: PriceRecord[] = res?.data || [];
      setRecords(data);
    } catch (err: any) {
      setError('Could not load price history.');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [medicineName]);

  // Fetch when expanded for the first time
  useEffect(() => {
    if (expanded && !loaded) {
      fetchHistory();
    }
  }, [expanded, loaded, fetchHistory]);

  // Re-fetch when medicine name changes
  useEffect(() => {
    setLoaded(false);
    setRecords([]);
    setError(null);
    if (expanded) {
      fetchHistory();
    }
  }, [medicineName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!medicineName || medicineName.length < 2) return null;

  // Compute per-distributor summaries
  const distributorMap: Record<string, DistributorSummary> = {};
  for (const r of records) {
    const key = r.distributor_name || 'Unknown';
    if (!distributorMap[key]) {
      distributorMap[key] = {
        distributor: key,
        lastRate: r.rate,
        lastMrp: r.mrp,
        lastDate: r.date,
        lastQty: r.qty || 0,
        bestRate: r.rate,
        count: 1,
      };
    } else {
      const d = distributorMap[key];
      if (r.rate < d.bestRate) d.bestRate = r.rate;
      d.count++;
      // Most recent record is first (sorted by date DESC from backend)
    }
  }

  const summaries = Object.values(distributorMap).sort((a, b) => a.bestRate - b.bestRate);
  const globalBestRate = summaries.length > 0 ? summaries[0].bestRate : null;
  const lastPurchase = records[0] || null;

  const isBetterThanCurrent = currentRate && globalBestRate && globalBestRate < currentRate;
  const isWorseThanCurrent = currentRate && globalBestRate && globalBestRate > currentRate;

  const formatDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch { return d; }
  };

  const formatRate = (v: number) =>
    isNaN(v) ? '—' : '₹' + Number(v).toFixed(2);

  return (
    <div className="mt-0.5 rounded-b-xl overflow-hidden border-t-0 border border-primary/20 bg-primary/[0.03]">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold transition-all gap-2 hover:bg-white/5 ${
          records.length > 0 ? 'text-sky' : 'text-muted'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <BarChart3 size={11} />
          <span>
            {loaded
              ? records.length > 0
                ? `📊 Price History — ${records.length} record(s) from ${summaries.length} distributor(s)`
                : '📊 No purchase history found'
              : '📊 View Price History'}
          </span>
          {loaded && globalBestRate !== null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 border border-green/25 text-green font-bold ml-1">
              Best ₹{Number(globalBestRate).toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loaded && currentRate && globalBestRate !== null && (
            <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isBetterThanCurrent ? 'text-green' : isWorseThanCurrent ? 'text-amber-400' : 'text-muted'}`}>
              {isBetterThanCurrent && <><TrendingDown size={10} /> Save ₹{(currentRate - globalBestRate).toFixed(2)}</>}
              {isWorseThanCurrent && <><TrendingUp size={10} /> Higher by ₹{(globalBestRate - currentRate).toFixed(2)}</>}
            </span>
          )}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-muted text-xs">
              <Loader size={12} className="animate-spin text-primary" />
              Loading price history...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 py-2 text-xs text-amber-400">
              <AlertCircle size={12} />
              {error}
            </div>
          )}

          {!loading && loaded && records.length === 0 && (
            <div className="py-2 text-xs text-muted italic">
              No previous purchases found for "{medicineName}". This appears to be a new medicine.
            </div>
          )}

          {!loading && records.length > 0 && (
            <>
              {/* Quick Summary Row */}
              {lastPurchase && (
                <div className="flex flex-wrap gap-3 py-2 border-b border-glass-border/20 text-[11px]">
                  <div className="flex items-center gap-1 text-muted">
                    <Calendar size={10} />
                    <span className="font-mono">{formatDate(lastPurchase.date)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted">
                    <Building2 size={10} />
                    <span className="font-semibold text-text/80">{lastPurchase.distributor_name}</span>
                  </div>
                  <div className="flex items-center gap-1 font-bold text-sky">
                    <span>Rate: {formatRate(lastPurchase.rate)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted">
                    <span>MRP: {formatRate(lastPurchase.mrp)}</span>
                  </div>
                </div>
              )}

              {/* Per-Distributor Comparison Table */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
                  Distributor Comparison
                </div>
                {summaries.map((s, idx) => {
                  const isBest = s.bestRate === globalBestRate;
                  return (
                    <div
                      key={s.distributor}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] transition-all ${
                        isBest
                          ? 'bg-green/10 border border-green/25'
                          : 'bg-white/[0.03] border border-glass-border/20'
                      }`}
                    >
                      {/* Rank */}
                      <div className={`text-[10px] font-black w-4 flex-shrink-0 text-center ${isBest ? 'text-green' : 'text-muted'}`}>
                        {isBest ? <Star size={12} className="text-green fill-green" /> : `#${idx + 1}`}
                      </div>

                      {/* Distributor name */}
                      <div className="flex-1 min-w-0 font-semibold text-text/90 truncate">
                        {s.distributor}
                      </div>

                      {/* Best rate */}
                      <div className={`font-black tabular-nums ${isBest ? 'text-green' : 'text-sky'}`}>
                        {formatRate(s.bestRate)}
                      </div>

                      {/* Last MRP */}
                      <div className="text-muted tabular-nums text-[10px] w-16 text-right">
                        MRP {formatRate(s.lastMrp)}
                      </div>

                      {/* Last date */}
                      <div className="text-muted font-mono text-[10px] w-16 text-right">
                        {formatDate(s.lastDate)}
                      </div>

                      {/* # orders */}
                      <div className="flex items-center gap-0.5 text-muted text-[10px] w-10 text-right">
                        <Package size={9} />
                        {s.count}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recent 5 purchases detail */}
              {records.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted cursor-pointer hover:text-text font-semibold select-none list-none flex items-center gap-1">
                    <ChevronDown size={10} /> Show last {Math.min(records.length, 10)} purchase records
                  </summary>
                  <table className="w-full mt-1 text-[10px] border-collapse">
                    <thead>
                      <tr className="text-muted/60 uppercase tracking-wide border-b border-glass-border/20">
                        <th className="py-1 text-left font-bold">Date</th>
                        <th className="py-1 text-left font-bold">Distributor</th>
                        <th className="py-1 text-right font-bold">Rate</th>
                        <th className="py-1 text-right font-bold">MRP</th>
                        <th className="py-1 text-left font-bold pl-2">Batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.slice(0, 10).map((r, i) => (
                        <tr key={i} className="border-b border-glass-border/10 hover:bg-white/5">
                          <td className="py-1 font-mono text-muted">{formatDate(r.date)}</td>
                          <td className="py-1 text-text/80 truncate max-w-[100px]">{r.distributor_name}</td>
                          <td className={`py-1 text-right font-bold tabular-nums ${r.rate === globalBestRate ? 'text-green' : 'text-sky'}`}>
                            {formatRate(r.rate)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-muted">{formatRate(r.mrp)}</td>
                          <td className="py-1 pl-2 font-mono text-muted/70">{r.batch_no || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PriceIntelPanel;
