import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { Search, Filter, Download, Eye, Clock, CheckCircle, XCircle, AlertCircle, Database, RefreshCw, Paperclip, Trash2, Edit, ChevronDown, ChevronUp, Calendar } from 'lucide-react';

interface PurchaseTransaction {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  distributor_name: string;
  status?: string; // Paid, Pending, Refunded, Failed
  plan?: string;
  items?: any[];
  total_qty?: number;
  cn_amount?: number;
  cn_number?: string;
  original_amount?: number;
}

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

// Module-level cache for instant re-mount
let cachedTransactions: PurchaseTransaction[] | null = null;

const PurchaseHistory = () => {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<PurchaseTransaction[]>(cachedTransactions || []);
  const [loading, setLoading] = useState(!cachedTransactions);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [earliestDate, setEarliestDate] = useState<string>(getTodayString());
  const [dateRange, setDateRange] = useState({ start: getNDaysAgoString(15), end: getTodayString() });
  const [manualToDate, setManualToDate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [supplierFilter, setSupplierFilter] = useState('All');
  const [productFilter, setProductFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [colFilterId, setColFilterId] = useState('');
  const [colFilterDistributor, setColFilterDistributor] = useState('');
  const [colFilterInvoiceNo, setColFilterInvoiceNo] = useState('');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterMinAmount, setColFilterMinAmount] = useState('');
  const [colFilterMaxAmount, setColFilterMaxAmount] = useState('');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, supplierFilter, dateRange.start, dateRange.end, productFilter, colFilterId, colFilterDistributor, colFilterInvoiceNo, colFilterDate, colFilterMinAmount, colFilterMaxAmount]);

  // Fetch the date of the earliest transaction on mount
  useEffect(() => {
    api.getEarliestPurchaseDate()
      .then((res) => {
        const defaultBoundary = getTodayString();
        if (res && res.earliest) {
          const formatted = res.earliest.substring(0, 10);
          setEarliestDate(formatted);
          setDateRange(prev => {
            if (prev.start < formatted) {
              return { ...prev, start: formatted };
            }
            return prev;
          });
        } else {
          setEarliestDate(defaultBoundary);
          setDateRange(prev => {
            if (prev.start < defaultBoundary) {
              return { ...prev, start: defaultBoundary };
            }
            return prev;
          });
        }
      })
      .catch((err) => {
        console.error('Failed to fetch earliest transaction date:', err);
        const defaultBoundary = getTodayString();
        setEarliestDate(defaultBoundary);
        setDateRange(prev => {
          if (prev.start < defaultBoundary) {
            return { ...prev, start: defaultBoundary };
          }
          return prev;
        });
      });
  }, []);

  useEffect(() => {
    if (!manualToDate) {
      setDateRange(prev => ({ ...prev, end: getTodayString() }));
    }
  }, [manualToDate]);

  const handleDateFromChange = (val: string) => {
    if (!val) {
      setDateRange(prev => ({ ...prev, start: earliestDate }));
    } else if (val < earliestDate) {
      setDateRange(prev => ({ ...prev, start: earliestDate }));
    } else {
      setDateRange(prev => ({ ...prev, start: val }));
    }
  };

  const handleDateToChange = (val: string) => {
    if (!val) {
      setDateRange(prev => ({ ...prev, end: getTodayString() }));
    } else if (val < earliestDate) {
      setDateRange(prev => ({ ...prev, end: earliestDate }));
    } else {
      setDateRange(prev => ({ ...prev, end: val }));
    }
  };

  // Reconciliation States
  const [activeTab, setActiveTab] = useState<'history' | 'reconciliation'>('history');
  const [reconciliationList, setReconciliationList] = useState<any[]>([]);
  const [loadingRecon, setLoadingRecon] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [reissuingUid, setReissuingUid] = useState<number | null>(null);
  const [resolvingUid, setResolvingUid] = useState<number | null>(null);
  const [viewPurchase, setViewPurchase] = useState<any | null>(null);

  const fetchHistory = async (search = searchQuery, start = dateRange.start, end = dateRange.end) => {
    try {
      setLoading(true);
      const data = await api.getPurchases({
        search: search || undefined,
        start: start || undefined,
        end: end || undefined
      });
      setTransactions(Array.isArray(data) ? data : []);
      cachedTransactions = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Error fetching purchase history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchHistory(searchQuery, dateRange.start, dateRange.end);
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, dateRange.start, dateRange.end]);

  useEffect(() => {
    fetchReconciliation();
  }, []);

  const fetchReconciliation = async () => {
    try {
      setLoadingRecon(true);
      const data = await api.getReconciliationList();
      setReconciliationList(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching reconciliation list:', err);
    } finally {
      setLoadingRecon(false);
    }
  };

  const handleReissue = async (uid: number) => {
    if (!confirm('Are you sure you want to reprocess this email and reissue the items to inventory? This will record a new purchase invoice.')) {
      return;
    }
    try {
      setReissuingUid(uid);
      const result = await api.reissueOrder(uid);
      alert(result.message || 'Items successfully reissued to inventory!');
      await fetchHistory();
      await fetchReconciliation();
      if (selectedOrder?.email_uid === uid) {
        setSelectedOrder(null);
      }
    } catch (err: any) {
      console.error('Reissue error:', err);
      alert('Failed to reissue items: ' + (err.response?.data?.error || err.message));
    } finally {
      setReissuingUid(null);
    }
  };

  const handleResolveManually = async (uid: number) => {
    if (!confirm('Mark this email order as manually resolved/saved? This will not add items to inventory.')) {
      return;
    }
    try {
      setResolvingUid(uid);
      const result = await api.resolveOrderManually(uid);
      alert(result.message || 'Order resolved manually.');
      await fetchReconciliation();
      if (selectedOrder?.email_uid === uid) {
        setSelectedOrder(null);
      }
    } catch (err: any) {
      console.error('Resolve manually error:', err);
      alert('Failed to resolve order: ' + (err.response?.data?.error || err.message));
    } finally {
      setResolvingUid(null);
    }
  };

  const openView = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      setViewPurchase(data);
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      alert('Failed to load purchase details.');
    }
  };

  const openEdit = async (id: number) => {
    try {
      const data = await api.getPurchase(id);
      navigate('/manual-purchase', {
        state: {
          prefilledPurchase: {
            editPurchaseId: data.purchase.id,
            distributorName: data.purchase.distributor_name,
            invoiceNo: data.purchase.invoice_no,
            date: data.purchase.date,
            totalAmount: data.purchase.total_amount,
            globalCdPer: 0,
            cnAmount: data.purchase.cn_amount || 0,
            cnNumber: data.purchase.cn_number || '',
            reconcileExpiryReturnId: data.purchase.reconcile_expiry_return_id || null,
            items: data.items.map((item: any) => ({
              medicine_id: item.medicine_id,
              medicine_name: item.medicine_name,
              batch_no: item.batch_no,
              expiry_date: item.expiry_date,
              qty: item.quantity,
              free_qty: item.free_qty || 0,
              rate: item.cost_price,
              mrp: item.mrp,
              cgst_per: item.cgst_per,
              sgst_per: item.sgst_per,
              cd_per: item.cd_per || 0,
              cd_rs: item.cd_value || 0
            }))
          }
        }
      });
    } catch (err) {
      console.error('Failed to load purchase details:', err);
      alert('Failed to load purchase details.');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'Paid': return 'text-green-400 bg-green-400/10 border-green-400/20';
      case 'Pending': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      case 'Refunded': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'Failed': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'Paid': return <CheckCircle size={14} className="mr-1" />;
      case 'Pending': return <Clock size={14} className="mr-1" />;
      case 'Refunded': return <AlertCircle size={14} className="mr-1" />;
      case 'Failed': return <XCircle size={14} className="mr-1" />;
      default: return null;
    }
  };

  // Filter Logic
  const filteredData = transactions.filter(t => {
    // Search
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      t.invoice_no?.toLowerCase().includes(searchLower) ||
      t.id.toString().includes(searchLower) ||
      t.distributor_name?.toLowerCase().includes(searchLower) ||
      t.plan?.toLowerCase().includes(searchLower);

    // Status removed for cash workflow
    const matchesStatus = true;
    
    // Supplier
    const matchesSupplier = supplierFilter === 'All' || t.distributor_name === supplierFilter;

    // Date
    let matchesDate = true;
    if (dateRange.start && t.date) {
      matchesDate = matchesDate && t.date.substring(0, 10) >= dateRange.start;
    }
    if (dateRange.end && t.date) {
      matchesDate = matchesDate && t.date.substring(0, 10) <= dateRange.end;
    }

    // Product/Plan Filter
    const matchesProduct = !productFilter || t.plan?.toLowerCase().includes(productFilter.toLowerCase());

    if (!(matchesSearch && matchesStatus && matchesSupplier && matchesDate && matchesProduct)) {
      return false;
    }

    // Column header filters
    if (colFilterId && !t.id.toString().includes(colFilterId)) {
      return false;
    }
    if (colFilterDistributor && !(t.distributor_name || '').toLowerCase().includes(colFilterDistributor.toLowerCase())) {
      return false;
    }
    if (colFilterInvoiceNo && !(t.invoice_no || '').toLowerCase().includes(colFilterInvoiceNo.toLowerCase())) {
      return false;
    }
    if (colFilterDate) {
      const pDate = t.date ? t.date.substring(0, 10) : '';
      if (pDate !== colFilterDate) return false;
    }
    const amountVal = t.total_amount || 0;
    const minVal = colFilterMinAmount ? Number(colFilterMinAmount) : 0;
    const maxVal = colFilterMaxAmount ? Number(colFilterMaxAmount) : 100000000;
    if (amountVal < minVal || amountVal > maxVal) {
      return false;
    }

    return true;
  });

  const totalPages = Math.ceil(filteredData.length / pageSize);
  const paginatedData = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Extract unique suppliers for the filter dropdown
  const uniqueSuppliers = Array.from(new Set(transactions.map(t => t.distributor_name).filter(Boolean)));

  // Purchase Analytics
  const totalPurchases = filteredData.length;
  const totalAmount = filteredData.reduce((sum, t) => sum + (t.total_amount || 0), 0);
  const paidAmount = totalAmount; // Cash workflow, all are paid

  // Export Logic
  const exportToCSV = () => {
    if (filteredData.length === 0) {
      alert('No data to export!');
      return;
    }

    const headers = ['Purchase ID', 'Invoice No', 'Distributor', 'Date', 'Qty', 'Amount'];
    const csvRows = [headers.join(',')];

    filteredData.forEach(tx => {
      const row = [
        tx.id,
        `"${tx.invoice_no || ''}"`,
        `"${tx.distributor_name || ''}"`,
        `"${new Date(tx.date).toLocaleDateString()}"`,
        tx.total_qty || 0,
        tx.total_amount || 0
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `Purchase_History_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getUnreconciledCount = () => {
    return reconciliationList.filter(o => o.status === 'Missing' && !o.is_saved).length;
  };

  return (
    <div className="h-full flex flex-col pt-1 px-4 gap-0 pb-4 animate-in fade-in duration-500">
      {/* Tabs */}
      <div className="flex border-b border-glass-border/30 mb-0">
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Purchase History
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'reconciliation'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Reconcile Distributor Orders
          {getUnreconciledCount() > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">
              {getUnreconciledCount()} Missing
            </span>
          )}
        </button>
      </div>

      {activeTab === 'history' ? (
        <>
          {/* Purchase History Tab */}
          {/* Purchase Analytics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 bg-white/10 backdrop-blur-lg border border-white/20 border-b-0 rounded-t-xl z-30 relative">
            <div className="p-5 border-r border-white/10">
              <p className="text-gray-400 text-sm mb-1">Total Purchases</p>
              <p className="text-2xl font-bold text-white">{totalPurchases}</p>
            </div>
            <div className="p-5 border-r border-white/10">
              <p className="text-gray-400 text-sm mb-1">Total Value</p>
              <p className="text-2xl font-bold text-primary">₹{totalAmount.toFixed(2)}</p>
            </div>
            <div className="p-5">
              <p className="text-gray-400 text-sm mb-1">Total Paid</p>
              <p className="text-2xl font-bold text-green-400">₹{paidAmount.toFixed(2)}</p>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="bg-white/10 backdrop-blur-lg rounded-none p-5 border border-white/20 border-b-0 relative z-20 flex flex-col md:flex-row gap-4 items-center">
            <div className="flex-1 w-full relative">
              <input
                type="text"
                placeholder="Search by order ID, invoice number, or product name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 bg-black/20 border border-glass-border rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white/10 backdrop-blur-lg rounded-b-xl border border-white/20 flex-1 flex flex-col min-h-0 relative z-10 overflow-hidden shadow-2xl">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-[#18181b]/95 backdrop-blur-sm shadow-sm">
                  <tr className="bg-black/40 border-b border-glass-border/50 text-sm font-semibold text-gray-300">
                    <th className="px-6 py-4 whitespace-nowrap">Purchase ID</th>
                    <th className="px-6 py-4 whitespace-nowrap">Distributor Name</th>
                    <th className="px-6 py-4 whitespace-nowrap">Invoice No.</th>
                    <th className="px-6 py-4 whitespace-nowrap">Date</th>
                    <th className="px-6 py-4 whitespace-nowrap text-right">Qty</th>
                    <th className="px-6 py-4 whitespace-nowrap text-right">Amount</th>
                    <th className="px-6 py-4 whitespace-nowrap text-center">Action</th>
                  </tr>
                  <tr className="bg-bg2 border-b border-glass-border/30">
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="Search ID..."
                        value={colFilterId}
                        onChange={e => setColFilterId(e.target.value)}
                        className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="Search distributor..."
                        value={colFilterDistributor}
                        onChange={e => setColFilterDistributor(e.target.value)}
                        className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="Search Invoice..."
                        value={colFilterInvoiceNo}
                        onChange={e => setColFilterInvoiceNo(e.target.value)}
                        className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="date"
                        value={colFilterDate}
                        onChange={e => setColFilterDate(e.target.value)}
                        className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      />
                    </td>
                    <td className="p-2"></td>
                    <td className="p-2 flex gap-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={colFilterMinAmount}
                        onChange={e => setColFilterMinAmount(e.target.value)}
                        className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={colFilterMaxAmount}
                        onChange={e => setColFilterMaxAmount(e.target.value)}
                        className="w-1/2 px-1 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50"
                      />
                    </td>
                    <td className="p-2 text-center">
                      {(colFilterId || colFilterDistributor || colFilterInvoiceNo || colFilterDate || colFilterMinAmount || colFilterMaxAmount) && (
                        <button
                          onClick={() => {
                            setColFilterId('');
                            setColFilterDistributor('');
                            setColFilterInvoiceNo('');
                            setColFilterDate('');
                            setColFilterMinAmount('');
                            setColFilterMaxAmount('');
                          }}
                          className="text-xs text-red hover:underline font-bold"
                        >
                          Clear
                        </button>
                      )}
                    </td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border/30 text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                        <div className="flex justify-center items-center gap-2">
                          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                          Loading history...
                        </div>
                      </td>
                    </tr>
                  ) : filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-400">
                          <AlertCircle size={48} className="mb-4 opacity-20" />
                          <p className="text-lg">No transactions found</p>
                          <p className="text-sm opacity-70">Try adjusting your search or filters</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedData.map((tx) => (
                      <tr key={tx.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4 text-gray-300 font-mono">
                          #{tx.id.toString().padStart(6, '0')}
                        </td>
                        <td className="px-6 py-4 text-white font-medium">
                          {tx.distributor_name || '-'}
                        </td>
                        <td className="px-6 py-4 text-gray-300 font-mono text-xs">
                          {tx.invoice_no || '-'}
                        </td>
                        <td className="px-6 py-4 text-gray-400 whitespace-nowrap">
                          {new Date(tx.date).toLocaleDateString()}
                          <div className="text-xs text-gray-500 mt-0.5">
                            {new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-300 font-medium">
                          {tx.total_qty || 0}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          {tx.cn_amount && tx.cn_amount > 0 ? (
                            <div className="flex flex-col items-end">
                              <div className="flex items-center gap-1.5 justify-end">
                                <span className="text-xs text-gray-500 line-through">
                                  ₹{(tx.original_amount || (tx.total_amount + tx.cn_amount)).toFixed(2)}
                                </span>
                                <span className="text-white font-medium">
                                  ₹{tx.total_amount?.toFixed(2) || '0.00'}
                                </span>
                              </div>
                              <span className="text-[10px] text-sky-400 font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 mt-1 transition-all hover:bg-sky-500/25">
                                CN Applied: -₹{tx.cn_amount.toFixed(2)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-white font-medium">
                              ₹{tx.total_amount?.toFixed(2) || '0.00'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => openView(tx.id)} className="text-gray-400 hover:text-primary transition-colors p-1 rounded hover:bg-primary/10" title="View Details">
                              <Eye size={16} />
                            </button>
                            <button onClick={() => openEdit(tx.id)} className="text-gray-400 hover:text-blue-400 transition-colors p-1 rounded hover:bg-blue-400/10" title="Edit Purchase">
                              <Edit size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                if(window.confirm('Are you sure you want to delete this purchase? This will reduce the stock in inventory.')) {
                                  api.deletePurchase(tx.id).then(() => {
                                    alert('Purchase deleted and stock reverted');
                                    fetchHistory();
                                  }).catch((err) => {
                                    alert('Failed to delete purchase: ' + (err.response?.data?.error || err.message));
                                  });
                                }
                              }}
                              className="text-gray-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-400/10" title="Delete Purchase"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="px-6 py-3 bg-[#18181b]/60 backdrop-blur-sm border-t border-glass-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text select-none">
                <div className="text-muted text-gray-400">
                  Showing <span className="font-semibold text-white">{Math.min(filteredData.length, (currentPage - 1) * pageSize + 1)}</span> to{' '}
                  <span className="font-semibold text-white">{Math.min(filteredData.length, currentPage * pageSize)}</span> of{' '}
                  <span className="font-semibold text-white">{filteredData.length}</span> transactions
                </div>
                <div className="flex items-center gap-2">
                  <button
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
                          <React.Fragment key={p}>
                            {showEllipsisBefore && <span className="px-1 text-muted text-gray-500">...</span>}
                            <button
                              onClick={() => setCurrentPage(p)}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold border transition-all ${
                                currentPage === p
                                  ? 'bg-primary/20 text-primary border-primary/40'
                                  : 'bg-bg3 hover:bg-white/10 text-text border-glass-border'
                              }`}
                            >
                              {p}
                            </button>
                          </React.Fragment>
                        );
                      })}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 bg-bg3 hover:bg-white/10 text-text border border-glass-border rounded-lg font-semibold disabled:opacity-40 disabled:hover:bg-bg3 transition-all cursor-pointer disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Reconciliation Tab */}
          <div className="flex justify-between items-center bg-white/10 backdrop-blur-lg border border-white/20 border-b-0 p-5 rounded-t-xl relative z-20">
            <div>
              <h3 className="text-white font-semibold text-base">Unreconciled Distributor Orders</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Automatically scans incoming email receipts to check if they have been successfully booked to inventory.
              </p>
            </div>
            <button
              onClick={fetchReconciliation}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-glass-border text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <RefreshCw size={14} className={loadingRecon ? 'animate-spin' : ''} />
              Reload List
            </button>
          </div>

          <div className="bg-white/10 backdrop-blur-lg rounded-b-xl border border-white/20 flex-1 flex flex-col min-h-0 relative z-10 overflow-hidden shadow-2xl">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-[#18181b]/95 backdrop-blur-sm shadow-sm">
                  <tr className="bg-black/40 border-b border-glass-border/50 text-sm font-semibold text-gray-300">
                    <th className="px-6 py-4 whitespace-nowrap">Received Date</th>
                    <th className="px-6 py-4 whitespace-nowrap">Distributor / Sender</th>
                    <th className="px-6 py-4 whitespace-nowrap">Subject Line</th>
                    <th className="px-6 py-4 whitespace-nowrap">Extracted Invoice No.</th>
                    <th className="px-6 py-4 whitespace-nowrap">Medicines</th>
                    <th className="px-6 py-4 whitespace-nowrap text-center">Status</th>
                    <th className="px-6 py-4 whitespace-nowrap text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border/30 text-sm">
                  {loadingRecon ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                        <div className="flex justify-center items-center gap-2">
                          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                          Analyzing email receipts...
                        </div>
                      </td>
                    </tr>
                  ) : reconciliationList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                        <div className="flex flex-col items-center justify-center">
                          <CheckCircle size={48} className="text-green-500 mb-4 opacity-40" />
                          <p className="text-base font-bold text-white">All Clear!</p>
                          <p className="text-xs opacity-70 mt-1">No unreconciled or missing distributor orders detected from emails.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    reconciliationList.map((recon, idx) => (
                      <tr key={recon.email_uid || idx} className={`hover:bg-white/5 transition-colors ${recon.is_saved ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4 text-gray-400 whitespace-nowrap font-mono text-xs">
                          {new Date(recon.date).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-white font-medium">
                          {recon.extracted_distributor}
                          <div className="text-xs text-gray-500 font-normal mt-0.5 truncate max-w-[200px]">{recon.from}</div>
                        </td>
                        <td className="px-6 py-4 text-gray-300 max-w-xs truncate">
                          {recon.subject}
                        </td>
                        <td className="px-6 py-4 font-mono text-white text-xs">
                          {recon.extracted_invoice_no || 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          {recon.medicine_names && recon.medicine_names.length > 0 ? (
                            <div className="text-gray-300 max-w-xs truncate" title={recon.medicine_names.join(', ')}>
                              {recon.medicine_names.slice(0, 3).join(', ')}
                              {recon.medicine_names.length > 3 && ` +${recon.medicine_names.length - 3} more`}
                            </div>
                          ) : (
                            <span className="text-gray-500 text-xs italic">No medicines detected</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {recon.is_saved ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border text-green-400 bg-green-400/10 border-green-400/20">
                              <CheckCircle size={10} className="mr-1" /> Reconciled
                            </span>
                          ) : recon.status === 'Matched' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border text-yellow-400 bg-yellow-400/10 border-yellow-400/20">
                              <Clock size={10} className="mr-1" /> Unresolved (Matched)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border text-red-400 bg-red-400/10 border-red-400/20">
                              <AlertCircle size={10} className="mr-1" /> Missing
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => setSelectedOrder(recon)}
                              className="text-gray-400 hover:text-white transition-colors p-1.5 rounded bg-white/5 hover:bg-white/10 border border-glass-border/30"
                              title="Investigate Order"
                            >
                              <Eye size={14} />
                            </button>
                            {!recon.is_saved && (
                              <>
                                <button
                                  onClick={() => handleReissue(recon.email_uid)}
                                  disabled={reissuingUid !== null}
                                  className="text-green-400 hover:text-green-300 transition-colors p-1.5 rounded bg-green-500/10 hover:bg-green-500/20 border border-green-500/20"
                                  title="Reprocess & Reissue items to inventory"
                                >
                                  <RefreshCw size={14} className={reissuingUid === recon.email_uid ? 'animate-spin' : ''} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Investigation Modal */}
      {selectedOrder && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-glass-border/30 flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <AlertCircle size={20} className="text-primary" />
                  Investigate Distributor Order
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Email UID: #{selectedOrder.email_uid} &middot; Received {new Date(selectedOrder.date).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 p-1.5 rounded-lg border border-glass-border/30 transition-all text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6 text-sm">
              {/* Metadata Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/20 p-4 rounded-xl border border-glass-border/20">
                <div>
                  <span className="text-xs text-gray-400 block mb-1">From (Distributor)</span>
                  <strong className="text-white text-base">{selectedOrder.extracted_distributor}</strong>
                  <span className="text-[10px] text-gray-500 block font-mono mt-0.5">{selectedOrder.from}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Extracted Invoice No.</span>
                  <strong className="text-white text-base">{selectedOrder.extracted_invoice_no || 'N/A'}</strong>
                </div>
              </div>

              {/* Email Subject Line */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-sky uppercase tracking-wide">Subject Line</h4>
                <div className="bg-black/30 p-3 rounded-lg border border-glass-border/10 font-medium text-white">
                  {selectedOrder.subject}
                </div>
              </div>

              {/* Medicines List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-sky uppercase tracking-wide">Medicines in Order</h4>
                {selectedOrder.medicine_names && selectedOrder.medicine_names.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedOrder.medicine_names.map((name: string, i: number) => (
                      <div key={i} className="bg-white/5 border border-glass-border/20 p-3 rounded-xl flex justify-between items-center">
                        <span className="font-medium text-xs text-gray-300">{name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs italic bg-white/5 p-3 rounded-xl border border-glass-border/20">
                    No medicines detected in this order
                  </div>
                )}
              </div>

              {/* Reconciliation Analysis Card */}
              <div>
                <h4 className="text-xs font-bold text-sky uppercase tracking-wide mb-2">Reconciliation Analysis</h4>
                {selectedOrder.is_saved ? (
                  <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl text-green-400 flex items-start gap-3">
                    <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <strong className="block text-white text-xs">Successfully Reconciled</strong>
                      <span className="text-xs block mt-0.5">This order is already recorded in the purchase history. No further action is required.</span>
                    </div>
                  </div>
                ) : selectedOrder.status === 'Matched' ? (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl text-yellow-400 flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <strong className="block text-white text-xs">Matched in Purchase History</strong>
                      <span className="text-xs block mt-0.5">An invoice with number <strong>{selectedOrder.extracted_invoice_no}</strong> already exists in the database, but this specific email was not marked as saved. You can mark it as resolved manually.</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-red-400 flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <strong className="block text-white text-xs">Missing Order - Action Required</strong>
                      <span className="text-xs block mt-0.5">This order exists as a distributor email receipt, but is <strong>NOT</strong> recorded in the purchase history and items have <strong>NOT</strong> been delivered to inventory.</span>
                      <span className="text-xs block mt-1 text-red-300 font-semibold">
                        💡 Reissuing this order will automatically update inventory and trigger any pending patient refills for these medicines, generating pre-filled checkout bills!
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-glass-border/30 bg-black/20 flex flex-wrap gap-3 justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-glass-border/40 transition-all"
              >
                Close
              </button>
              {!selectedOrder.is_saved && (
                <>
                  <button
                    onClick={() => handleResolveManually(selectedOrder.email_uid)}
                    disabled={resolvingUid !== null}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 transition-all flex items-center gap-1.5"
                  >
                    {resolvingUid === selectedOrder.email_uid ? 'Resolving...' : 'Resolve Manually'}
                  </button>
                  <button
                    onClick={() => handleReissue(selectedOrder.email_uid)}
                    disabled={reissuingUid !== null}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold shadow-lg shadow-green-500/20 transition-all flex items-center gap-1.5"
                  >
                    {reissuingUid === selectedOrder.email_uid ? 'Reissuing...' : 'Reprocess & Reissue to Inventory'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* View Purchase Modal */}
      {viewPurchase && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-4xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
            <div className="p-6 border-b border-glass-border/30 flex justify-between items-center bg-black/40">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Eye size={20} className="text-primary" />
                  View Purchase Invoice: {viewPurchase.purchase.invoice_no || 'N/A'}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Distributor: {viewPurchase.purchase.distributor_name} &middot; Date: {new Date(viewPurchase.purchase.date).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setViewPurchase(null)}
                className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 p-1.5 rounded-lg border border-glass-border/30 transition-all text-xl font-bold"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-black/20 p-4 rounded-xl border border-glass-border/20">
                 <div>
                    <span className="text-xs text-gray-500 block mb-1">Invoice No.</span>
                    <strong className="text-white text-sm">{viewPurchase.purchase.invoice_no || 'N/A'}</strong>
                 </div>
                 <div>
                    <span className="text-xs text-gray-500 block mb-1">Date</span>
                    <strong className="text-white text-sm">{new Date(viewPurchase.purchase.date).toLocaleDateString()}</strong>
                 </div>
                 <div>
                    <span className="text-xs text-gray-500 block mb-1">Distributor</span>
                    <strong className="text-white text-sm">{viewPurchase.purchase.distributor_name}</strong>
                 </div>
                 <div>
                    <span className="text-xs text-gray-500 block mb-1">Total Amount</span>
                    <strong className="text-green-400 text-sm font-bold">₹{viewPurchase.purchase.total_amount?.toFixed(2) || '0.00'}</strong>
                 </div>
              </div>

              {viewPurchase.purchase.cn_amount > 0 && (
                <div className="bg-sky-950/20 border border-sky-500/20 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 font-bold text-lg font-mono">
                      CN
                    </div>
                    <div>
                      <span className="text-xs text-sky-300 font-semibold block">Credit Note Applied</span>
                      <span className="text-xs text-gray-400 font-mono">No: {viewPurchase.purchase.cn_number || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <span className="text-xs text-gray-500 block">Original Bill Total</span>
                      <span className="text-sm text-gray-300 font-medium line-through">
                        ₹{(viewPurchase.purchase.original_amount || (viewPurchase.purchase.total_amount + viewPurchase.purchase.cn_amount)).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-sky-400 block">CN Discount</span>
                      <span className="text-sm text-sky-400 font-semibold">
                        -₹{viewPurchase.purchase.cn_amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400 block">Net Amount Paid</span>
                      <span className="text-sm text-green-400 font-bold">
                        ₹{viewPurchase.purchase.total_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-bold text-gray-300 mb-3">Items</h4>
                <div className="border border-glass-border/20 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-black/40 text-gray-400 border-b border-glass-border/20 text-xs uppercase">
                      <tr>
                        <th className="px-4 py-3">Medicine</th>
                        <th className="px-4 py-3">Batch</th>
                        <th className="px-4 py-3">Expiry</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Free</th>
                        <th className="px-4 py-3 text-right">Rate</th>
                        <th className="px-4 py-3 text-right">MRP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/10">
                      {viewPurchase.items && viewPurchase.items.map((item: any, i: number) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="px-4 py-3 text-white font-medium">{item.medicine_name}</td>
                          <td className="px-4 py-3 text-gray-300 font-mono text-xs">{item.batch_no || '-'}</td>
                          <td className="px-4 py-3 text-gray-300 text-xs">{item.expiry_date || '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{item.free_qty || 0}</td>
                          <td className="px-4 py-3 text-right text-gray-300">₹{(Number(item.cost_price) || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-gray-300">₹{(Number(item.mrp) || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            
            <div className="p-5 border-t border-glass-border/30 bg-black/20 flex justify-end gap-3">
              <button
                onClick={() => setViewPurchase(null)}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-glass-border/40 transition-all"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  const idToEdit = viewPurchase.purchase.id;
                  setViewPurchase(null);
                  openEdit(idToEdit);
                }}
                className="px-5 py-2 text-sm font-bold rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all flex items-center gap-2"
              >
                <Edit size={16} />
                Edit Purchase
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    {/* Edit Purchase Modal */}
      {/* Floating Action Buttons */}
      {activeTab === 'history' && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
          {/* Drop-up Filter Menu */}
          {showFilters && (
            <div className="bg-[#18181b]/95 backdrop-blur-xl border border-glass-border rounded-2xl p-5 shadow-2xl animate-in slide-in-from-bottom-4 flex flex-col gap-4 min-w-[320px]">
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Filter size={16} className="text-primary" />
                  Filter Records
                </h3>
                <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-white transition-colors">
                  <XCircle size={18} />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-gray-400 text-sm">Distributor Name</label>
                <div className="bg-black/40 border border-glass-border rounded-xl p-2.5">
                  <select 
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="w-full bg-transparent text-white text-sm focus:outline-none"
                  >
                    <option value="All" className="bg-gray-900">All Distributors</option>
                    {uniqueSuppliers.map(sup => (
                      <option key={sup} value={sup} className="bg-gray-900">{sup}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-gray-400 text-sm">Date Range</label>
                  <label className="text-xs text-muted flex items-center gap-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={manualToDate}
                      onChange={e => setManualToDate(e.target.checked)}
                      className="rounded border-glass-border text-primary focus:ring-primary/20 bg-black/20"
                    />
                    Edit
                  </label>
                </div>
                <div className="flex items-center gap-2 bg-black/40 border border-glass-border rounded-xl p-2.5">
                  <input
                    type="date"
                    value={dateRange.start}
                    min={earliestDate}
                    max={getTodayString()}
                    onChange={(e) => handleDateFromChange(e.target.value)}
                    className="w-full bg-transparent text-white text-sm focus:outline-none"
                  />
                  <span className="text-gray-500">to</span>
                  <input
                    type="date"
                    value={dateRange.end}
                    min={earliestDate}
                    max={getTodayString()}
                    disabled={!manualToDate}
                    onChange={(e) => handleDateToChange(e.target.value)}
                    className="w-full bg-transparent text-white text-sm focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <button 
                onClick={() => { 
                  setSupplierFilter('All'); 
                  const defaultStart = getNDaysAgoString(15);
                  setDateRange({
                    start: defaultStart < earliestDate ? earliestDate : defaultStart, 
                    end: getTodayString()
                  }); 
                  setManualToDate(false); 
                }}
                className="w-full mt-2 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-semibold transition-colors border border-white/10"
              >
                Clear Filters
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 relative">
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`relative flex items-center gap-2 px-5 py-3 rounded-full text-white font-bold transition-all hover:scale-105 active:scale-95 shadow-xl border border-white/10 ${showFilters ? 'bg-white/20' : 'bg-glass-panel hover:bg-white/10'}`}
            >
              <Filter size={18} />
              Filter
              {(supplierFilter !== 'All' || 
                dateRange.start !== (getNDaysAgoString(15) < earliestDate ? earliestDate : getNDaysAgoString(15)) || 
                dateRange.end !== getTodayString()) && (
                <span className="w-2 h-2 rounded-full bg-primary absolute top-0 right-0 animate-pulse"></span>
              )}
            </button>

            <button 
              onClick={exportToCSV}
              className="flex items-center gap-2 bg-gradient-to-r from-primary to-blue-600 hover:shadow-[0_0_20px_rgba(37,99,235,0.4)] px-5 py-3 rounded-full text-white font-bold transition-all hover:scale-105 active:scale-95 shadow-xl border border-white/10"
            >
              <Download size={18} />
              Export CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchaseHistory;
