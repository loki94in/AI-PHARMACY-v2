import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Trash2, AlertTriangle, RefreshCw, Receipt, ShoppingCart, User, Calendar, Plus, Pill } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  onClose: () => void;
  onActionComplete: () => void;
}

export const StagedReviewModal: React.FC<Props> = ({ onClose, onActionComplete }) => {
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing transaction state
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [distributorName, setDistributorName] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [discount, setDiscount] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const loadStagedData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [stagedSales, stagedPurchases] = await Promise.all([
        api.getStagedSales(),
        api.getStagedPurchases(),
      ]);
      setSales(stagedSales || []);
      setPurchases(stagedPurchases || []);
    } catch (err: any) {
      console.error('Failed to load staged transactions:', err);
      setError(err.message || 'Failed to load staged transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStagedData();
  }, []);

  const handleSelectTx = (tx: any, type: 'sales' | 'purchases') => {
    setSelectedTx({ ...tx, type });
    try {
      const items = typeof tx.items_json === 'string' ? JSON.parse(tx.items_json) : tx.items_json;
      setEditingItems(Array.isArray(items) ? items : []);
    } catch (e) {
      setEditingItems([]);
    }

    if (type === 'purchases') {
      setDistributorName(tx.distributor_name || '');
      setInvoiceNo(tx.invoice_no || '');
    } else {
      setPatientName(tx.patient_name || '');
      setPatientPhone(tx.patient_phone || '');
      setDiscount(tx.discount || 0);
    }
  };

  const handleUpdateItemField = (index: number, field: string, value: any) => {
    const updated = [...editingItems];
    if (field === 'quantity' || field === 'free_qty') {
      updated[index][field] = parseInt(value) || 0;
    } else if (field === 'rate' || field === 'mrp' || field === 'unit_price') {
      updated[index][field] = parseFloat(value) || 0;
    } else {
      updated[index][field] = value;
    }
    setEditingItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    const updated = [...editingItems];
    updated.splice(index, 1);
    setEditingItems(updated);
  };

  const handleApprove = async () => {
    if (!selectedTx) return;
    setSaving(true);
    setError(null);
    try {
      if (selectedTx.type === 'sales') {
        await api.approveStagedSale(selectedTx.id, {
          items: editingItems,
          patient_name: patientName,
          patient_phone: patientPhone,
          discount: Number(discount),
        });
      } else {
        const total_amount = editingItems.reduce((sum, item) => sum + (item.quantity * (item.rate || item.unit_price || 0)), 0);
        await api.approveStagedPurchase(selectedTx.id, {
          items: editingItems,
          distributor_name: distributorName,
          invoice_no: invoiceNo,
          total_amount,
        });
      }
      setSelectedTx(null);
      await loadStagedData();
      onActionComplete();
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Failed to approve transaction');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (id: number, type: 'sales' | 'purchases') => {
    if (!window.confirm('Are you sure you want to reject and delete this staged transaction?')) return;
    setLoading(true);
    setError(null);
    try {
      if (type === 'sales') {
        await api.rejectStagedSale(id);
      } else {
        await api.rejectStagedPurchase(id);
      }
      setSelectedTx(null);
      await loadStagedData();
      onActionComplete();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to reject transaction');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const activeList = activeTab === 'sales' ? sales : purchases;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-6 fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative bg-bg border border-border rounded-2xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden slide-up text-text">
        {/* Header */}
        <div className="p-5 border-b border-border bg-bg2 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary animate-pulse">
              <RefreshCw size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight">Mobile Sync Review Queue</h3>
              <p className="text-xs text-muted mt-0.5">Approve offline transactions logged on the mobile app</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-bg3 text-muted hover:text-text transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs Row */}
        <div className="flex bg-bg2 border-b border-border shrink-0 px-4">
          <button
            onClick={() => { setActiveTab('sales'); setSelectedTx(null); }}
            className={`py-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'sales'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <ShoppingCart size={16} />
            Staged Sales ({sales.length})
          </button>
          <button
            onClick={() => { setActiveTab('purchases'); setSelectedTx(null); }}
            className={`py-3 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'purchases'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Receipt size={16} />
            Staged Purchases ({purchases.length})
          </button>
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          
          {/* Left panel: List of staged transactions */}
          <div className="w-full lg:w-2/5 border-r border-border overflow-y-auto p-4 scrollbar-custom bg-bg2">
            {error && !selectedTx && (
              <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0" size={20} />
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted">
                <RefreshCw size={32} className="animate-spin mb-4 text-primary" />
                <p>Loading staged sync items...</p>
              </div>
            ) : activeList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted text-center p-4">
                <Check size={40} className="text-emerald-500 mb-4 bg-emerald-500/10 p-2 rounded-full" />
                <p className="font-bold">Sync Queue Clear</p>
                <p className="text-xs text-muted mt-1">No staged {activeTab} awaiting approval.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeList.map((tx) => {
                  let items: any[] = [];
                  try {
                    items = typeof tx.items_json === 'string' ? JSON.parse(tx.items_json) : tx.items_json;
                  } catch (e) {}

                  const itemSummary = Array.isArray(items) 
                    ? items.slice(0, 3).map(i => `${i.name || i.medicine_name} (x${i.quantity})`).join(', ') + (items.length > 3 ? '...' : '')
                    : 'No items';

                  return (
                    <div
                      key={tx.id}
                      onClick={() => handleSelectTx(tx, activeTab)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        selectedTx?.id === tx.id && selectedTx?.type === activeTab
                          ? 'bg-primary/10 border-primary shadow-md'
                          : 'bg-bg border-border hover:border-glass-border'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold truncate max-w-[180px]">
                          {activeTab === 'sales' ? tx.patient_name || 'Walk-in Customer' : tx.distributor_name}
                        </div>
                        <div className="text-xs text-muted flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDate(tx.sale_date || tx.date)}
                        </div>
                      </div>

                      {activeTab === 'purchases' && tx.invoice_no && (
                        <div className="text-xs font-mono text-primary bg-primary/5 px-2 py-0.5 rounded inline-block mb-2">
                          Invoice: {tx.invoice_no}
                        </div>
                      )}

                      <div className="text-xs text-muted mb-3 line-clamp-1">{itemSummary}</div>

                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold text-accent">
                          ₹{Number(tx.total_amount || 0).toLocaleString('en-IN')}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReject(tx.id, activeTab);
                            }}
                            className="p-1.5 rounded hover:bg-red-500/20 text-red-500 hover:text-red-400 transition-colors"
                            title="Reject & Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                              selectedTx?.id === tx.id && selectedTx?.type === activeTab
                                ? 'bg-primary text-white'
                                : 'bg-bg3 hover:bg-border text-text'
                            }`}
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel: Detail editing and confirmation */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar-custom bg-bg">
            {selectedTx ? (
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-border pb-4">
                  <div>
                    <h4 className="text-lg font-bold">Reviewing Sync Item</h4>
                    <p className="text-xs text-muted">ID: {selectedTx.id} • Sync Date: {formatDate(selectedTx.sale_date || selectedTx.date)}</p>
                  </div>
                  <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-bold animate-pulse">
                    Staged Pending
                  </span>
                </div>

                {error && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                    <AlertTriangle className="text-red-500 shrink-0" size={20} />
                    <p className="text-sm text-red-500">{error}</p>
                  </div>
                )}

                {/* Primary Info Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-bg2 p-4 rounded-xl border border-border">
                  {selectedTx.type === 'purchases' ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-muted mb-1">Distributor Name</label>
                        <input
                          type="text"
                          value={distributorName}
                          onChange={(e) => setDistributorName(e.target.value)}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-muted mb-1">Invoice Number</label>
                        <input
                          type="text"
                          value={invoiceNo}
                          onChange={(e) => setInvoiceNo(e.target.value)}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-muted mb-1">Patient Name</label>
                        <input
                          type="text"
                          value={patientName}
                          onChange={(e) => setPatientName(e.target.value)}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-muted mb-1">Patient Phone</label>
                        <input
                          type="text"
                          value={patientPhone}
                          onChange={(e) => setPatientPhone(e.target.value)}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-muted mb-1">Discount Amount (₹)</label>
                        <input
                          type="number"
                          value={discount}
                          onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Items Editor */}
                <div>
                  <h5 className="text-sm font-bold mb-3 uppercase tracking-wider text-muted">Bill Line Items ({editingItems.length})</h5>
                  
                  <div className="space-y-3">
                    {editingItems.map((item, index) => (
                      <div key={index} className="bg-bg2 border border-border rounded-xl p-4">
                        <div className="flex justify-between items-start gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 bg-border rounded-full flex items-center justify-center text-xs font-bold">
                              {index + 1}
                            </span>
                            <span className="font-bold text-sm">{item.name || item.medicine_name}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveItem(index)}
                            className="p-1 rounded hover:bg-bg3 text-red-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[10px] text-muted mb-1">Quantity</label>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItemField(index, 'quantity', e.target.value)}
                              className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center font-bold"
                            />
                          </div>

                          {selectedTx.type === 'purchases' && (
                            <div>
                              <label className="block text-[10px] text-muted mb-1">Free Qty</label>
                              <input
                                type="number"
                                value={item.free_qty || 0}
                                onChange={(e) => handleUpdateItemField(index, 'free_qty', e.target.value)}
                                className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] text-muted mb-1">
                              {selectedTx.type === 'sales' ? 'Unit Price (₹)' : 'Cost Rate (₹)'}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.rate !== undefined ? item.rate : (item.unit_price !== undefined ? item.unit_price : 0)}
                              onChange={(e) => handleUpdateItemField(index, selectedTx.type === 'sales' ? 'unit_price' : 'rate', e.target.value)}
                              className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center"
                            />
                          </div>

                          {selectedTx.type === 'purchases' && (
                            <div>
                              <label className="block text-[10px] text-muted mb-1">MRP (₹)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={item.mrp || 0}
                                onChange={(e) => handleUpdateItemField(index, 'mrp', e.target.value)}
                                className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] text-muted mb-1">Batch No</label>
                            <input
                              type="text"
                              value={item.batch_no || ''}
                              onChange={(e) => handleUpdateItemField(index, 'batch_no', e.target.value)}
                              className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-muted mb-1">Expiry Date</label>
                            <input
                              type="text"
                              placeholder="MM/YY"
                              value={item.expiry_date || ''}
                              onChange={(e) => handleUpdateItemField(index, 'expiry_date', e.target.value)}
                              className="w-full px-2 py-1 bg-bg border border-border rounded text-xs text-center"
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {editingItems.length === 0 && (
                      <div className="p-6 text-center text-muted border border-dashed border-border rounded-xl">
                        All items removed. You must reject this transaction or re-add items.
                      </div>
                    )}
                  </div>
                </div>

                {/* Confirmations & Pricing */}
                <div className="flex flex-col sm:flex-row justify-between items-center border-t border-border pt-6 gap-4">
                  <div className="text-center sm:text-left">
                    <div className="text-xs text-muted">Total Transaction Amount</div>
                    <div className="text-2xl font-bold text-accent">
                      ₹
                      {editingItems
                        .reduce((sum, item) => sum + (item.quantity * (item.rate || item.unit_price || 0)), 0)
                        .toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedTx(null)}
                      className="px-5 py-2 border border-border hover:bg-bg2 rounded-xl text-sm font-medium transition-colors text-muted hover:text-text"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleApprove}
                      disabled={saving || editingItems.length === 0}
                      className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      {saving ? 'Processing...' : 'Approve & Save'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted py-20">
                <Receipt size={64} className="text-border mb-4" />
                <h4 className="font-bold text-text">No Transaction Selected</h4>
                <p className="text-sm text-center max-w-sm mt-2">
                  Select a queued transaction from the list on the left to review invoice details, edit items, and approve into inventory.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};
