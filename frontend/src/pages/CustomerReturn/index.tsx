import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { CheckCircle, RotateCcw, AlertCircle, History, QrCode, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { formatDisplayDate } from '../../utils/date';

interface SaleItem {
  sale_item_id: number;
  inventory_id: number;
  medicine_id?: number | null;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  unit_price: number;
  discount_per?: number;
  returned_qty: number;
}

interface LocalReturnInvoice {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
}

interface LocalPrevReturn {
  medicine_id: number;
  batch_no: string;
  returned_qty: number;
}

type LocalBarcodeInfo = Awaited<ReturnType<typeof api.generateSaleInvoiceBarcode>>;

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

export default function CustomerReturn() {
  const queryClient = useQueryClient();
  const [invoiceNo, setInvoiceNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<LocalReturnInvoice | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [barcodeInfo, setBarcodeInfo] = useState<LocalBarcodeInfo | null>(null);
  const [_, setSearchParams] = useSearchParams();

  const cleanInvoiceNoString = (raw: string) => {
    let text = raw.trim();
    if (text.includes('|')) {
      text = text.split('|')[0].trim();
    }
    return text;
  };

  const handleSearch = async (targetNo?: string | React.SyntheticEvent) => {
    const rawNo = typeof targetNo === 'string' ? targetNo : invoiceNo;
    const searchVal = cleanInvoiceNoString(rawNo);
    if (!searchVal) return;
    setLoading(true);
    setError(null);
    setBarcodeInfo(null);
    try {
      const data = await api.searchInvoiceForReturn(searchVal);
      setInvoice(data.invoice);
      setInvoiceNo(data.invoice.invoice_no);
      
      const enrichedItems = data.items.map((item: SaleItem) => {
        // Find if this item was already returned
        const prev = data.previousReturns.find((p: LocalPrevReturn) => p.medicine_id === item.medicine_id && p.batch_no === item.batch_no);
        return {
          ...item,
          returned_qty: prev ? prev.returned_qty : 0
        };
      });
      
      setItems(enrichedItems);
      setReturnQuantities({});

      // Fetch invoice barcode info for display & return receipts
      api.generateSaleInvoiceBarcode(data.invoice.invoice_no).then(bc => {
        if (bc.success) setBarcodeInfo(bc);
      }).catch(() => {});
    } catch (err) {
      const e = err as LocalApiError;
      setError(e.response?.data?.error || 'Invoice not found');
      setInvoice(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQtyChange = (itemId: number, qtyStr: string, maxQty: number) => {
    const qty = parseInt(qtyStr) || 0;
    if (qty < 0) return;
    if (qty > maxQty) return;
    setReturnQuantities(prev => ({ ...prev, [itemId]: qty }));
  };

  const handleSubmit = async () => {
    const returnItems = items
      .filter(item => returnQuantities[item.sale_item_id] > 0)
      .map(item => ({
        inventory_id: item.inventory_id,
        quantity: returnQuantities[item.sale_item_id],
        unit_price: item.unit_price,
        discount_per: item.discount_per
      }));

    if (returnItems.length === 0) {
      setError('Please specify return quantities for at least one item');
      return;
    }

    try {
      setLoading(true);
      await api.createCustomerReturn({
        original_invoice_id: invoice!.id,
        return_items: returnItems,
        reason
      });
      alert('Return processed successfully!');
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});
      setInvoice(null);
      setItems([]);
      setReturnQuantities({});
      setInvoiceNo('');
      setReason('');
    } catch (err) {
      const e = err as LocalApiError;
      setError(e.response?.data?.error || 'Failed to process return');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + S: Save Returns Bill
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSubmitRef.current();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const totalRefund = items.reduce((sum, item) => {
    const qty = returnQuantities[item.sale_item_id] || 0;
    return sum + (qty * item.unit_price * (1 - (item.discount_per || 0) / 100));
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setSearchParams({ tab: 'customer-history' })}
          className="btn-secondary flex items-center gap-2"
        >
          <History className="w-4 h-4" />
          View Return History
        </button>
      </div>

      <div className="premium-card p-6">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Original Invoice Number</label>
            <div className="relative">
              <input
                type="text"
                className="premium-input w-full font-mono text-sm"
                placeholder="Scan barcode or type bill no (e.g. S-2026-0001)"
                value={invoiceNo}
                onChange={e => {
                  const val = e.target.value;
                  setInvoiceNo(val);
                  if (val.includes('|')) {
                    const cleaned = cleanInvoiceNoString(val);
                    setInvoiceNo(cleaned);
                    handleSearch(cleaned);
                  }
                }}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>
          <button 
            className="btn-primary py-2.5 px-6"
            onClick={() => handleSearch()}
            disabled={loading || !invoiceNo}
          >
            {loading ? 'Searching...' : 'Search Invoice'}
          </button>
        </div>
        
        {error && (
          <div className="mt-4 p-4 bg-red/10 border border-red/20 rounded-xl flex items-start gap-3 text-red">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
      </div>

      {invoice && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="premium-card p-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border bg-bg3/40">
                <h2 className="font-bold text-text flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Invoice Details: <span className="font-mono">{invoice.invoice_no}</span>
                </h2>
                <p className="text-xs text-muted font-medium mt-1">Date: {formatDisplayDate(invoice.date)}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-bg3/60 border-b border-glass-border text-muted">
                    <tr>
                      <th className="p-4 font-semibold">Medicine</th>
                      <th className="p-4 font-semibold">Batch & Exp</th>
                      <th className="p-4 font-semibold text-right">Sold Qty</th>
                      <th className="p-4 font-semibold text-right">Already Returned</th>
                      <th className="p-4 font-semibold text-right">Return Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-glass-border/40">
                    {items.map((item) => {
                      const availableToReturn = item.quantity - item.returned_qty;
                      return (
                        <tr key={item.sale_item_id} className="hover:bg-bg3/40 transition-colors">
                          <td className="p-4 text-text font-bold">{item.medicine_name}</td>
                          <td className="p-4">
                            <span className="text-xs font-mono px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-text font-bold">
                              {item.batch_no}
                            </span>
                          </td>
                          <td className="p-4 text-right text-text font-mono font-semibold">{item.quantity}</td>
                          <td className="p-4 text-right text-rose-400 font-mono font-semibold">{item.returned_qty > 0 ? item.returned_qty : '-'}</td>
                          <td className="p-4 text-right">
                            <input
                              type="number"
                              min="0"
                              max={availableToReturn}
                              className="premium-input w-24 text-right py-1.5 font-mono font-bold"
                              placeholder="0"
                              disabled={availableToReturn <= 0}
                              value={returnQuantities[item.sale_item_id] || ''}
                              onChange={(e) => handleQtyChange(item.sale_item_id, e.target.value, availableToReturn)}
                            />
                            {availableToReturn <= 0 && <span className="block text-[10px] text-muted font-semibold mt-1">Max returned</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          <div>
            <div className="premium-card p-6 sticky top-6">
              <h3 className="font-semibold text-text mb-4 flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-sky" />
                Return Summary
              </h3>
              
              <div className="space-y-4">
                {barcodeInfo && (
                  <div className="p-3 bg-bg2/70 rounded-xl border border-glass-border space-y-2">
                    <div className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center justify-between">
                      <span className="flex items-center gap-1"><QrCode size={12} className="text-purple-400" /> Invoice Barcode</span>
                      <button
                        type="button"
                        onClick={() => window.open(barcodeInfo.pdfUrl, '_blank')}
                        className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Printer size={11} /> Print Label
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <img src={barcodeInfo.qrDataUrl} alt="QR" className="w-12 h-12 bg-white p-1 rounded shrink-0 shadow-sm" />
                      <div className="overflow-hidden">
                        <img src={barcodeInfo.code128DataUrl} alt="Code128" className="h-7 bg-white p-1 rounded max-w-[150px]" />
                        <div className="text-[9px] font-mono text-muted mt-0.5 truncate">{barcodeInfo.barcodeText}</div>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Reason for Return</label>
                  <textarea
                    className="premium-input w-full min-h-[80px] resize-none"
                    placeholder="e.g. Doctor changed prescription..."
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </div>
                
                <div className="pt-4 border-t border-white/10">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-muted">Est. Refund (inc. Tax)</span>
                    <span className="text-xl font-bold text-emerald">₹{(totalRefund * 1.05).toFixed(2)}</span>
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    By confirming this return, the selected quantities will automatically be added back into inventory stock under their respective batches.
                  </p>
                </div>
                
                <button
                  className="btn-primary w-full py-3 mt-4"
                  onClick={handleSubmit}
                  disabled={loading || totalRefund <= 0}
                >
                  {loading ? 'Processing...' : 'Confirm Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
