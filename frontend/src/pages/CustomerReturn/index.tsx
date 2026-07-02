import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { CheckCircle, RotateCcw, AlertCircle, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SaleItem {
  sale_item_id: number;
  inventory_id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  unit_price: number;
  discount_per?: number;
  returned_qty: number;
}

export default function CustomerReturn() {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const navigate = useNavigate();

  const handleSearch = async () => {
    if (!invoiceNo.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchInvoiceForReturn(invoiceNo.trim());
      setInvoice(data.invoice);
      
      const enrichedItems = data.items.map((item: any) => {
        // Find if this item was already returned
        const prev = data.previousReturns.find((p: any) => p.medicine_id === item.medicine_id && p.batch_no === item.batch_no);
        return {
          ...item,
          returned_qty: prev ? prev.returned_qty : 0
        };
      });
      
      setItems(enrichedItems);
      setReturnQuantities({});
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invoice not found');
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
        original_invoice_id: invoice.id,
        return_items: returnItems,
        reason
      });
      alert('Return processed successfully!');
      setInvoice(null);
      setItems([]);
      setReturnQuantities({});
      setInvoiceNo('');
      setReason('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to process return');
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
          onClick={() => navigate('/customer-returns-history')}
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
                className="premium-input w-full"
                placeholder="e.g. S-2026-0001"
                value={invoiceNo}
                onChange={e => setInvoiceNo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>
          <button 
            className="btn-primary py-2.5 px-6"
            onClick={handleSearch}
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
              <div className="p-4 border-b border-white/5 bg-white/2">
                <h2 className="font-semibold text-text flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald" />
                  Invoice Details: {invoice.invoice_no}
                </h2>
                <p className="text-xs text-muted mt-1">Date: {new Date(invoice.date).toLocaleDateString()}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 border-b border-white/10 text-muted">
                    <tr>
                      <th className="p-4 font-medium">Medicine</th>
                      <th className="p-4 font-medium">Batch & Exp</th>
                      <th className="p-4 font-medium text-right">Sold Qty</th>
                      <th className="p-4 font-medium text-right">Already Returned</th>
                      <th className="p-4 font-medium text-right">Return Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {items.map((item) => {
                      const availableToReturn = item.quantity - item.returned_qty;
                      return (
                        <tr key={item.sale_item_id} className="hover:bg-white/5 transition-colors">
                          <td className="p-4 text-text font-medium">{item.medicine_name}</td>
                          <td className="p-4">
                            <span className="text-xs font-mono px-2 py-1 bg-white/5 rounded text-muted">
                              {item.batch_no}
                            </span>
                          </td>
                          <td className="p-4 text-right text-muted">{item.quantity}</td>
                          <td className="p-4 text-right text-rose/80">{item.returned_qty > 0 ? item.returned_qty : '-'}</td>
                          <td className="p-4 text-right">
                            <input
                              type="number"
                              min="0"
                              max={availableToReturn}
                              className="premium-input w-24 text-right py-1.5"
                              placeholder="0"
                              disabled={availableToReturn <= 0}
                              value={returnQuantities[item.sale_item_id] || ''}
                              onChange={(e) => handleQtyChange(item.sale_item_id, e.target.value, availableToReturn)}
                            />
                            {availableToReturn <= 0 && <span className="block text-[10px] text-muted mt-1">Max returned</span>}
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
