import React from 'react';
import { api } from '../services/api';
import { useApiQuery } from '../hooks/useApiQuery';
import { Loader, AlertCircle } from 'lucide-react';

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

interface HoverPriceIntelTableProps {
  medicineName: string;
  /**
   * Pre-loaded history rows (from the Purchases one-shot medicine-batches cache).
   * When provided, NO network call is made — the table renders straight from
   * these records (null/undefined falls back to the /price-history query).
   */
  records?: PriceRecord[] | null;
}

export const HoverPriceIntelTable: React.FC<HoverPriceIntelTableProps> = ({ medicineName, records }) => {
  const canFetch = !!medicineName && medicineName.length >= 2 && !records;
  const { data: historyRes, isFetching, isSuccess, isError } = useApiQuery<{ data?: PriceRecord[] }>(
    ['medicine-price-history', medicineName],
    () => api.getMedicinePriceHistory(medicineName),
    { enabled: canFetch }
  );
  const sourceRecords: PriceRecord[] = (records && records.length > 0 ? records : null) || historyRes?.data || [];
  const loading = !records && isFetching;
  const loaded = !!records || isSuccess || isError;
  const error = isError ? 'Could not load price history.' : null;

  if (!medicineName || medicineName.length < 2) return null;

  if (!records && loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted text-xs p-3">
        <Loader size={12} className="animate-spin text-primary" />
        Loading price history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-amber-400 p-3">
        <AlertCircle size={12} />
        {error}
      </div>
    );
  }

  if (loaded && sourceRecords.length === 0) {
    return (
      <div className="py-2 text-xs text-muted italic p-3">
        No previous purchases found for "{medicineName}".
      </div>
    );
  }

  // Deduplicate distributors and pick the latest/best record for each
  const distributorMap = new Map<string, PriceRecord>();
  sourceRecords.forEach(r => {
    const key = r.distributor_name || 'Unknown';
    if (!distributorMap.has(key)) {
      distributorMap.set(key, r);
    } else {
      const existing = distributorMap.get(key)!;
      // We could prefer the lowest rate or the latest date. Let's prefer the lowest rate for best comparison.
      if (r.rate < existing.rate) {
        distributorMap.set(key, r);
      }
    }
  });

  const uniqueRecords = Array.from(distributorMap.values());

  return (
    <div className="p-2 w-full">
      <table className="w-full text-[11px] text-left border-collapse">
        <thead>
          <tr className="border-b border-white/20 text-gray-400">
            <th className="pb-1 font-semibold">Distributor</th>
            <th className="pb-1 text-right font-semibold">Rate</th>
            <th className="pb-1 text-right font-semibold">MRP</th>
            <th className="pb-1 text-right font-semibold">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {uniqueRecords.slice(0, 10).map((r, i) => {
            const marginAmount = r.mrp - r.rate;
            const marginPercent = r.mrp > 0 ? ((marginAmount / r.mrp) * 100) : 0;
            
            return (
              <tr key={i} className="hover:bg-white/5 transition-colors">
                <td className="py-1.5 text-white pr-2 truncate max-w-[120px]" title={r.distributor_name}>
                  {r.distributor_name}
                </td>
                <td className="py-1.5 text-right text-white pl-2">₹{r.rate.toFixed(2)}</td>
                <td className="py-1.5 text-right text-purple-400 pl-2 font-semibold">₹{r.mrp.toFixed(2)}</td>
                <td className="py-1.5 text-right text-yellow-400 pl-2">{marginPercent.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
