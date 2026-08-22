import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Zap, ChevronLeft, ChevronRight, X, Phone, ShoppingCart, CreditCard, Sparkles } from 'lucide-react';
import { stagedQueueService, type StagedItem } from '../services/stagedQueueService';

interface Props {
  onLoadIntoPOS?: (item: StagedItem) => void;
}

export const StagedQueueFloatingWidget: React.FC<Props> = ({ onLoadIntoPOS }) => {
  const [queueState, setQueueState] = useState(stagedQueueService.getQueueState());

  useEffect(() => {
    return stagedQueueService.subscribe((state: any) => {
      setQueueState(state);
    });
  }, []);

  if (!queueState.isActive || !queueState.currentItem) {
    return null;
  }

  const { currentItem, currentIndex, total } = queueState;

  const getPaymentBadge = (mode?: string) => {
    if (mode === 'CREDIT') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <CreditCard size={10} /> Credit Order
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <ShoppingCart size={10} /> Direct Cash
      </span>
    );
  };

  return createPortal(
    <div className="fixed bottom-14 right-6 z-global-modal slide-up select-none">
      <div className="bg-[#18181b]/95 border border-primary/40 rounded-2xl p-3.5 shadow-2xl backdrop-blur-md w-80 text-white space-y-2.5">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Zap size={14} className="animate-pulse text-amber-400" />
            <span>Staged Mobile Order ({currentIndex + 1} of {total})</span>
          </div>

          <button
            onClick={() => stagedQueueService.clearQueue()}
            className="p-1 rounded-md text-muted hover:text-white hover:bg-white/10 transition-colors"
            title="Exit queue"
          >
            <X size={14} />
          </button>
        </div>

        {/* Customer & Info Details */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-white truncate max-w-[170px]">
              {currentItem.patient_name || 'Walk-in Customer'}
            </span>
            {getPaymentBadge(currentItem.payment_medium)}
          </div>

          {currentItem.patient_phone && (
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <Phone size={10} />
              <span>{currentItem.patient_phone}</span>
            </div>
          )}

          {currentItem.doctor_name && (
            <div className="text-[11px] text-muted truncate">
              Dr. {currentItem.doctor_name}
            </div>
          )}
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => stagedQueueService.prevItem()}
              disabled={currentIndex === 0}
              className="p-1.5 rounded-lg border border-glass-border hover:bg-white/10 text-muted hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
              title="Previous order"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => stagedQueueService.nextItem()}
              disabled={currentIndex === total - 1}
              className="p-1.5 rounded-lg border border-glass-border hover:bg-white/10 text-muted hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
              title="Next order"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {onLoadIntoPOS && (
            <button
              onClick={() => onLoadIntoPOS(currentItem)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow-md transition-all"
            >
              <Sparkles size={13} />
              <span>Load Into POS</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
