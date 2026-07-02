import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  Smartphone, 
  Calendar, 
  User, 
  Trash2, 
  Check, 
  X, 
  AlertTriangle, 
  RefreshCw, 
  Search, 
  ShoppingCart, 
  Clock, 
  Sparkles, 
  Pill, 
  Plus, 
  ArrowRight,
  Send
} from 'lucide-react';
import { api, apiClient } from '../../services/api';
import { toastEvent } from '../../services/events';

interface StagedSaleItem {
  inventory_id: number;
  medicine_id: number;
  name: string;
  medicine_name?: string;
  quantity: number;
  unit_price: number;
  batch_no?: string;
  expiry_date?: string;
}

interface StagedSale {
  id: number;
  patient_name: string;
  patient_phone: string;
  discount: number;
  sale_date: string;
  items_json: string;
  items?: StagedSaleItem[];
  status: 'pending' | 'approved' | 'rejected';
}

export default function PhoneSales() {
  const [sales, setSales] = useState<StagedSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Selection & Editing
  const [selectedSale, setSelectedSale] = useState<StagedSale | null>(null);
  const [editingItems, setEditingItems] = useState<StagedSaleItem[]>([]);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [discount, setDiscount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Device & Logs state for history and charts dashboard
  interface Device {
    token: string;
    device_name: string;
    os: string;
    is_online: number;
    last_seen: string;
    offline_seconds: number;
  }

  interface ConnectionLog {
    id: number;
    token: string;
    device_name: string;
    os: string;
    status: 'connected' | 'disconnected';
    timestamp: string;
  }

  const [devices, setDevices] = useState<Device[]>([]);
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const fetchStagedSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all historical staged sales
      const data = await api.getStagedSales(true);
      setSales(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to fetch staged sales:', err);
      setError(err.message || 'Failed to load staged sales transactions.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDeviceData = useCallback(async () => {
    setLogsLoading(true);
    try {
      const [devRes, logRes] = await Promise.all([
        apiClient.get('/notifications/devices'),
        apiClient.get('/notifications/devices/logs')
      ]);
      if (devRes.data?.devices) setDevices(devRes.data.devices);
      if (logRes.data?.logs) setLogs(logRes.data.logs);
    } catch (err) {
      console.error('Failed to fetch device data on phone sales page:', err);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStagedSales();
    fetchDeviceData();
    // Poll data every 8 seconds
    const interval = setInterval(() => {
      fetchStagedSales();
      fetchDeviceData();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchStagedSales, fetchDeviceData]);

  const handleSelectSale = (sale: StagedSale) => {
    setSelectedSale(sale);
    setPatientName(sale.patient_name || 'Walk-in Customer');
    setPatientPhone(sale.patient_phone || '');
    setDiscount(sale.discount || 0);

    let parsedItems: StagedSaleItem[] = [];
    try {
      parsedItems = typeof sale.items_json === 'string' ? JSON.parse(sale.items_json) : sale.items_json;
      if (!Array.isArray(parsedItems)) parsedItems = [];
    } catch (e) {
      parsedItems = [];
    }
    
    // Normalize properties
    parsedItems = parsedItems.map(item => ({
      ...item,
      name: item.name || item.medicine_name || 'Unknown Medicine'
    }));

    setEditingItems(parsedItems);
  };

  const handleUpdateItemField = (index: number, field: keyof StagedSaleItem, value: any) => {
    const updated = [...editingItems];
    if (field === 'quantity') {
      updated[index][field] = parseInt(value) || 0;
    } else if (field === 'unit_price') {
      updated[index][field] = parseFloat(value) || 0;
    } else {
      (updated[index] as any)[field] = value;
    }
    setEditingItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    const updated = [...editingItems];
    updated.splice(index, 1);
    setEditingItems(updated);
  };

  const handleApprove = async () => {
    if (!selectedSale) return;
    setSaving(true);
    try {
      const response = await api.approveStagedSale(selectedSale.id, {
        items: editingItems,
        patient_name: patientName.trim(),
        patient_phone: patientPhone.trim(),
        discount: Number(discount),
      });

      toastEvent.trigger(`Sale approved! Invoice #${response.invoice_no} dispatched on WhatsApp.`, 'success');
      setSelectedSale(null);
      await fetchStagedSales();
      if ((window as any).refreshStagedCounts) {
        (window as any).refreshStagedCounts();
      }
    } catch (err: any) {
      console.error(err);
      toastEvent.trigger(err.response?.data?.error || err.message || 'Failed to approve sale', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedSale) return;
    if (!window.confirm('Are you sure you want to reject and delete this staged sale? This cannot be undone.')) return;
    setRejecting(true);
    try {
      await api.rejectStagedSale(selectedSale.id);
      toastEvent.trigger('Staged sale rejected and deleted successfully.', 'success');
      setSelectedSale(null);
      await fetchStagedSales();
      if ((window as any).refreshStagedCounts) {
        (window as any).refreshStagedCounts();
      }
    } catch (err: any) {
      console.error(err);
      toastEvent.trigger(err.message || 'Failed to reject sale', 'error');
    } finally {
      setRejecting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const cleanIso = dateStr && !dateStr.includes('T') ? dateStr.replace(' ', 'T') + 'Z' : dateStr;
      const d = new Date(cleanIso);
      return d.toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return dateStr;
    }
  };

  // Filtered timeline sales list
  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchesSearch = 
        (s.patient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.patient_phone || '').includes(searchQuery) ||
        String(s.id).includes(searchQuery);
      return matchesStatus && matchesSearch;
    });
  }, [sales, statusFilter, searchQuery]);

  // Pricing calculations
  const subtotal = useMemo(() => {
    return editingItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  }, [editingItems]);

  const tax = useMemo(() => {
    return Number((subtotal * 0.05).toFixed(2));
  }, [subtotal]);

  const total = useMemo(() => {
    return Math.round(subtotal + tax - Number(discount || 0));
  }, [subtotal, tax, discount]);

  // Compute 5-day connection activity stats for SVG chart
  const chartData = useMemo(() => {
    const days: { key: string; label: string; value: number }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      days.push({ key, label, value: 0 });
    }

    logs.forEach(log => {
      try {
        const cleanIso = log.timestamp && !log.timestamp.includes('T') 
          ? log.timestamp.replace(' ', 'T') + 'Z' 
          : log.timestamp;
        const d = new Date(cleanIso);
        const logKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        const foundDay = days.find(day => day.key === logKey);
        if (foundDay) {
          foundDay.value++;
        }
      } catch (e) {}
    });

    return days;
  }, [logs]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative text-text">
      
      {/* Top filter banner */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-glass-bg border border-glass-border p-4 rounded-2xl mb-4 shrink-0 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
            <Smartphone size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Phone & Mobile Sales</h2>
            <p className="text-xs text-muted">Manage, edit, and approve orders logged from remote app sessions</p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-muted" size={14} />
            <input
              type="text"
              placeholder="Search by name, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="premium-input pl-9 pr-4 py-1.5 text-xs w-full bg-bg border border-border rounded-xl focus:outline-none text-text focus:border-primary"
            />
          </div>

          {/* Status filter selection */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="premium-input px-3 py-1.5 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Approved & Saved</option>
            <option value="rejected">Rejected / Cancelled</option>
          </select>

          <button
            onClick={fetchStagedSales}
            className="p-2 rounded-xl bg-bg border border-border hover:bg-bg3 hover:border-glass-border text-muted hover:text-white transition-all shrink-0"
            title="Refresh List"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Dual-pane Container */}
      <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0 overflow-hidden">
        
        {/* LEFT PANEL: TIMELINE VIEW */}
        <div className="w-full lg:w-2/5 flex flex-col bg-glass-bg border border-glass-border rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-4 border-b border-glass-border bg-white/[0.02] flex justify-between items-center shrink-0">
            <h3 className="font-bold text-xs uppercase tracking-wider text-muted">Sync Timeline ({filteredSales.length})</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted">
                <RefreshCw size={28} className="animate-spin text-primary mb-3" />
                <p className="text-xs">Loading transaction history...</p>
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted">
                <Clock className="text-muted/20 mb-3" size={36} />
                <p className="font-bold text-xs text-white">No staged sales found</p>
                <p className="text-[10px] text-muted max-w-[200px] mt-1">Waiting for remote users to record and sync offline orders.</p>
              </div>
            ) : (
              <div className="relative pl-6 border-l border-border/40 ml-3 space-y-6 py-2">
                {filteredSales.map((sale) => {
                  let items: StagedSaleItem[] = [];
                  try {
                    items = typeof sale.items_json === 'string' ? JSON.parse(sale.items_json) : sale.items_json;
                    if (!Array.isArray(items)) items = [];
                  } catch (e) {}

                  const itemSummary = items
                    .slice(0, 2)
                    .map(i => `${i.name || i.medicine_name} (x${i.quantity})`)
                    .join(', ') + (items.length > 2 ? ' ...' : '');

                  const isSelected = selectedSale?.id === sale.id;

                  // Timeline node styles based on status
                  let nodeColor = 'bg-zinc-600 border-zinc-500';
                  let statusBadge = '';

                  if (sale.status === 'pending') {
                    nodeColor = 'bg-amber-500 border-amber-400 ring-2 ring-amber-500/20';
                    statusBadge = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
                  } else if (sale.status === 'approved') {
                    nodeColor = 'bg-emerald-500 border-emerald-400';
                    statusBadge = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
                  } else if (sale.status === 'rejected') {
                    nodeColor = 'bg-red-500 border-red-400';
                    statusBadge = 'bg-red-500/10 border-red-500/20 text-red-400';
                  }

                  return (
                    <div
                      key={sale.id}
                      onClick={() => handleSelectSale(sale)}
                      className={`group relative p-4 rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-lg shadow-primary/5 translate-x-1'
                          : 'bg-bg/40 border-border hover:border-glass-border hover:bg-bg3/20'
                      }`}
                    >
                      {/* Timeline dot */}
                      <div className={`absolute -left-[31px] top-5 w-2.5 h-2.5 rounded-full border-2 ${nodeColor} transition-transform group-hover:scale-125 z-10`} />

                      {/* Header */}
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <div className="min-w-0">
                          <h4 className="font-bold text-xs text-text truncate max-w-[160px] group-hover:text-primary transition-colors">
                            {sale.patient_name || 'Walk-in Customer'}
                          </h4>
                          <span className="text-[10px] text-muted font-mono">{sale.patient_phone || 'No Phone'}</span>
                        </div>
                        <div className="text-[9px] text-muted flex items-center gap-1 font-mono">
                          <Calendar size={10} />
                          {formatDate(sale.sale_date)}
                        </div>
                      </div>

                      {/* Item summary list */}
                      <p className="text-[10px] text-muted line-clamp-1 mb-2.5">{itemSummary || 'No medicines in draft'}</p>

                      {/* Footer */}
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-accent">
                          ₹{Number(items.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0)).toLocaleString('en-IN')}
                        </span>
                        
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border capitalize ${statusBadge}`}>
                          {sale.status === 'pending' ? 'Reviewing' : sale.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: TRANSACTION REVIEW & EDIT FORM */}
        <div className="flex-1 flex flex-col bg-glass-bg border border-glass-border rounded-2xl overflow-hidden backdrop-blur-xl">
          {selectedSale ? (
            <div className="flex-1 flex flex-col min-h-0">
              
              {/* Header details */}
              <div className="p-4 border-b border-glass-border bg-white/[0.02] flex justify-between items-center shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-muted">Staged Review Panel</h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-bg3 text-muted">ID: #{selectedSale.id}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-0.5">Synced {formatDate(selectedSale.sale_date)}</p>
                </div>
                
                <div className="flex gap-2">
                  {selectedSale.status === 'pending' && (
                    <button
                      onClick={handleReject}
                      disabled={saving || rejecting}
                      className="p-1.5 text-xs font-semibold rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Reject & Delete staged sale"
                    >
                      {rejecting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedSale(null)}
                    className="p-1.5 text-xs font-semibold rounded-lg bg-bg border border-border text-muted hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Form editing scrolling section */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-bg/20">
                {/* Details Form Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-bg/50 border border-border p-4 rounded-xl">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider block">Patient / Customer Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 text-muted" size={12} />
                      <input
                        type="text"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        disabled={selectedSale.status !== 'pending'}
                        className="premium-input pl-8 py-2 text-xs w-full bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary disabled:opacity-60"
                        placeholder="Walk-in Customer"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider block">Patient Phone Number</label>
                    <div className="relative">
                      <Smartphone className="absolute left-3 top-2.5 text-muted" size={12} />
                      <input
                        type="text"
                        value={patientPhone}
                        onChange={(e) => setPatientPhone(e.target.value)}
                        disabled={selectedSale.status !== 'pending'}
                        className="premium-input pl-8 py-2 text-xs w-full bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary disabled:opacity-60"
                        placeholder="e.g. 9876543210"
                      />
                    </div>
                  </div>
                </div>

                {/* Items Section */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Pill size={12} /> Staged Line Items ({editingItems.length})
                  </h4>

                  <div className="space-y-2.5">
                    {editingItems.map((item, idx) => (
                      <div 
                        key={idx} 
                        className="p-3 bg-bg2/40 border border-border hover:border-glass-border/30 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 group relative transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-xs text-text block truncate">{item.name}</span>
                          <span className="text-[9px] text-muted font-mono mt-0.5 block">
                            Batch: {item.batch_no || 'N/A'} &middot; Exp: {item.expiry_date || 'N/A'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {/* Quantity */}
                          <div className="w-16">
                            <label className="text-[8px] text-muted uppercase font-bold block mb-0.5">Qty</label>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => handleUpdateItemField(idx, 'quantity', e.target.value)}
                              disabled={selectedSale.status !== 'pending'}
                              className="w-full text-center px-1 py-0.5 text-xs font-bold bg-bg border border-border rounded focus:outline-none disabled:opacity-60 text-white"
                            />
                          </div>

                          {/* Unit Price */}
                          <div className="w-20">
                            <label className="text-[8px] text-muted uppercase font-bold block mb-0.5">Rate (₹)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.unit_price}
                              onChange={(e) => handleUpdateItemField(idx, 'unit_price', e.target.value)}
                              disabled={selectedSale.status !== 'pending'}
                              className="w-full text-center px-1 py-0.5 text-xs bg-bg border border-border rounded focus:outline-none disabled:opacity-60 text-white"
                            />
                          </div>

                          {/* Line Total */}
                          <div className="w-20 text-right pr-2">
                            <label className="text-[8px] text-muted uppercase font-bold block mb-0.5">Total</label>
                            <span className="text-xs font-bold text-text">₹{(item.quantity * item.unit_price).toFixed(2)}</span>
                          </div>

                          {/* Delete Item button */}
                          {selectedSale.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="p-1 hover:bg-red-500/15 rounded text-muted hover:text-red transition-colors opacity-40 group-hover:opacity-100"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {editingItems.length === 0 && (
                      <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted text-xs">
                        No items remaining in cart. Add items or reject this staged record.
                      </div>
                    )}
                  </div>
                </div>

                {/* Status-specific warning or read-only details */}
                {selectedSale.status === 'approved' && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex gap-2">
                    <Check size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Transaction Checked-In Successfully</p>
                      <p className="text-[10px] text-muted mt-0.5">This transaction has been written to the inventory databases. The customer has been dispatched their stamped PDF bill via automated WhatsApp services.</p>
                    </div>
                  </div>
                )}

                {selectedSale.status === 'rejected' && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex gap-2">
                    <X size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Transaction Cancelled / Rejected</p>
                      <p className="text-[10px] text-muted mt-0.5">This staged sale draft was rejected and is excluded from checkout operations. Stock inventory was not modified.</p>
                    </div>
                  </div>
                )}

              </div>

              {/* Bottom footer area showing pricing and Save button */}
              <div className="p-5 border-t border-glass-border bg-white/[0.01] shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4">
                {/* Invoice Pricing Summary */}
                <div className="flex gap-6 text-center sm:text-left select-none">
                  <div>
                    <span className="text-[9px] font-bold text-muted uppercase block">Subtotal</span>
                    <span className="text-xs font-semibold text-text">₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-muted uppercase block">Tax (5%)</span>
                    <span className="text-xs font-semibold text-text">₹{tax.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-muted uppercase block">Discount (₹)</span>
                    {selectedSale.status === 'pending' ? (
                      <input
                        type="number"
                        min={0}
                        value={discount}
                        onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                        className="w-16 text-center text-xs py-0.5 bg-bg border border-border rounded text-white"
                      />
                    ) : (
                      <span className="text-xs font-semibold text-text">₹{discount}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-muted uppercase block text-primary">Final Total</span>
                    <span className="text-base font-bold text-accent">₹{total.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Approve Button */}
                {selectedSale.status === 'pending' && (
                  <button
                    onClick={handleApprove}
                    disabled={saving || rejecting || editingItems.length === 0}
                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/95 text-white font-bold text-xs shadow-lg shadow-primary/10 flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    {saving ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    {saving ? 'Processing...' : 'Approve & Save (Send WhatsApp)'}
                  </button>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col p-6 min-h-0 overflow-y-auto custom-scrollbar space-y-6">
              {/* Header Info */}
              <div className="flex justify-between items-center pb-3 border-b border-border select-none">
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-muted">Mobile Connections Hub</h3>
                  <p className="text-[10px] text-muted mt-0.5">Live monitoring of sync device tokens</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono bg-green/10 text-green border border-green/20 animate-pulse">
                  <div className="w-1.5 h-1.5 rounded-full bg-green" />
                  <span>Monitoring</span>
                </div>
              </div>

              {/* Chart */}
              {logs.length > 0 ? (
                (() => {
                  const maxVal = Math.max(...chartData.map(d => d.value), 4);
                  const height = 110;
                  const width = 360;
                  const padding = 15;
                  const chartHeight = height - 2 * padding;
                  const chartWidth = width - 2 * padding;
                  const barWidth = 28;
                  const gap = (chartWidth - barWidth * chartData.length) / (chartData.length - 1 || 1);

                  return (
                    <div className="bg-bg/50 border border-border p-4 rounded-xl">
                      <h4 className="text-[9px] font-bold text-muted uppercase tracking-wider mb-2">5-Day Connection Events Activity</h4>
                      <div className="flex justify-center items-center">
                        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="overflow-visible">
                          {/* Grid Lines */}
                          {[0, 0.5, 1].map((ratio, idx) => {
                            const y = padding + chartHeight * (1 - ratio);
                            return (
                              <g key={idx}>
                                <line 
                                  x1={padding} 
                                  y1={y} 
                                  x2={width - padding} 
                                  y2={y} 
                                  stroke="var(--border)" 
                                  strokeWidth="1" 
                                  strokeDasharray="4 4" 
                                  opacity="0.25"
                                />
                                <text 
                                  x={padding - 5} 
                                  y={y + 3} 
                                  fill="var(--text-muted)" 
                                  fontSize="7" 
                                  textAnchor="end"
                                  opacity="0.8"
                                >
                                  {Math.round(ratio * maxVal)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Bars and labels */}
                          {chartData.map((d, idx) => {
                            const barHeight = (d.value / maxVal) * chartHeight;
                            const x = padding + idx * (barWidth + gap);
                            const y = height - padding - barHeight;

                            return (
                              <g key={idx}>
                                <title>{`${d.value} events`}</title>
                                <rect
                                  x={x}
                                  y={y}
                                  width={barWidth}
                                  height={barHeight}
                                  rx="3"
                                  fill="url(#dashBarGradient)"
                                  className="transition-all duration-300 hover:opacity-90"
                                />
                                {d.value > 0 && (
                                  <text
                                    x={x + barWidth / 2}
                                    y={y - 4}
                                    fill="var(--accent)"
                                    fontSize="8"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                  >
                                    {d.value}
                                  </text>
                                )}
                                <text
                                  x={x + barWidth / 2}
                                  y={height - 4}
                                  fill="var(--text-muted)"
                                  fontSize="8"
                                  textAnchor="middle"
                                >
                                  {d.label}
                                </text>
                              </g>
                            );
                          })}

                          <defs>
                            <linearGradient id="dashBarGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--primary)" />
                              <stop offset="100%" stopColor="rgba(99, 102, 241, 0.15)" />
                            </linearGradient>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="p-4 bg-bg2/40 border border-border rounded-xl text-center text-xs text-muted">
                  No connection activity logs found to build connection chart.
                </div>
              )}

              {/* Registered Devices Status */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Smartphone size={10} className="text-primary" /> Active Registered Devices ({devices.length})
                </h4>
                {devices.length === 0 ? (
                  <div className="p-4 bg-bg2/40 border border-border rounded-xl text-center text-xs text-muted">
                    No registered mobile devices yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {devices.slice(0, 4).map((dev) => {
                      const isOnline = dev.is_online === 1;
                      return (
                        <div key={dev.token} className="p-3 bg-bg2/40 border border-border hover:border-glass-border/30 rounded-xl space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-white truncate block max-w-[100px]">{dev.device_name}</span>
                            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green animate-pulse' : 'bg-muted'}`} />
                          </div>
                          <p className="text-[9px] text-muted font-mono truncate">{dev.os} &middot; {isOnline ? 'Online' : 'Offline'}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Activity logs */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Clock size={10} className="text-primary" /> Recent Device Connection Events
                </h4>
                {logs.length === 0 ? (
                  <div className="p-4 bg-bg2/40 border border-border rounded-xl text-center text-xs text-muted">
                    No connection history logs found.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.slice(0, 3).map((log) => {
                      const isConn = log.status === 'connected';
                      return (
                        <div key={log.id} className="p-2.5 bg-bg2/40 border border-border rounded-xl flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isConn ? 'bg-green' : 'bg-red'}`} />
                            <span className="font-semibold text-text truncate max-w-[120px]">{log.device_name}</span>
                            <span className="text-[10px] text-muted">({log.os})</span>
                          </div>
                          <span className="text-[9px] text-muted font-mono">{new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
