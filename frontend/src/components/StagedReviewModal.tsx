import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Check, Trash2, AlertTriangle, RefreshCw, Receipt, ShoppingCart, Calendar, Search, Plus, Link2, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { stagedQueueService } from '../services/stagedQueueService';
import { isValidDistributorName } from '../utils/distributorValidator';
import { UniversalMedicineEditModal, type UniversalMedicineEditModalProps } from './UniversalMedicineEditModal';

interface Props {
  onClose: () => void;
  onActionComplete: () => void;
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

interface LocalStagedTx {
  id: number;
  items_json?: string | unknown[];
  distributor_name?: string;
  invoice_no?: string;
  date?: string;
  sale_date?: string;
  patient_name?: string;
  patient_phone?: string;
  doctor_name?: string;
  discount?: number;
  payment_medium?: string;
  total_amount?: number;
}

interface LocalStagedItem {
  medicine_id?: number | null;
  name?: string;
  medicine_name?: string;
  manufacturer?: string | null;
  mrp?: number | string | null;
  rate?: number;
  cost_price?: number | null;
  unit_price?: number;
  batch_no?: string | null;
  expiry_date?: string | null;
  quantity: number;
  free_qty?: number | null;
}

interface LocalCatalogHit {
  id: number;
  name: string;
  manufacturer?: string | null;
  mrp?: number | string | null;
}

interface LocalDistributorRow {
  id: number;
  name?: string | null;
  distributor_name?: string | null;
}

interface MatchSuggestion {
  medicine_id: number | null;
  matched_name: string | null;
  confidence: number;
  match_type: string;
}

const isUnresolvedDistributor = (name: string | null | undefined): boolean => {
  return !isValidDistributorName(name);
};

export const StagedReviewModal: React.FC<Props> = ({ onClose, onActionComplete }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [sales, setSales] = useState<LocalStagedTx[]>([]);
  const [purchases, setPurchases] = useState<LocalStagedTx[]>([]);
  const [registeredDistributors, setRegisteredDistributors] = useState<LocalDistributorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing transaction state
  const [selectedTx, setSelectedTx] = useState<(LocalStagedTx & { type: 'sales' | 'purchases' }) | null>(null);
  const [editingItems, setEditingItems] = useState<LocalStagedItem[]>([]);
  const [distributorName, setDistributorName] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [discount, setDiscount] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // Strict per-line medicine resolution (human verification contract)
  const [matchPreview, setMatchPreview] = useState<Record<number, MatchSuggestion>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [lineSearchTerms, setLineSearchTerms] = useState<Record<number, string>>({});
  const [lineSearchResults, setLineSearchResults] = useState<Record<number, LocalCatalogHit[]>>({});
  const [medEditorIndex, setMedEditorIndex] = useState<number | null>(null);
  const [medEditorInitialData, setMedEditorInitialData] = useState<UniversalMedicineEditModalProps['initialData']>(null);
  const [medEditorOcrData, setMedEditorOcrData] = useState<UniversalMedicineEditModalProps['ocrData'] | null>(null);

  const itemNameOf = (it: LocalStagedItem): string => String(it?.name || it?.medicine_name || '').trim();

  // Refresh entry used by user-action paths: gates loading/errors explicitly
  // (the mount path relies on the initial loading=true / error=null state).
  const loadStagedData = async () => {
    try {
      const [stagedSales, stagedPurchases, distList] = await Promise.all([
        api.getStagedSales(),
        api.getStagedPurchases(),
        api.getDistributors().catch(() => []),
      ]);
      setSales(stagedSales || []);
      setPurchases(stagedPurchases || []);
      setRegisteredDistributors(Array.isArray(distList) ? distList : []);
    } catch (err) {
      const e = err as LocalApiError;
      console.error('Failed to load staged transactions:', err);
      setError(e.message || 'Failed to load staged transactions');
    } finally {
      setLoading(false);
    }
  };

  const reloadStagedData = async () => {
    setLoading(true);
    setError(null);
    await loadStagedData();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async staged-data load on modal mount
    loadStagedData();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelectTx = (tx: LocalStagedTx, type: 'sales' | 'purchases') => {
    setSelectedTx({ ...tx, type });
    let parsedItems: LocalStagedItem[] = [];
    try {
      const raw = typeof tx.items_json === 'string' ? JSON.parse(tx.items_json) : tx.items_json;
      parsedItems = Array.isArray(raw) ? raw : [];
    } catch (_e) {
      parsedItems = [];
    }
    setEditingItems(parsedItems);

    if (type === 'purchases') {
      setDistributorName(tx.distributor_name || '');
      setInvoiceNo(tx.invoice_no || '');
      setInvoiceDate(tx.date ? tx.date.split('T')[0] : '');
      // One batched server call on explicit Review click (no mount saturation).
      setMatchPreview({});
      setLineSearchTerms({});
      setLineSearchResults({});
      if (parsedItems.length > 0) {
        const needsPreview = parsedItems.some((it) => !it.medicine_id && itemNameOf(it));
        if (needsPreview) {
          const names = parsedItems.map((it) => itemNameOf(it));
          setPreviewLoading(true);
          api.matchPurchaseItems(names, null)
            .then((res) => {
              const map: Record<number, MatchSuggestion> = {};
              (res?.results || []).forEach((r: MatchSuggestion, i: number) => {
                if (r?.medicine_id && !parsedItems[i]?.medicine_id) map[i] = r;
              });
              setMatchPreview(map);
            })
            .catch(() => {})
            .finally(() => setPreviewLoading(false));
        }
      }
    } else {
      setPatientName(tx.patient_name || '');
      setPatientPhone(tx.patient_phone || '');
      setDiscount(tx.discount || 0);
    }
  };

  const handleReviewInPOS = (index: number) => {
    const formattedQueue = sales.map(s => ({
      id: s.id,
      type: 'sales' as const,
      patient_name: s.patient_name,
      patient_phone: s.patient_phone,
      doctor_name: s.doctor_name,
      discount: s.discount,
      payment_medium: s.payment_medium,
      total_amount: s.total_amount,
      items_json: s.items_json,
    }));

    stagedQueueService.startQueue(formattedQueue, index);
    onClose();
    if (window.location.pathname !== '/pos') {
      navigate('/pos');
    }
  };

  const handleUpdateItemField = (
    index: number,
    field: 'quantity' | 'free_qty' | 'rate' | 'mrp' | 'unit_price' | 'batch_no' | 'expiry_date',
    value: string
  ) => {
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

  // --- Strict medicine resolution helpers (search-or-create per line) ---

  const setItemMedicine = (index: number, patch: Partial<LocalStagedItem>) => {
    setEditingItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
    setMatchPreview(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleLinkSuggestion = (index: number) => {
    const sugg = matchPreview[index];
    if (!sugg?.medicine_id) return;
    setItemMedicine(index, { medicine_id: sugg.medicine_id });
  };

  const handleLineSearch = async (index: number, term: string) => {
    setLineSearchTerms(prev => ({ ...prev, [index]: term }));
    if (term.trim().length < 3) {
      setLineSearchResults(prev => ({ ...prev, [index]: [] }));
      return;
    }
    try {
      const res = await api.catalogSearch(term.trim());
      setLineSearchResults(prev => ({ ...prev, [index]: Array.isArray(res) ? res.slice(0, 8) : [] }));
    } catch (_e) {
      setLineSearchResults(prev => ({ ...prev, [index]: [] }));
    }
  };

  const openNewMedicineEditor = (index: number) => {
    const it = editingItems[index];
    if (!it) return;
    setMedEditorIndex(index);
    setMedEditorInitialData(null);
    setMedEditorOcrData({
      potentialName: itemNameOf(it),
      manufacturer: it.manufacturer || '',
      mrp: Number(it.mrp) > 0 ? Number(it.mrp) : undefined,
      rate: Number(it.rate ?? it.cost_price) > 0 ? Number(it.rate ?? it.cost_price) : undefined,
      batchNumber: it.batch_no || '',
      expiryDate: it.expiry_date || ''
    });
  };

  const handlePickSearchResult = (index: number, med: LocalCatalogHit) => {
    setItemMedicine(index, { medicine_id: med.id, name: med.name });
    setLineSearchTerms(prev => ({ ...prev, [index]: '' }));
    setLineSearchResults(prev => ({ ...prev, [index]: [] }));
  };

  const closeMedEditor = () => {
    setMedEditorIndex(null);
    setMedEditorInitialData(null);
    setMedEditorOcrData(null);
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
        const cleanDist = (distributorName || '').trim();
        if (isUnresolvedDistributor(cleanDist)) {
          setError('Distributor unresolved. Please select the actual distributor before approving.');
          setSaving(false);
          return;
        }
        const cleanDate = (invoiceDate || '').trim();
        if (!cleanDate) {
          setError('Invoice date is required. Please enter or verify the actual invoice date before approving.');
          setSaving(false);
          return;
        }

        // Strict verification: every purchase line must be linked to a master medicine
        const unresolvedLines = editingItems
          .map((it, i) => ({ it, i }))
          .filter(x => x.it && !x.it.medicine_id);
        if (unresolvedLines.length > 0) {
          setError(
            `${unresolvedLines.length} line(s) not linked to a master medicine. Use search or ➕ New Medicine on each: ` +
            unresolvedLines.map(x => `"${itemNameOf(x.it) || 'Item ' + (x.i + 1)}"`).join(', ')
          );
          setSaving(false);
          return;
        }

        // Strict validation: Require legitimate MRP > 0 for all purchase items
        for (let i = 0; i < editingItems.length; i++) {
          const it = editingItems[i];
          const itName = it.name || it.medicine_name || `Item #${i + 1}`;
          const itMrp = Number(it.mrp || 0);
          if (isNaN(itMrp) || itMrp <= 0) {
            setError(`MRP is required for "${itName}". Please enter the actual MRP from invoice before approving.`);
            setSaving(false);
            return;
          }
        }

        const total_amount = editingItems.reduce((sum, item) => sum + (item.quantity * (item.rate || item.unit_price || 0)), 0);
        await api.approveStagedPurchase(selectedTx.id, {
          items: editingItems,
          distributor_name: cleanDist,
          invoice_no: invoiceNo,
          date: cleanDate,
          total_amount,
        });
      }
      setSelectedTx(null);
      await reloadStagedData();
      onActionComplete();
    } catch (err) {
      const e = err as LocalApiError;
      console.error(err);
      setError(e.response?.data?.error || e.message || 'Failed to approve transaction');
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
      await reloadStagedData();
      onActionComplete();
    } catch (err) {
      const e = err as LocalApiError;
      console.error(err);
      setError(e.message || 'Failed to reject transaction');
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
    <>
    <div className="fixed inset-0 z-submodal flex items-center justify-center p-4 sm:p-6 fade-in">
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
                {activeList.map((tx, index) => {
                  let items: LocalStagedItem[] = [];
                  try {
                    items = typeof tx.items_json === 'string' ? JSON.parse(tx.items_json) : (tx.items_json as LocalStagedItem[]);
                  } catch (_e) {}

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
                          {activeTab === 'sales' ? (
                            tx.patient_name || 'Walk-in Customer'
                          ) : !isUnresolvedDistributor(tx.distributor_name) ? (
                            <div className="flex flex-col">
                              <span className="truncate">{tx.distributor_name}</span>
                              <span className="text-[10px] text-emerald-400 font-semibold">✓ Distributor verified</span>
                            </div>
                          ) : (
                            <span className="text-amber-500 font-bold text-xs">⚠️ Distributor unresolved</span>
                          )}
                        </div>
                        <div className="text-xs text-muted flex items-center gap-1">
                          <Calendar size={12} />
                          {activeTab === 'sales'
                            ? formatDate((tx.sale_date || tx.date) as string)
                            : (tx.date ? formatDate(tx.date) : <span className="text-amber-500 font-bold text-[10px]">⚠️ Missing Date</span>)
                          }
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
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeTab === 'sales') {
                                handleReviewInPOS(index);
                              } else {
                                handleSelectTx(tx, activeTab);
                              }
                            }}
                            className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 ${
                              activeTab === 'sales'
                                ? 'bg-primary text-white hover:bg-primary/90 shadow-sm'
                                : selectedTx?.id === tx.id && selectedTx?.type === activeTab
                                ? 'bg-primary text-white'
                                : 'bg-bg3 hover:bg-border text-text'
                            }`}
                          >
                            <span>Review</span>
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
                    <p className="text-xs text-muted">ID: {selectedTx.id} • Sync Date: {selectedTx.date ? formatDate(selectedTx.sale_date || selectedTx.date) : 'Not extracted'}</p>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-bg2 p-4 rounded-xl border border-border">
                  {selectedTx.type === 'purchases' ? (
                    <>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-xs font-bold text-muted">Distributor Name <span className="text-red-500">*</span></label>
                          {isUnresolvedDistributor(distributorName) ? (
                            <span className="text-[10px] text-amber-500 font-bold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                              ⚠️ Distributor unresolved
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">
                              ✓ Distributor verified
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          list="registered-distributors-list"
                          placeholder="Select or enter legitimate distributor..."
                          value={distributorName}
                          onChange={(e) => setDistributorName(e.target.value)}
                          className={`w-full px-3 py-2 bg-bg border rounded-lg text-sm focus:border-primary focus:outline-none ${
                            isUnresolvedDistributor(distributorName)
                              ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30'
                              : 'border-border'
                          }`}
                        />
                        <datalist id="registered-distributors-list">
                          {registeredDistributors.map((d) => (
                            <option key={d.id} value={(d.name || d.distributor_name) as string} />
                          ))}
                        </datalist>
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
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-xs font-bold text-muted">Invoice Date <span className="text-red-500">*</span></label>
                          {!invoiceDate && (
                            <span className="text-[10px] text-amber-500 font-bold">Required</span>
                          )}
                        </div>
                        <input
                          type="date"
                          value={invoiceDate}
                          onChange={(e) => setInvoiceDate(e.target.value)}
                          className={`w-full px-3 py-2 bg-bg border rounded-lg text-sm focus:border-primary focus:outline-none ${
                            !invoiceDate
                              ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/50'
                              : 'border-border'
                          }`}
                        />
                        {!invoiceDate && (
                          <p className="text-[10px] text-amber-500 mt-1">⚠️ Missing invoice date</p>
                        )}
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

                        {/* Strict medicine-resolution strip (purchases only) */}
                        {selectedTx.type === 'purchases' && (
                          <div className="mb-3">
                            {item.medicine_id ? (
                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 w-fit">
                                <CheckCircle2 size={13} />
                                Linked to master #{item.medicine_id}
                              </div>
                            ) : previewLoading && !matchPreview[index] ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-muted px-2 py-1">
                                <RefreshCw size={12} className="animate-spin" />
                                Checking master database...
                              </div>
                            ) : matchPreview[index]?.medicine_id ? (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] px-2 py-1 rounded-lg bg-primary/10 border border-primary/30 w-fit">
                                <Link2 size={13} className="text-primary shrink-0" />
                                <span>Similar match: <b>{matchPreview[index].matched_name}</b> ({Math.round((matchPreview[index].confidence || 0) * 100)}%)</span>
                                <button
                                  type="button"
                                  onClick={() => handleLinkSuggestion(index)}
                                  className="px-2 py-0.5 rounded bg-primary text-white font-bold hover:bg-primary/90 transition-colors"
                                >
                                  Link
                                </button>
                              </div>
                            ) : null}

                            {!item.medicine_id && (
                              <div className="mt-2 relative">
                                <div className="flex gap-2">
                                  <div className="relative flex-1">
                                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                                    <input
                                      type="text"
                                      placeholder="Search master to link (type ≥ 3 chars)..."
                                      value={lineSearchTerms[index] || ''}
                                      onChange={(e) => handleLineSearch(index, e.target.value)}
                                      className="w-full pl-7 pr-2 py-1.5 bg-bg border border-border rounded-lg text-xs focus:border-primary focus:outline-none"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openNewMedicineEditor(index)}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/20 transition-colors flex items-center gap-1 text-xs font-bold whitespace-nowrap"
                                  >
                                    <Plus size={13} /> New Medicine
                                  </button>
                                </div>
                                {(lineSearchResults[index]?.length || 0) > 0 && (
                                  <div className="absolute z-dropdown left-0 right-20 mt-1 bg-bg border border-glass-border rounded-xl shadow-xl max-h-52 overflow-y-auto scrollbar-custom">
                                    {(lineSearchResults[index] || []).map((med) => (
                                      <button
                                        key={med.id}
                                        type="button"
                                        onMouseDown={() => handlePickSearchResult(index, med)}
                                        className="w-full text-left px-3 py-2 hover:bg-bg3 transition-colors border-b border-border last:border-0"
                                      >
                                        <div className="text-xs font-bold truncate">{med.name}</div>
                                        <div className="text-[10px] text-muted truncate">
                                          {med.manufacturer || ''}{med.mrp ? ` • MRP ₹${med.mrp}` : ''}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

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
                              <div className="flex justify-between items-center mb-1">
                                <label className="block text-[10px] text-muted">MRP (₹) <span className="text-red-500">*</span></label>
                                {(!item.mrp || Number(item.mrp) <= 0) && (
                                  <span className="text-[9px] text-amber-500 font-bold">MRP required</span>
                                )}
                              </div>
                              <input
                                type="number"
                                step="0.01"
                                placeholder={(!item.mrp || Number(item.mrp) <= 0) ? "MRP required" : ""}
                                value={item.mrp !== undefined && item.mrp !== null ? item.mrp : ''}
                                onChange={(e) => handleUpdateItemField(index, 'mrp', e.target.value)}
                                className={`w-full px-2 py-1 bg-bg border rounded text-xs text-center ${
                                  (!item.mrp || Number(item.mrp) <= 0)
                                    ? 'border-amber-500/60 bg-amber-500/10 placeholder-amber-500/70 font-semibold'
                                    : 'border-border'
                                }`}
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
    </div>

      {/* Universal create-medicine editor (opens above this review modal; z-modal > z-submodal) */}
      {medEditorIndex !== null && (
        <UniversalMedicineEditModal
          mode="create"
          medicineId={null}
          initialData={medEditorInitialData}
          ocrData={medEditorOcrData}
          onClose={closeMedEditor}
          onSave={(saved) => {
            if (saved?.id && medEditorIndex !== null) {
              setItemMedicine(medEditorIndex, {
                medicine_id: saved.id,
                name: saved.name || itemNameOf(editingItems[medEditorIndex])
              });
            }
            closeMedEditor();
          }}
        />
      )}
    </>,
    document.body
  );
};
