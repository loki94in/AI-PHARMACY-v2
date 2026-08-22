import React from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, AlertTriangle, Sparkles, SearchCheck, CheckCircle2 } from 'lucide-react';

export interface SaveVerificationData {
  distributor: string;
  invoiceNo: string;
  date: string;
  itemCount: number;
  grandTotal: number;
  autoLinkedCount: number;
  fuzzyMatches: { name: string; matchedName: string; confidence: number }[];
  newRegistrations: string[];
  unresolved: string[];
}

interface Props {
  data: SaveVerificationData;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const PurchaseSaveVerificationModal: React.FC<Props> = ({ data, saving, onConfirm, onClose }) => {
  const hasIssues = data.unresolved.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg border border-border rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl slide-up text-text">
        {/* Header */}
        <div className="p-5 border-b border-border bg-bg2 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight">Final Verification</h3>
              <p className="text-xs text-muted mt-0.5">Review everything before this bill is committed to inventory</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bg3 text-muted hover:text-text transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-custom">
          {/* Invoice summary */}
          <div className="bg-bg2 border border-border rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Distributor</div>
              <div className="font-bold truncate">{data.distributor || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Invoice No / Date</div>
              <div className="font-bold truncate">{data.invoiceNo} • {data.date || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Items</div>
              <div className="font-bold">{data.itemCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold">Grand Total</div>
              <div className="font-bold text-accent">₹{Number(data.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          {/* Unresolved — blocking */}
          {hasIssues && (
            <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="text-red-500 shrink-0" size={18} />
                <p className="text-sm font-bold text-red-500">{data.unresolved.length} medicine{data.unresolved.length > 1 ? 's are' : ' is'} not linked to any master record</p>
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-red-500 ml-6">
                {data.unresolved.map((n) => (
                  <li key={n} className="font-semibold truncate">{n}</li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2 ml-1">
                Close this window and resolve each highlighted row in the bill grid — pick a match from search or click ✨ Register to create the medicine.
              </p>
            </div>
          )}

          {/* Fuzzy matches — verify */}
          {data.fuzzyMatches.length > 0 && (
            <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-2 mb-2">
                <SearchCheck className="text-amber-500 shrink-0" size={18} />
                <p className="text-sm font-bold text-amber-500">{data.fuzzyMatches.length} line{data.fuzzyMatches.length > 1 ? 's were' : ' was'} auto-matched by similarity — please verify</p>
              </div>
              <ul className="space-y-1.5 text-xs ml-6 text-text">
                {data.fuzzyMatches.map((f) => (
                  <li key={f.name} className="truncate">
                    <span className="font-semibold">"{f.name}"</span>
                    <span className="text-muted"> → </span>
                    <span className="font-semibold">{f.matchedName}</span>
                    <span className="text-muted"> ({Math.round(f.confidence * 100)}%)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* New registrations */}
          {data.newRegistrations.length > 0 && (
            <div className="rounded-xl p-4 bg-emerald-500/10 border border-emerald-500/30">
              <div className="flex items-start gap-2 mb-2">
                <Sparkles className="text-emerald-500 shrink-0" size={18} />
                <p className="text-sm font-bold text-emerald-500">{data.newRegistrations.length} new medicine{data.newRegistrations.length > 1 ? 's' : ''} registered by you in this session</p>
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs ml-6 text-text">
                {data.newRegistrations.map((n) => (
                  <li key={n} className="font-semibold truncate">{n}</li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2 ml-1">Master records only — stock will be created solely from this verified purchase.</p>
            </div>
          )}

          {/* Clean bill */}
          {!hasIssues && data.fuzzyMatches.length === 0 && data.newRegistrations.length === 0 && (
            <div className="rounded-xl p-4 bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
              <CheckCircle2 className="text-emerald-500 shrink-0" size={22} />
              <p className="text-sm font-bold text-emerald-500">All {data.itemCount} lines are exactly linked to master medicines. Safe to commit.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 flex justify-end gap-3 shrink-0 bg-bg2">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-border hover:bg-bg3 rounded-xl text-sm font-medium transition-colors text-muted hover:text-text"
          >
            Back to Bill
          </button>
          <button
            onClick={onConfirm}
            disabled={saving || hasIssues}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldCheck size={16} />
            {saving ? 'Saving...' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
