import { useEffect, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ClipboardList, 
  Plus, 
  Trash2, 
  Send, 
  Check, 
  AlertTriangle, 
  Bell, 
  Clock, 
  Search, 
  AlertCircle, 
  RefreshCw,
  Mail,
  MessageCircle,
  User
} from 'lucide-react';
import { api } from '../../services/api';
import type { SpecialOrder } from '../../services/api';
import { toastEvent } from '../../services/events';

const parseSqliteDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  if (dateStr.includes('T') || dateStr.endsWith('Z')) {
    return new Date(dateStr);
  }
  const formatted = dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(formatted);
  return isNaN(d.getTime()) ? new Date(dateStr) : d;
};

const getTodayString = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

let cachedOrdersList: SpecialOrder[] | null = null;

const Orders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SpecialOrder[]>(cachedOrdersList || []);
  const [loading, setLoading] = useState(!cachedOrdersList);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!manualToDate) {
      setDateTo(getTodayString());
    }
  }, [manualToDate]);

  const handleDateFromChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateFrom('2020-01-01');
    } else {
      setDateFrom(val);
    }
  };

  const handleDateToChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateTo('2020-01-01');
    } else {
      setDateTo(val);
    }
  };
  


  // New Request Form State
  const [product, setProduct] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState<number | ''>('');
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState('Normal');
  const [status, setStatus] = useState('Pending');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Pharmarack Search States
  const [prSearchResults, setPrSearchResults] = useState<any[]>([]);
  const [showPrDropdown, setShowPrDropdown] = useState(false);
  const [loadingPr, setLoadingPr] = useState(false);
  
  // Selected Pharmarack Metadata Form State
  const [selectedDistributor, setSelectedDistributor] = useState('');
  const [selectedRate, setSelectedRate] = useState<number | ''>('');
  const [selectedMrp, setSelectedMrp] = useState<number | ''>('');
  const [selectedMapped, setSelectedMapped] = useState(true);
  const [selectedScheme, setSelectedScheme] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | number>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | number>('');
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedPackaging, setSelectedPackaging] = useState('');

  // Debounced search for Pharmarack products
  useEffect(() => {
    if (!product.trim()) {
      setPrSearchResults([]);
      setShowPrDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingPr(true);
      try {
        const results = await api.searchPharmarack(product);
        setPrSearchResults(results || []);
        setShowPrDropdown(results && results.length > 0);
      } catch (err) {
        console.error('Pharmarack query failed:', err);
      } finally {
        setLoadingPr(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [product]);

  const handleSelectPharmarackItem = (item: any) => {
    setProduct(`${item.name} (${item.packaging})`);
    setSelectedDistributor(item.distributor);
    setSelectedRate(item.rate !== null && item.rate !== undefined ? item.rate : '');
    setSelectedMrp(item.mrp !== null && item.mrp !== undefined ? item.mrp : '');
    setSelectedMapped(!!item.mapped);
    setSelectedScheme(item.scheme || '');
    setSelectedProductId(item.productId || '');
    setSelectedStoreId(item.storeId || '');
    setSelectedProductCode(item.productCode || '');
    setSelectedCompany(item.company || '');
    setSelectedPackaging(item.packaging || '');
    setShowPrDropdown(false);
  };

  // Fetch all orders
  const fetchOrders = async (showRefresh = false, silent = false) => {
    if (showRefresh) setRefreshing(true);
    if (!silent && !cachedOrdersList) setLoading(true);
    try {
      const data = await api.getOrders();
      // STRICT RULE: Only show last 100
      const sliced = Array.isArray(data) ? data.slice(0, 100) : [];
      setOrders(sliced);
      cachedOrdersList = sliced;
    } catch (err) {
      console.error('Failed to fetch special orders:', err);
      showNotification('Failed to load orders. Please check your connection.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders(false, !!cachedOrdersList);

    const handleRefresh = () => {
      fetchOrders(true, true);
    };
    window.addEventListener('refresh-special-orders', handleRefresh);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    toastEvent.trigger(message, type, '/orders');
  };

  // Submit new special order request
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = requester.trim();
    const customerPhone = phone.replace(/\D/g, '');

    if (!product.trim()) {
      showNotification('Product name is required.', 'error');
      return;
    }
    if (!customerName) {
      showNotification('Customer Name is required.', 'error');
      return;
    }
    if (!customerPhone) {
      showNotification('Phone Number is required.', 'error');
      return;
    }
    if (customerPhone.length < 10) {
      showNotification('Please enter a valid 10-digit mobile number.', 'error');
      return;
    }
    if (qty === '' || qty === undefined || qty === null) {
      showNotification('Quantity is required.', 'error');
      return;
    }
    if (Number(qty) < 1) {
      showNotification('Quantity must be at least 1.', 'error');
      return;
    }

    setFormSubmitting(true);
    try {
      await api.createOrder({
        product: product.trim(),
        requester: customerName,
        phone: customerPhone,
        qty,
        priority,
        status,
        pharmarack_distributor: selectedDistributor || undefined,
        pharmarack_rate: selectedRate !== '' ? Number(selectedRate) : undefined,
        pharmarack_mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
        pharmarack_mapped: selectedMapped ? 1 : 0,
        pharmarack_scheme: selectedScheme || undefined,
        advance_payment: advancePayment !== '' ? Number(advancePayment) : 0
      });

      showNotification(`Order for "${product}" logged successfully!`, 'success');

      // If it's a Pharmarack product, also add it to the actual Pharmarack cart!
      if (selectedProductId && selectedStoreId) {
        try {
          await api.addPharmarackCart([{
            productId: selectedProductId,
            storeId: selectedStoreId,
            qty: Number(qty),
            rate: selectedRate !== '' ? Number(selectedRate) : undefined,
            scheme: selectedScheme || undefined,
            productCode: selectedProductCode,
            company: selectedCompany,
            productName: product.trim(),
            storeName: selectedDistributor,
            packaging: selectedPackaging
          }]);
          showNotification(`Added "${product}" to actual Pharmarack cart!`, 'success');
        } catch (cartErr: any) {
          console.error(`Failed to add ${product} to actual Pharmarack cart:`, cartErr);
          const detailedError = cartErr?.response?.data?.details || cartErr?.response?.data?.error || cartErr?.message || 'Unknown error';
          showNotification(`Could not add "${product}" to Pharmarack cart: ${detailedError}`, 'error');
        }
      }
      
      // Reset form
      setProduct('');
      setRequester('');
      setPhone('');
      setQty('');
      setAdvancePayment('');
      setPriority('Normal');
      setStatus('Pending');
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(true);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
      
      // Refresh list
      fetchOrders();
    } catch (err) {
      console.error('Error creating order:', err);
      showNotification('Failed to register special order.', 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Update order status/priority inline
  const handleUpdate = async (id: number, field: string, value: any) => {
    try {
      const originalOrder = orders.find(o => o.id === id);
      if (!originalOrder) return;

      const updatedFields = { [field]: value };
      
      // Optimistic Update
      setOrders(prev => prev.map(o => o.id === id ? { ...o, ...updatedFields } : o));

      await api.updateOrder(id, updatedFields);
      
      if (field === 'status') {
        showNotification(`Order status updated to "${value}".`, 'success');
        // Backend automatically sends WhatsApp when status → 'Ready' (see orders.ts route)
        // Re-fetch to get updated notified flag from server
        const refreshed = await api.getOrders();
        setOrders(refreshed);
        const updated = refreshed.find((o: any) => o.id === id);
        if (value === 'Ready' && updated?.notified === 1 && originalOrder.phone) {
          showNotification('✅ WhatsApp notification sent to customer.', 'info');
        }
      } else {
        showNotification('Order details updated.', 'success');
        fetchOrders();
      }
    } catch (err) {
      console.error('Error updating order:', err);
      showNotification('Failed to update order.', 'error');
      // Revert from server
      fetchOrders();
    }
  };

  // Delete an order
  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this special order request?')) return;

    try {
      // Optimistic Delete
      setOrders(prev => prev.filter(o => o.id !== id));
      await api.deleteOrder(id);
      showNotification('Special order deleted.', 'success');
    } catch (err) {
      console.error('Error deleting order:', err);
      showNotification('Failed to delete order.', 'error');
      fetchOrders();
    }
  };

  // Convert special order to recurring refill rule
  const handleConvertToRefill = async (order: SpecialOrder) => {
    const daysStr = prompt(`Enter refill frequency in days for "${order.product}" (e.g. 30):`, '30');
    if (daysStr === null) return;
    
    const intervalDays = parseInt(daysStr, 10);
    if (isNaN(intervalDays) || intervalDays <= 0) {
      showNotification('Please enter a valid number of days.', 'error');
      return;
    }

    try {
      const response = await api.convertToRefill(order.id, intervalDays);
      if (response.success) {
        showNotification(response.message || 'Successfully converted to recurring refill!', 'success');
        fetchOrders();
      } else {
        showNotification(response.error || 'Failed to convert to recurring refill.', 'error');
      }
    } catch (err: any) {
      console.error('Error converting order to refill:', err);
      showNotification('Failed to convert order to recurring refill.', 'error');
    }
  };

  // Trigger Uncollected Reminders Scan
  const handleScanUncollected = async () => {
    setRefreshing(true);
    try {
      const alertedList = await api.getUncollectedAlerts();
      const notifiedCount = alertedList.filter(o => o.notified).length;
      
      if (notifiedCount > 0) {
        showNotification(`Reminders scan complete. Sent WhatsApp alerts to ${notifiedCount} customer(s).`, 'success');
      } else {
        showNotification('No uncollected orders required notifications at this time.', 'info');
      }
      
      fetchOrders();
    } catch (err) {
      console.error('Error scanning uncollected alerts:', err);
      showNotification('Failed to execute uncollected alerts reminders.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Filtering and Searching
  const filteredOrders = orders.filter(o => {
    const matchesSearch = 
      o.product.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.requester.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (o.phone && o.phone.includes(searchQuery));
      
    const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
    
    let matchesDate = true;
    if (dateFrom || dateTo) {
      if (!o.date) {
        matchesDate = false;
      } else {
        const itemDate = o.date.substring(0, 10);
        const start = dateFrom || '0000-00-00';
        const end = dateTo || '9999-99-99';
        matchesDate = itemDate >= start && itemDate <= end;
      }
    }
    
    return matchesSearch && matchesStatus && matchesDate;
  });

  const totalPages = Math.ceil(filteredOrders.length / pageSize);
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getPriorityBadgeColor = (p: string) => {
    switch (p) {
      case 'High':
        return 'bg-red-500/10 border-red-500/30 text-red';
      case 'Normal':
        return 'bg-primary/10 border-primary/30 text-primary';
      case 'Low':
        return 'bg-slate-500/10 border-slate-500/30 text-slate-400';
      default:
        return 'bg-white/5 border-glass-border text-muted';
    }
  };

  const getStatusBadgeColor = (s: string) => {
    switch (s) {
      case 'Pending':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-500';
      case 'Ordered':
        return 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400';
      case 'Ready':
        return 'bg-sky-500/10 border-sky-500/30 text-sky-400';
      case 'Completed':
        return 'bg-green/10 border-green/30 text-green';
      default:
        return 'bg-white/5 border-glass-border text-muted';
    }
  };

  return (
    <div className="h-full flex flex-col fade-in gap-3 pb-4">
      


      {/* Page Controls */}
      <div className="flex justify-end items-center gap-3">
        <button 
          type="button"
          onClick={handleScanUncollected}
          disabled={refreshing || loading}
          className="premium-btn bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20 text-xs px-3 py-2 disabled:opacity-50"
          title="Scan orders ready for 2+ days and send auto WhatsApp reminder notifications."
        >
          <AlertTriangle size={14} className={refreshing ? 'animate-spin' : ''} />
          Auto Remind Uncollected
        </button>
        <button 
          onClick={() => fetchOrders(true)} 
          disabled={refreshing}
          className="p-2 rounded-lg bg-white/5 border border-glass-border hover:bg-white/10 hover:text-white transition-all text-muted"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 flex-1 min-h-0">
        
        {/* LEFT COLUMN: Form to register requests */}
        <div className="xl:col-span-1 flex flex-col min-h-0 overflow-y-auto scrollbar-thin">
          <div className="glass-panel p-6 flex-1">
            <h3 className="font-bold flex items-center gap-2 mb-6 text-sm text-text border-b border-glass-border/30 pb-3">
              <Plus size={16} className="text-primary" /> 
              Register Out-of-Stock Request
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2 relative">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Requested Medicine Name *</label>
                <div className="relative">
                  <input 
                    type="text" 
                    required
                    value={product}
                    onChange={e => setProduct(e.target.value)}
                    onFocus={() => { if (prSearchResults.length > 0) setShowPrDropdown(true); }}
                    className="premium-input w-full font-semibold" 
                    placeholder="e.g. Lipitor 10mg / Salt composition" 
                  />
                  {loadingPr && (
                    <div className="absolute right-3 top-2.5">
                      <RefreshCw size={14} className="animate-spin text-sky-400" />
                    </div>
                  )}
                </div>

                {/* Dropdown results from Pharmarack */}
                {showPrDropdown && prSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-bg2 border border-glass-border rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto scrollbar-thin">
                    <div className="p-2 border-b border-glass-border/40 bg-bg3/50 text-[9px] font-bold text-muted uppercase tracking-wider flex justify-between items-center">
                      <span>Pharmarack Live Matches</span>
                      <button 
                        type="button" 
                        onClick={() => setShowPrDropdown(false)}
                        className="text-muted hover:text-text font-bold"
                      >
                        Close
                      </button>
                    </div>
                    {prSearchResults.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectPharmarackItem(item)}
                        className="p-3 border-b border-glass-border/10 hover:bg-bg3/60 transition-colors cursor-pointer flex flex-col gap-1 text-xs"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5 flex-wrap truncate max-w-[170px]">
                            <span className="font-bold text-text truncate" title={item.name}>
                              {item.name} <span className="text-[10px] text-muted">({item.packaging})</span>
                            </span>
                            {item.scheme && (
                              <span className="text-[8px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1 py-0.2 rounded font-semibold uppercase">
                                {item.scheme}
                              </span>
                            )}
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            item.mapped 
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {item.mapped ? 'Mapped' : 'Non-Mapped'}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted truncate">
                          Dist: <span className="text-text font-medium">{item.distributor}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono mt-0.5">
                          <span className="text-green-400 font-bold">
                            PTR: {item.rate ? `₹${item.rate.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-text">
                            MRP: {item.mrp ? `₹${item.mrp.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-sky-400">
                            Stock: {item.stock}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected Pharmarack Metadata Panel */}
              {selectedDistributor && (
                <div className="p-3 bg-sky-500/5 border border-sky-500/20 rounded-xl flex flex-col gap-1.5 text-[11px] mt-2 animate-fade-in">
                  <div className="font-bold text-sky-400 flex items-center justify-between">
                    <span>Selected Pharmarack Option</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDistributor('');
                        setSelectedRate('');
                        setSelectedMrp('');
                        setSelectedMapped(true);
                        setSelectedScheme('');
                        setSelectedProductId('');
                        setSelectedStoreId('');
                        setSelectedProductCode('');
                        setSelectedCompany('');
                      }}
                      className="text-[9px] text-muted hover:text-red-400 underline font-semibold"
                    >
                      Clear Link
                    </button>
                  </div>
                  <div className="text-text font-medium truncate flex items-center gap-1.5 flex-wrap">
                    <span>Distributor: {selectedDistributor} ({selectedMapped ? 'Mapped' : 'Non-Mapped'})</span>
                    {selectedScheme && (
                      <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold uppercase">
                        Scheme: {selectedScheme}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center font-mono mt-0.5">
                    <span>PTR: {selectedRate ? `₹${Number(selectedRate).toFixed(2)}` : 'N/A'}</span>
                    <span>MRP: {selectedMrp ? `₹${Number(selectedMrp).toFixed(2)}` : 'N/A'}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Quantity Requested *</label>
                <input 
                  type="number" 
                  value={qty}
                  onChange={e => {
                    const val = e.target.value;
                    setQty(val === '' ? '' : Math.max(1, Number(val)));
                  }}
                  className="premium-input w-full font-mono font-semibold" 
                  min="1"
                  placeholder="Enter quantity"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Customer Name *</label>
                <input 
                  type="text" 
                  required
                  value={requester}
                  onChange={e => setRequester(e.target.value)}
                  className="premium-input w-full font-semibold" 
                  placeholder="Patient / Requester Name" 
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">10-Digit Mobile * (For WhatsApp Notify)</label>
                <input 
                  type="tel" 
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="premium-input w-full font-mono" 
                  placeholder="e.g. 9876543210" 
                  maxLength={10}
                />
                <p className="text-[9px] text-muted">Auto sends order confirmation WhatsApp when submitted.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Advance Payment</label>
                <input 
                  type="number" 
                  value={advancePayment}
                  onChange={e => setAdvancePayment(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))}
                  className="premium-input w-full font-mono font-semibold" 
                  placeholder="e.g. 500 (Optional)" 
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Priority</label>
                  <select 
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="premium-input w-full bg-[#18181b] border-glass-border/60 text-xs font-semibold py-2"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Initial Status</label>
                  <select 
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="premium-input w-full bg-[#18181b] border-glass-border/60 text-xs font-semibold py-2"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Ordered">Ordered</option>
                    <option value="Ready">Ready</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <button 
                type="submit"
                disabled={formSubmitting}
                className="premium-btn bg-primary text-white shadow-[0_4px_14px_rgba(14,165,233,0.3)] hover:bg-sky-600 w-full mt-4 font-bold disabled:opacity-50"
              >
                {formSubmitting ? 'Logging Request...' : 'Log Special Order'}
                <Send size={14} className="ml-1" />
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: Table Directory of Requests */}
        <div className="xl:col-span-3 glass-panel flex flex-col overflow-hidden bg-white/5 border-glass-border">
          
          {/* Table Toolbar (Search, Filter Tabs) */}
          <div className="p-4 border-b border-glass-border bg-black/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {['All', 'Pending', 'Ordered', 'Ready', 'Completed'].map(t => (
                <button
                  key={t}
                  onClick={() => setStatusFilter(t)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all select-none ${
                    statusFilter === t
                      ? 'bg-primary/20 border-primary text-primary font-bold shadow-[0_0_12px_rgba(14,165,233,0.15)]'
                      : 'bg-white/5 border-glass-border/60 text-muted hover:text-text hover:bg-white/10'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative max-w-sm w-full md:w-64">
              <Search className="absolute left-3 top-2.5 text-muted" size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search product, name, phone..."
                className="premium-input pl-9 pr-4 py-1.5 text-xs w-full"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-muted">From</label>
              <input
                type="date"
                value={dateFrom}
                min="2020-01-01"
                max={getTodayString()}
                onChange={e => handleDateFromChange(e.target.value)}
                className="px-2 py-1 bg-black/20 border border-glass-border rounded text-xs text-text focus:outline-none focus:border-primary/50"
              />
              <label className="text-xs font-semibold text-muted ml-2">To</label>
              <input
                type="date"
                value={dateTo}
                min="2020-01-01"
                max={getTodayString()}
                disabled={!manualToDate}
                onChange={e => handleDateToChange(e.target.value)}
                className="px-2 py-1 bg-black/20 border border-glass-border rounded text-xs text-text focus:outline-none focus:border-primary/50 disabled:opacity-50"
              />
              <label className="text-[10px] text-muted flex items-center gap-0.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={manualToDate}
                  onChange={e => setManualToDate(e.target.checked)}
                  className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg"
                />
                Edit
              </label>
            </div>

          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-auto bg-black/20">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-[#18181b]/95 backdrop-blur z-10 select-none">
                <tr>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Product / Medicine Requested</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Requester (Customer)</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Qty</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">Priority</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60">Status</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-center">WhatsApp Status</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border/60 text-right">Requested Date</th>
                  <th className="p-4 text-xs font-bold text-muted border-b border-glass-border/60"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted font-semibold">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-primary opacity-60" />
                      Loading out-of-stock requests...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-16 text-center text-muted font-semibold">
                      <ClipboardList size={36} className="mx-auto mb-3 text-muted/40" />
                      No special order requests found matching criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map(order => (
                    <tr key={order.id} className="hover:bg-white/5 border-b border-glass-border/20 transition-all">
                      {/* Product Name */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {(order as any).source === 'whatsapp' ? (
                            <span title="via WhatsApp"><MessageCircle size={14} className="text-[#25D366]" /></span>
                          ) : (order as any).source === 'email' ? (
                            <span title="via Email"><Mail size={14} className="text-red" /></span>
                          ) : (
                            <span title="Walk-in / Manual"><User size={14} className="text-muted" /></span>
                          )}
                          <div className="flex flex-col">
                            <span className="font-semibold text-text max-w-[160px] truncate">
                              {order.product}
                            </span>
                            {order.pharmarack_distributor && (
                              <div className="flex flex-wrap gap-1 items-center mt-1 text-[9px]">
                                <span 
                                  className={`px-1 py-0.2 rounded font-bold uppercase ${
                                    order.pharmarack_mapped === 1
                                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}
                                  title={order.pharmarack_mapped === 1 ? 'Mapped Distributor' : 'Non-Mapped Distributor'}
                                >
                                  {order.pharmarack_mapped === 1 ? 'M' : 'NM'}
                                </span>
                                <span className="text-muted truncate max-w-[110px]" title={`Distributor: ${order.pharmarack_distributor}`}>
                                  {order.pharmarack_distributor}
                                </span>
                                {(order.pharmarack_rate !== undefined && order.pharmarack_rate !== null) && (
                                  <span className="text-sky-400 font-mono font-medium">
                                    ₹{order.pharmarack_rate.toFixed(2)}
                                  </span>
                                )}
                                {(order.pharmarack_mrp !== undefined && order.pharmarack_mrp !== null) && (
                                  <span className="text-muted font-mono">
                                    (M: ₹{order.pharmarack_mrp.toFixed(2)})
                                  </span>
                                )}
                                {order.pharmarack_scheme && (
                                  <span className="bg-amber-500/15 text-amber-400 px-1 py-0.2 rounded font-bold uppercase border border-amber-500/30">
                                    {order.pharmarack_scheme}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Requester Contact */}
                      <td className="p-4">
                        <div className="font-semibold text-text">{order.requester}</div>
                        {order.phone && (
                          <div className="text-[10px] text-muted font-mono mt-0.5">{order.phone}</div>
                        )}
                        {order.advance_payment && Number(order.advance_payment) > 0 ? (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-1.5 py-0.5 rounded-md">
                              Paid: ₹{Number(order.advance_payment).toFixed(2)}
                            </span>
                          </div>
                        ) : null}
                      </td>

                      {/* Quantity */}
                      <td className="p-4 text-center font-bold font-mono">
                        {order.qty}
                      </td>

                      {/* Priority (Editable dropdown/badge) */}
                      <td className="p-4 text-center">
                        <select
                          value={order.priority}
                          onChange={e => handleUpdate(order.id, 'priority', e.target.value)}
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold outline-none cursor-pointer text-center bg-[#18181b] ${getPriorityBadgeColor(order.priority)}`}
                        >
                          <option value="Low">Low</option>
                          <option value="Normal">Normal</option>
                          <option value="High">High</option>
                        </select>
                      </td>

                      {/* Status (Editable select) */}
                      <td className="p-4">
                        <select
                          value={order.status}
                          onChange={e => handleUpdate(order.id, 'status', e.target.value)}
                          className={`px-2 py-1 rounded border text-[10px] font-bold outline-none cursor-pointer font-sans bg-[#18181b] ${getStatusBadgeColor(order.status)}`}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Ordered">Ordered</option>
                          <option value="Ready">Ready</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </td>

                      {/* WhatsApp Notification Status */}
                      <td className="p-4 text-center">
                        {order.phone ? (
                          order.notified === 1 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-green bg-green/10 px-2 py-0.5 rounded-full border border-green/30 select-none">
                              <Bell size={10} className="animate-pulse" />
                              Notified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted bg-white/5 px-2 py-0.5 rounded-full border border-glass-border select-none">
                              <Clock size={10} />
                              Pending Alert
                            </span>
                          )
                        ) : (
                          <span className="text-[10px] text-muted/65 italic select-none">No Phone</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="p-4 text-right text-muted font-mono select-none">
                        {parseSqliteDate(order.date).toLocaleDateString('en-IN')}
                        <div className="text-[10px] mt-0.5">
                          {parseSqliteDate(order.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="p-4 text-center flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            navigate('/mail', {
                              state: {
                                searchDistributor: order.pharmarack_distributor || '',
                                searchProduct: order.product || '',
                                orderId: order.id,
                              }
                            });
                          }}
                          className="p-1.5 hover:bg-primary/10 text-muted hover:text-primary rounded-lg transition-all"
                          title="Process Invoice in Mail"
                        >
                          <Mail size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(order.id)}
                          className="p-1.5 hover:bg-red/10 text-muted hover:text-red rounded-lg transition-all"
                          title="Delete Request"
                        >
                          <Trash2 size={13} />
                        </button>
                        {(order.status === 'Ready' || order.status === 'Completed') && (
                          <button
                            onClick={() => handleConvertToRefill(order)}
                            className="p-1.5 hover:bg-emerald-500/10 text-muted hover:text-emerald-400 rounded-lg transition-all"
                            title="Convert to Recurring Refill"
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-[#18181b]/60 backdrop-blur-sm border-t border-glass-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text select-none shrink-0">
              <div className="text-muted text-gray-400">
                Showing <span className="font-semibold text-white">{Math.min(filteredOrders.length, (currentPage - 1) * pageSize + 1)}</span> to{' '}
                <span className="font-semibold text-white">{Math.min(filteredOrders.length, currentPage * pageSize)}</span> of{' '}
                <span className="font-semibold text-white">{filteredOrders.length}</span> requests
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 bg-bg3 hover:bg-white/10 text-text border border-glass-border rounded-lg font-semibold disabled:opacity-40 disabled:hover:bg-bg3 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                
                {/* Page numbers */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => {
                      const showEllipsisBefore = idx > 0 && p - arr[idx - 1] > 1;
                      return (
                        <Fragment key={p}>
                          {showEllipsisBefore && <span className="px-1 text-muted text-gray-500">...</span>}
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold border transition-all ${
                              currentPage === p
                                ? 'bg-primary/20 text-primary border-primary/40'
                                : 'bg-bg3 hover:bg-white/10 text-text border-glass-border'
                            }`}
                          >
                            {p}
                          </button>
                        </Fragment>
                      );
                    })}
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 bg-bg3 hover:bg-white/10 text-text border border-glass-border rounded-lg font-semibold disabled:opacity-40 disabled:hover:bg-bg3 transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Table Footer Stats */}
          <div className="p-3 border-t border-glass-border bg-black/10 text-muted select-none flex justify-between items-center px-4">
            <span>Total Requests: <strong>{filteredOrders.length}</strong></span>
            {orders.some(o => o.status === 'Ready') && (
              <span className="flex items-center gap-1.5 text-xs text-sky">
                <Bell size={12} className="animate-bounce" />
                Some requests are ready for pickup
              </span>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

export default Orders;
