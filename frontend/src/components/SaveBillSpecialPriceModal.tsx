import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Tag, X, Percent, TrendingUp, Sparkles, Check } from 'lucide-react';
import { api } from '../services/api';
import { invalidateAfterPriceWrite } from '../utils/cacheInvalidation';
import { toastEvent } from '../services/events';

export interface BillItemForPriceConfig {
  medicine_id?: number | null;
  id?: number | string;
  medicine_name?: string;
  name?: string;
  mrp: number | string;
  rate: number | string;
  sell_price?: number | string | null;
}

interface SaveBillSpecialPriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceNo: string;
  distributorName?: string;
  items: BillItemForPriceConfig[];
  onSaveComplete?: () => void;
}

interface PriceRow {
  medicine_id: number;
  medicine_name: string;
  rate: number;
  mrp: number;
  sell_price: string; // raw price string input
  discount_per: string; // raw discount percentage string input
  margin: number; // profit margin % over rate
}

export const SaveBillSpecialPriceModal: React.FC<SaveBillSpecialPriceModalProps> = ({
  isOpen,
  onClose,
  invoiceNo,
  items,
  onSaveComplete
}) => {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [batchDiscount, setBatchDiscount] = useState<string>('10');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && Array.isArray(items) && items.length > 0) {
      const initialRows: PriceRow[] = items.map(item => {
        const medId = Number(item.medicine_id || item.id || 0);
        const medName = item.medicine_name || item.name || 'Unknown Item';
        const rateVal = Math.max(0, Number(item.rate || 0));
        const mrpVal = Math.max(0, Number(item.mrp || 0));

        let initialSellPrice = '';
        let initialDiscount = '';

        if (item.sell_price !== undefined && item.sell_price !== null && item.sell_price !== '') {
          const sp = Number(item.sell_price);
          if (!isNaN(sp) && sp > 0 && sp < mrpVal) {
            initialSellPrice = String(sp);
            initialDiscount = String(Math.round(((mrpVal - sp) / mrpVal) * 100 * 100) / 100);
          }
        }

        const currentSp = initialSellPrice ? Number(initialSellPrice) : mrpVal;
        const margin = rateVal > 0 ? Math.round(((currentSp - rateVal) / rateVal) * 1000) / 10 : 0;

        return {
          medicine_id: medId,
          medicine_name: medName,
          rate: rateVal,
          mrp: mrpVal,
          sell_price: initialSellPrice,
          discount_per: initialDiscount,
          margin
        };
      });
      setRows(initialRows);
    }
  }, [isOpen, items]);

  if (!isOpen) return null;

  const handlePriceChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      row.sell_price = val;

      const numSp = parseFloat(val);
      if (!isNaN(numSp) && row.mrp > 0) {
        if (numSp <= row.mrp) {
          const disc = Math.round(((row.mrp - numSp) / row.mrp) * 100 * 100) / 100;
          row.discount_per = disc > 0 ? String(disc) : '';
        } else {
          // If price > MRP, cap to MRP
          row.sell_price = String(row.mrp);
          row.discount_per = '';
        }
      } else {
        row.discount_per = '';
      }

      const activeSp = !isNaN(numSp) && numSp > 0 ? numSp : row.mrp;
      row.margin = row.rate > 0 ? Math.round(((activeSp - row.rate) / row.rate) * 1000) / 10 : 0;
      next[index] = row;
      return next;
    });
  };

  const handleDiscountChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      row.discount_per = val;

      const numDisc = parseFloat(val);
      if (!isNaN(numDisc) && numDisc >= 0 && numDisc <= 100 && row.mrp > 0) {
        const sp = Math.round((row.mrp * (1 - numDisc / 100)) * 100) / 100;
        row.sell_price = numDisc > 0 ? String(sp) : '';
      } else if (val === '' || numDisc === 0) {
        row.sell_price = '';
      }

      const numSp = parseFloat(row.sell_price);
      const activeSp = !isNaN(numSp) && numSp > 0 ? numSp : row.mrp;
      row.margin = row.rate > 0 ? Math.round(((activeSp - row.rate) / row.rate) * 1000) / 10 : 0;
      next[index] = row;
      return next;
    });
  };

  const applyBatchDiscount = () => {
    const discVal = parseFloat(batchDiscount);
    if (isNaN(discVal) || discVal < 0 || discVal > 100) return;

    setRows(prev => prev.map(row => {
      if (row.mrp <= 0) return row;
      const sp = Math.round((row.mrp * (1 - discVal / 100)) * 100) / 100;
      const margin = row.rate > 0 ? Math.round(((sp - row.rate) / row.rate) * 1000) / 10 : 0;
      return {
        ...row,
        discount_per: discVal > 0 ? String(discVal) : '',
        sell_price: discVal > 0 ? String(sp) : '',
        margin
      };
    }));
  };

  const resetAllToMRP = () => {
    setRows(prev => prev.map(row => ({
      ...row,
      sell_price: '',
      discount_per: '',
      margin: row.rate > 0 ? Math.round(((row.mrp - row.rate) / row.rate) * 1000) / 10 : 0
    })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatePayload = rows
        .filter(r => r.medicine_id > 0)
        .map(r => {
          const numSp = parseFloat(r.sell_price);
          const validPrice = (!isNaN(numSp) && numSp > 0 && numSp < r.mrp) ? numSp : null;
          return {
            medicine_id: r.medicine_id,
            sell_price: validPrice
          };
        });

      if (updatePayload.length > 0) {
        await api.updateBulkSellPrices(updatePayload);
        invalidateAfterPriceWrite(queryClient);
        toastEvent.trigger('Special offer prices & discounts saved successfully!', 'success');
      }

      if (onSaveComplete) onSaveComplete();
      onClose();
    } catch (err: any) {
      console.error('Failed to save special offer prices:', err);
      toastEvent.trigger(err.message || 'Failed to save special offer prices', 'error');
    } finally {
      setSaving(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden slide-up">
        
        {/* Header */}
        <div className="p-5 border-b border-glass-border bg-bg3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text flex items-center gap-2">
                Set Special Discount Offers
                <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  Bill Saved: {invoiceNo || 'Inward Stock'}
                </span>
              </h2>
              <p className="text-xs text-muted">
                Set custom discounted selling prices for POS. MRP & Purchase rate remain unchanged.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-text hover:bg-glass-bg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Action Toolbar */}
        <div className="p-4 border-b border-glass-border bg-bg2 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Apply Batch Discount:
            </span>
            <div className="relative flex items-center">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={batchDiscount}
                onChange={e => setBatchDiscount(e.target.value)}
                className="w-20 px-3 py-1.5 text-xs bg-bg border border-glass-border rounded-lg text-text focus:outline-none focus:border-amber-500 pr-6"
                placeholder="10"
              />
              <Percent className="w-3 h-3 text-muted absolute right-2 pointer-events-none" />
            </div>
            <button
              onClick={applyBatchDiscount}
              className="px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors"
            >
              Apply to All Items
            </button>
          </div>

          <button
            onClick={resetAllToMRP}
            className="px-3 py-1.5 text-xs font-medium text-muted hover:text-text hover:bg-glass-bg border border-glass-border rounded-lg transition-colors"
          >
            Reset All to Full MRP
          </button>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-glass-border text-muted uppercase font-semibold">
                <th className="py-2.5 px-3">Medicine</th>
                <th className="py-2.5 px-3 text-right">Cost Rate</th>
                <th className="py-2.5 px-3 text-right">Full MRP</th>
                <th className="py-2.5 px-3 text-center">Special Offer Discount</th>
                <th className="py-2.5 px-3 text-center">Discounted Selling Price</th>
                <th className="py-2.5 px-3 text-right">Profit Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glass-border">
              {rows.map((row, idx) => (
                <tr key={row.medicine_id || idx} className="hover:bg-glass-bg/40 transition-colors">
                  <td className="py-3 px-3">
                    <span className="font-semibold text-text block">{row.medicine_name}</span>
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-muted">
                    ₹{row.rate.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-text">
                    ₹{row.mrp.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="relative inline-flex items-center w-28">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.discount_per}
                        onChange={e => handleDiscountChange(idx, e.target.value)}
                        placeholder="0"
                        className="w-full px-2.5 py-1 text-xs text-center font-bold bg-bg border border-glass-border rounded-lg text-amber-500 focus:outline-none focus:border-amber-500 pr-6"
                      />
                      <Percent className="w-3 h-3 text-amber-500 absolute right-2 pointer-events-none" />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="relative inline-flex items-center w-32">
                      <span className="absolute left-2.5 text-xs font-semibold text-emerald-500">₹</span>
                      <input
                        type="number"
                        min="0"
                        max={row.mrp}
                        step="0.5"
                        value={row.sell_price}
                        onChange={e => handlePriceChange(idx, e.target.value)}
                        placeholder={row.mrp.toFixed(2)}
                        className="w-full pl-6 pr-2.5 py-1 text-xs text-center font-bold bg-bg border border-glass-border rounded-lg text-emerald-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <span className={`inline-flex items-center gap-1 font-bold ${row.margin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      <TrendingUp className="w-3 h-3" />
                      {row.margin >= 0 ? `+${row.margin}%` : `${row.margin}%`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-glass-border bg-bg3 flex items-center justify-between shrink-0">
          <span className="text-xs text-muted">
            POS will automatically apply these discounted prices for customer sales.
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-muted hover:text-text border border-glass-border rounded-xl hover:bg-glass-bg transition-colors"
            >
              Skip / Keep Regular MRP
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition-all"
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Save Special Prices
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  const modalRoot = document.getElementById('modal-root') || document.body;
  return createPortal(modalContent, modalRoot);
};
