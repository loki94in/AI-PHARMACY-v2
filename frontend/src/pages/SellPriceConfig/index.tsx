import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Tag, Save, SkipForward, AlertTriangle, Check, ArrowLeft, Percent, Info, Layers } from 'lucide-react';
import { api } from '../../services/api';

interface SellPriceRow {
  medicine_id: number;
  medicine_name: string;
  rate: number; // cost price
  mrp: number;
  sell_price: string; // raw input
  reorder_level: string; // min stock level
  max_stock_level: string; // max stock level
  warning?: string | null;
}

export default function SellPriceConfig() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [rows, setRows] = useState<SellPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const stateData = location.state as { invoiceNo?: string; isEdit?: boolean; items?: any[]; saved_items?: any[]; saved_medicines?: any[] } | undefined;
  const isEdit = !!stateData?.isEdit;

  useEffect(() => {
    const urlInvoice = searchParams.get('invoice') || '';
    const invNo = stateData?.invoiceNo || urlInvoice;
    if (invNo) {
      setInvoiceNo(invNo);
    }

    const rawItems = stateData?.saved_medicines || stateData?.saved_items || stateData?.items || [];
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      const mappedRows: SellPriceRow[] = rawItems.map(item => {
        const medId = item.medicine_id || item.id || 0;
        const medName = item.medicine_name || item.name || 'Unknown Item';
        const rateVal = Number(item.rate || item.cost_price || 0);
        const mrpVal = Number(item.mrp || 0);
        const initialSellPrice = item.sell_price !== null && item.sell_price !== undefined ? String(item.sell_price) : '';
        const initialReorder = item.reorder_level !== null && item.reorder_level !== undefined ? String(item.reorder_level) : '10';
        const initialMaxStock = item.max_stock_level !== null && item.max_stock_level !== undefined ? String(item.max_stock_level) : '';

        return {
          medicine_id: medId,
          medicine_name: medName,
          rate: rateVal,
          mrp: mrpVal,
          sell_price: initialSellPrice,
          reorder_level: initialReorder,
          max_stock_level: initialMaxStock
        };
      });
      setRows(mappedRows);
    } else if (invNo) {
      // Fetch medicines for invoice from backend if not provided in state
      setLoading(true);
      api.getSellPriceMedicinesByInvoice(invNo)
        .then(res => {
          const fetchedItems = res.saved_medicines || res.saved_items || [];
          if (Array.isArray(fetchedItems) && fetchedItems.length > 0) {
            const mappedRows: SellPriceRow[] = fetchedItems.map((item: any) => ({
              medicine_id: item.medicine_id || item.id || 0,
              medicine_name: item.medicine_name || item.name || 'Unknown Item',
              rate: Number(item.rate || item.cost_price || 0),
              mrp: Number(item.mrp || 0),
              sell_price: item.sell_price !== null && item.sell_price !== undefined ? String(item.sell_price) : '',
              reorder_level: item.reorder_level !== null && item.reorder_level !== undefined ? String(item.reorder_level) : '10',
              max_stock_level: item.max_stock_level !== null && item.max_stock_level !== undefined ? String(item.max_stock_level) : ''
            }));
            setRows(mappedRows);
          }
        })
        .catch(err => {
          console.error('Failed to load items for invoice:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [location.state, searchParams]);

  const handleSellPriceChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      row.sell_price = val;
      row.warning = null;

      const numVal = parseFloat(val);
      if (!isNaN(numVal) && row.mrp > 0 && numVal > row.mrp) {
        // Clamp to MRP if user enters price > MRP
        row.sell_price = String(row.mrp);
        row.warning = 'Sell price cannot exceed MRP. Clamped to MRP.';
      }

      next[index] = row;
      return next;
    });
  };

  const handleReorderChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], reorder_level: val };
      return next;
    });
  };

  const handleMaxStockChange = (index: number, val: string) => {
    setRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], max_stock_level: val };
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

  const renderDiscountBadge = (mrp: number, sellPriceStr: string) => {
    const disc = calculateDiscount(mrp, sellPriceStr);
    if (disc === null || disc === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg3 text-muted font-medium text-xs font-mono border border-glass-border">
          No discount
        </span>
      );
    }
    if (disc <= 10) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 font-semibold text-xs font-mono border border-amber-500/20">
          <Percent className="w-3 h-3" />
          {disc}%
        </span>
      );
    }
    if (disc <= 25) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold text-xs font-mono border border-emerald-500/20">
          <Percent className="w-3 h-3" />
          {disc}%
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 font-semibold text-xs font-mono border border-rose-500/20" title="Deep discount warning">
        <Percent className="w-3 h-3" />
        {disc}%
      </span>
    );
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = rows.map(r => {
        const numSellPrice = parseFloat(r.sell_price);
        const numReorder = parseInt(r.reorder_level, 10);
        const numMaxStock = parseInt(r.max_stock_level, 10);

        return {
          medicine_id: r.medicine_id,
          sell_price: !isNaN(numSellPrice) && numSellPrice > 0 ? numSellPrice : null,
          reorder_level: !isNaN(numReorder) && numReorder >= 0 ? numReorder : null,
          max_stock_level: !isNaN(numMaxStock) && numMaxStock >= 0 ? numMaxStock : null
        };
      });

      await api.updateBulkSellPrices(payload);
      setSuccessMsg('Sell prices and stock levels updated successfully!');
      setTimeout(() => {
        navigate('/purchases');
      }, 1000);
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-bg2 p-5 rounded-2xl border border-glass-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 text-primary">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text flex items-center gap-2">
              {isEdit ? 'Edit Sell Prices & Stock Limits' : 'Set Sell Prices & Stock Limits'}
              {invoiceNo && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-bg3 text-muted font-medium border border-glass-border">
                  Invoice: {invoiceNo}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted">
              Configure target selling prices, minimum stock alerts (reorder level), and maximum stock capacity per product.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSkip}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-glass-border bg-bg hover:bg-bg3 text-text text-sm font-medium transition-colors disabled:opacity-50"
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

      {/* Info Tip Banner */}
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 flex items-start gap-3 text-xs text-text">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-primary">Sell Price & Stock Limits:</span> Setting a target sell price automatically computes the discount percentage in POS billing. Min Stock (Reorder Level) triggers low-stock alerts, while Max Stock prevents over-purchasing.
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

      {/* Loading state */}
      {loading ? (
        <div className="text-center p-12 bg-bg2 rounded-2xl border border-glass-border">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted">Loading purchase bill medicines...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center p-12 bg-bg2 rounded-2xl border border-glass-border">
          <Tag className="w-12 h-12 text-muted mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-semibold text-text mb-1">No items found for configuration</h3>
          <p className="text-sm text-muted mb-4">No medicines were passed or retrieved for this purchase bill.</p>
          <button
            onClick={handleSkip}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Purchases
          </button>
        </div>
      ) : (
        <div className="bg-bg2 rounded-2xl border border-glass-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg3/60 text-muted uppercase text-[11px] tracking-wider font-semibold border-b border-glass-border">
                <tr>
                  <th className="py-3.5 px-4 w-12 text-center">#</th>
                  <th className="py-3.5 px-4">Medicine Name</th>
                  <th className="py-3.5 px-4 w-28 text-right">Cost Rate (₹)</th>
                  <th className="py-3.5 px-4 w-28 text-right">MRP (₹)</th>
                  <th className="py-3.5 px-4 w-40">Target Sell Price (₹)</th>
                  <th className="py-3.5 px-4 w-32 text-center">Auto-Discount (%)</th>
                  <th className="py-3.5 px-4 w-36">Min Stock (Reorder)</th>
                  <th className="py-3.5 px-4 w-36">Max Stock Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border">
                {rows.map((row, idx) => {
                  const numSellPrice = parseFloat(row.sell_price);
                  const isBelowCost = !isNaN(numSellPrice) && numSellPrice > 0 && numSellPrice < row.rate;

                  return (
                    <tr key={row.medicine_id || idx} className="hover:bg-bg3/40 transition-colors">
                      <td className="py-3.5 px-4 text-center font-medium text-muted">{idx + 1}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-text">{row.medicine_name}</div>
                        {isBelowCost && (
                          <div className="flex items-center gap-1 text-xs text-rose-500 mt-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>⚠️ Sell price is below cost price (₹{row.rate.toFixed(2)}). You will make a loss.</span>
                          </div>
                        )}
                        {row.warning && (
                          <div className="flex items-center gap-1 text-xs text-amber-500 mt-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>{row.warning}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right text-muted font-mono font-medium">
                        ₹{row.rate.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right text-text font-mono font-semibold">
                        ₹{row.mrp.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4">
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
                            className="w-full pl-7 pr-3 py-2 rounded-xl border border-glass-border bg-bg text-text text-sm font-mono font-bold focus:outline-none focus:border-primary transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {renderDiscountBadge(row.mrp, row.sell_price)}
                      </td>
                      <td className="py-3.5 px-4">
                        <input
                          type="number"
                          min="0"
                          placeholder="10"
                          value={row.reorder_level}
                          onChange={(e) => handleReorderChange(idx, e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-glass-border bg-bg text-text text-sm font-mono font-semibold focus:outline-none focus:border-primary transition-colors"
                        />
                      </td>
                      <td className="py-3.5 px-4">
                        <input
                          type="number"
                          min="0"
                          placeholder="Max"
                          value={row.max_stock_level}
                          onChange={(e) => handleMaxStockChange(idx, e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-glass-border bg-bg text-text text-sm font-mono font-semibold focus:outline-none focus:border-primary transition-colors"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-bg3/30 border-t border-glass-border flex items-center justify-between">
            <p className="text-xs text-muted">
              Note: Leave sell price blank or set equal to MRP to sell at standard MRP (no discount).
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSkip}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-glass-border bg-bg hover:bg-bg3 text-text text-sm font-medium transition-colors"
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
