import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tag, Save, SkipForward, AlertTriangle, Check, ArrowLeft, Percent } from 'lucide-react';
import { api } from '../../services/api';

interface SellPriceRow {
  medicine_id: number;
  medicine_name: string;
  rate: number; // cost price
  mrp: number;
  sell_price: string; // raw input
}

export default function SellPriceConfig() {
  const location = useLocation();
  const navigate = useNavigate();

  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [rows, setRows] = useState<SellPriceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const stateData = location.state as { invoiceNo?: string; items?: any[]; saved_items?: any[] } | undefined;
    if (stateData) {
      if (stateData.invoiceNo) {
        setInvoiceNo(stateData.invoiceNo);
      }
      const rawItems = stateData.saved_items || stateData.items || [];
      if (Array.isArray(rawItems) && rawItems.length > 0) {
        const mappedRows: SellPriceRow[] = rawItems.map(item => {
          const medId = item.medicine_id || item.id || 0;
          const medName = item.medicine_name || item.name || 'Unknown Item';
          const rateVal = Number(item.rate || item.cost_price || 0);
          const mrpVal = Number(item.mrp || 0);
          const initialSellPrice = item.sell_price !== null && item.sell_price !== undefined ? String(item.sell_price) : '';

          return {
            medicine_id: medId,
            medicine_name: medName,
            rate: rateVal,
            mrp: mrpVal,
            sell_price: initialSellPrice
          };
        });
        setRows(mappedRows);
      }
    }
  }, [location.state]);

  const handleSellPriceChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      row.sell_price = val;

      const numVal = parseFloat(val);
      if (!isNaN(numVal) && row.mrp > 0 && numVal > row.mrp) {
        // Clamp to MRP if user enters greater than MRP
        row.sell_price = String(row.mrp);
      }

      next[index] = row;
      return next;
    });
  };

  const calculateDiscount = (mrp: number, sellPriceStr: string): number | null => {
    if (!sellPriceStr || mrp <= 0) return null;
    const sellPrice = parseFloat(sellPriceStr);
    if (isNaN(sellPrice) || sellPrice <= 0 || sellPrice >= mrp) return 0;
    const disc = ((mrp - sellPrice) / mrp) * 100;
    return parseFloat(disc.toFixed(2));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = rows.map(r => {
        const numVal = parseFloat(r.sell_price);
        return {
          medicine_id: r.medicine_id,
          sell_price: !isNaN(numVal) && numVal > 0 ? numVal : null
        };
      });

      await api.updateBulkSellPrices(payload);
      setSuccessMsg('Sell prices updated successfully!');
      setTimeout(() => {
        navigate('/purchases');
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save sell prices');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    navigate('/purchases');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-bg2 p-5 rounded-2xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text flex items-center gap-2">
              Set Sell Prices (Special Rates)
              {invoiceNo && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-bg3 text-muted font-medium">
                  Invoice: {invoiceNo}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted">
              Configure target selling prices for items saved in this purchase bill. Selling prices automatically compute discounts in POS.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSkip}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-bg hover:bg-bg3 text-text text-sm font-medium transition-colors disabled:opacity-50"
          >
            <SkipForward className="w-4 h-4 text-muted" />
            Skip / Done
          </button>

          <button
            onClick={handleSaveAll}
            disabled={saving || rows.length === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all shadow-md disabled:opacity-50"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save All
          </button>
        </div>
      </div>

      {/* Success / Error Messages */}
      {successMsg && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-sm font-medium">
          <Check className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Main Table */}
      {rows.length === 0 ? (
        <div className="text-center p-12 bg-bg2 rounded-2xl border border-border">
          <Tag className="w-12 h-12 text-muted mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-semibold text-text mb-1">No items found for configuration</h3>
          <p className="text-sm text-muted mb-4">No medicines were passed from the purchase bill.</p>
          <button
            onClick={handleSkip}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Purchases
          </button>
        </div>
      ) : (
        <div className="bg-bg2 rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg3/60 text-muted uppercase text-[11px] tracking-wider font-semibold border-b border-border">
                <tr>
                  <th className="py-3.5 px-4 w-12 text-center">#</th>
                  <th className="py-3.5 px-4">Medicine Name</th>
                  <th className="py-3.5 px-4 w-32 text-right">Cost Rate (₹)</th>
                  <th className="py-3.5 px-4 w-32 text-right">MRP (₹)</th>
                  <th className="py-3.5 px-4 w-44">Target Sell Price (₹)</th>
                  <th className="py-3.5 px-4 w-32 text-center">Discount (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row, idx) => {
                  const disc = calculateDiscount(row.mrp, row.sell_price);
                  const numSellPrice = parseFloat(row.sell_price);
                  const isBelowCost = !isNaN(numSellPrice) && numSellPrice > 0 && numSellPrice < row.rate;

                  return (
                    <tr key={row.medicine_id || idx} className="hover:bg-bg3/40 transition-colors">
                      <td className="py-3 px-4 text-center font-medium text-muted">{idx + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-text">{row.medicine_name}</div>
                        {isBelowCost && (
                          <div className="flex items-center gap-1 text-xs text-amber-500 mt-0.5">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>Selling price is below cost price (₹{row.rate})</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-muted font-mono font-medium">
                        ₹{row.rate.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right text-text font-mono font-semibold">
                        ₹{row.mrp.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-medium text-xs">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={row.mrp > 0 ? row.mrp : undefined}
                            placeholder={row.mrp > 0 ? `${row.mrp}` : 'MRP'}
                            value={row.sell_price}
                            onChange={(e) => handleSellPriceChange(idx, e.target.value)}
                            className="w-full pl-7 pr-3 py-1.5 rounded-xl border border-border bg-bg text-text text-sm font-mono focus:outline-none focus:border-primary transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {disc !== null && disc > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold text-xs font-mono">
                            <Percent className="w-3 h-3" />
                            {disc}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted font-mono">0% (MRP)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-bg3/30 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted">
              Note: Leave sell price blank or set equal to MRP to sell at standard MRP (no discount).
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSkip}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-border bg-bg hover:bg-bg3 text-text text-sm font-medium transition-colors"
              >
                Skip / Done
              </button>
              <button
                onClick={handleSaveAll}
                disabled={saving || rows.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all shadow-md"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
