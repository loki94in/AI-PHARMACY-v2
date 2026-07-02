import { useState, useEffect, useCallback, Fragment, useRef } from 'react';
import { Edit3, Trash2, X, User, FileText, Save, AlertTriangle, BookOpen, RefreshCw, ShieldAlert, Factory } from 'lucide-react';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

interface SaleItem {
  id: number;
  invoice_id: number;
  inventory_id: number;
  medicine_id?: number;
  quantity: number;
  unit_price: number;
  loose_qty?: number;
  pack_size?: number;
  batch_number?: string;
  expiry_date?: string;
  medicine_name?: string;
  mrp?: number;
  discount_per?: number;
}

interface SaleInvoice {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  tax_amount: number;
  payment_medium?: string;
  payment_status?: string;
  roff?: number;
  cgst_value?: number;
  sgst_value?: number;
  igst_value?: number;
  customer_name?: string;
  customer_phone?: string;
  doctor_name?: string;
  discount?: number;
  subtotal?: number;
  items?: SaleItem[];
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
let cachedInvoices: SaleInvoice[] | null = null;

const Sells = () => {
  const [invoices, setInvoices] = useState<SaleInvoice[]>(cachedInvoices || []);
  const [loading, setLoading] = useState(!cachedInvoices);
  const [colFilterNo, setColFilterNo] = useState('');
  const [colFilterName, setColFilterName] = useState('');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterDrName, setColFilterDrName] = useState('');
  const [colFilterMinAmount, setColFilterMinAmount] = useState('');
  const [colFilterMaxAmount, setColFilterMaxAmount] = useState('');
  const [colFilterPayVia, setColFilterPayVia] = useState('');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [colFilterNo, colFilterName, colFilterDate, colFilterDrName, colFilterMinAmount, colFilterMaxAmount, colFilterPayVia]);

  // Edit modal state
  const [editInvoice, setEditInvoice] = useState<SaleInvoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<SaleInvoice | null>(null);
  const [editItems, setEditItems] = useState<SaleItem[]>([]);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editDiscount, setEditDiscount] = useState(0);
  const [editPaymentMedium, setEditPaymentMedium] = useState('CASH');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // OpenFDA Enrichment Drawer State
  const [selectedEnrichedItem, setSelectedEnrichedItem] = useState<{ medicine_name: string; batch?: string } | null>(null);
  const [enrichedData, setEnrichedData] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Universal Edit state
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);

  const handleOpenEnrichment = async (item: SaleItem) => {
    if (!item.medicine_id) {
      toastEvent.trigger('Medicine profile not available', 'error');
      return;
    }
    setSelectedEnrichedItem({ medicine_name: item.medicine_name || 'Unknown', batch: item.batch_number });
    setPanelOpen(true);
    setDetailsLoading(true);
    try {
      const data = await api.getEnrichedMedicine(item.medicine_id);
      setEnrichedData(data);
    } catch (err) {
      console.error('Failed to load enriched details:', err);
      toastEvent.trigger('Failed to load medical profile', 'error');
      setPanelOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  const isInitial = useRef(true);

  const fetchInvoices = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // ponytail: only filter by date if colFilterDate is selected. If empty, load latest invoices across all dates.
      const params: { limit: number; date_from?: string; date_to?: string } = { limit: 50 };
      if (colFilterDate) {
        params.date_from = colFilterDate;
        params.date_to = colFilterDate;
      }
      const data = await api.listSales(params);
      const invoicesList = Array.isArray(data) ? data : (data && Array.isArray(data.invoices) ? data.invoices : []);
      cachedInvoices = invoicesList;
      setInvoices(invoicesList);
    } catch (err) {
      console.error('Failed to load sales:', err);
      toastEvent.trigger('Failed to load sales', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [colFilterDate]);

  // Handle mount fetch
  useEffect(() => {
    fetchInvoices(!!cachedInvoices);
  }, []);

  // Handle date filter change fetch (skip initial mount)
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    fetchInvoices(false);
  }, [colFilterDate]);

  const openView = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(full);
    } catch (err) {
      toastEvent.trigger('Failed to load invoice details', 'error');
    }
  };

  const openEdit = async (invoice: SaleInvoice) => {
    try {
      const full = await api.getSale(invoice.id);
      setViewInvoice(null);
      setEditInvoice(full);
      setEditItems(full.items || []);
      setEditCustomerName(full.customer_name || '');
      setEditCustomerPhone(full.customer_phone || '');
      setEditPaymentMedium(full.payment_medium || 'CASH');
      setEditDiscount(0);
    } catch (err) {
      toastEvent.trigger('Failed to load invoice details', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editInvoice) return;
    setSaving(true);
    try {
      await api.updateSale(editInvoice.id, {
        items: editItems.map(item => ({
          inventory_id: item.inventory_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          loose_qty: item.loose_qty || 0,
          discount_per: item.discount_per || 0,
        })),
        patient_name: editCustomerName,
        patient_phone: editCustomerPhone,
        discount: editDiscount,
        paymentMedium: editPaymentMedium,
      });
      toastEvent.trigger('Invoice updated successfully', 'success');
      setEditInvoice(null);
      fetchInvoices(true);
    } catch (err) {
      toastEvent.trigger('Failed to update invoice', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteSale(id);
      toastEvent.trigger('Invoice deleted, stock restored', 'success');
      setDeleteConfirm(null);
      fetchInvoices(true);
    } catch (err) {
      toastEvent.trigger('Failed to delete invoice', 'error');
    }
  };

  const updateItemQty = (index: number, qty: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(0, qty) } : item));
  };

  const updateItemPrice = (index: number, price: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, unit_price: price } : item));
  };

  const updateItemLooseQty = (index: number, looseQty: number) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, loose_qty: Math.max(0, looseQty) } : item));
  };

  const updateItemMrp = (index: number, mrp: number) => {
    const newItems = [...editItems];
    newItems[index].mrp = mrp;
    setEditItems(newItems);
  };

  const updateItemDiscountPer = (index: number, discPer: number) => {
    const newItems = [...editItems];
    newItems[index].discount_per = Math.min(100, Math.max(0, discPer));
    setEditItems(newItems);
  };

  const removeItem = (index: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== index));
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return d;
    }
  };

  const filteredInvoices = invoices.filter(inv => {
    const total = Number(inv.total_amount) || 0;

    // Column header filters
    if (colFilterNo && !inv.invoice_no.toLowerCase().includes(colFilterNo.toLowerCase())) {
      return false;
    }
    if (colFilterName) {
      const nameMatch = (inv.customer_name || 'Walk-in').toLowerCase().includes(colFilterName.toLowerCase());
      const phoneMatch = (inv.customer_phone || '').includes(colFilterName);
      if (!nameMatch && !phoneMatch) return false;
    }
    if (colFilterDate) {
      const invDate = inv.date ? inv.date.split('T')[0] : '';
      if (invDate !== colFilterDate) return false;
    }
    if (colFilterDrName && !((inv.doctor_name || '').toLowerCase().includes(colFilterDrName.toLowerCase()))) {
      return false;
    }
    
    // Column header min/max amount filter
    const colMin = colFilterMinAmount ? Number(colFilterMinAmount) : 0;
    const colMax = colFilterMaxAmount ? Number(colFilterMaxAmount) : 100000000;
    if (total < colMin || total > colMax) return false;

    if (colFilterPayVia && inv.payment_medium !== colFilterPayVia) {
      return false;
    }

    return true;
  });

  const totalPages = Math.ceil(filteredInvoices.length / pageSize);
  const paginatedInvoices = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="h-full flex flex-col px-6 py-6 animate-in fade-in duration-500">

      {/* Invoices Table */}
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-0 border border-white/20 flex-1 flex flex-col overflow-hidden min-h-0">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted">
            <div className="animate-pulse">Loading invoices...</div>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted">
            <FileText size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No invoices found</p>
            <p className="text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 bg-[#18181b]/95 backdrop-blur-sm shadow-sm">
                <tr>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">No.</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Name of the patient</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Date</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Dr Name</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Bill Amount</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Final Amount</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Discount</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Pay Via</th>
                  <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border">Actions</th>
                </tr>
                <tr className="bg-bg2 border-b border-glass-border/30">
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search No..."
                      value={colFilterNo}
                      onChange={e => setColFilterNo(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search patient/phone..."
                      value={colFilterName}
                      onChange={e => setColFilterName(e.target.value)}
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
                  <td className="p-2">
                    <input
                      type="text"
                      placeholder="Search doctor..."
                      value={colFilterDrName}
                      onChange={e => setColFilterDrName(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                  </td>
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
                  <td className="p-2"></td>
                  <td className="p-2"></td>
                  <td className="p-2">
                    <select
                      value={colFilterPayVia}
                      onChange={e => setColFilterPayVia(e.target.value)}
                      className="w-full px-2 py-1 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50"
                    >
                      <option value="">All</option>
                      <option value="CASH">CASH</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">CARD</option>
                      <option value="CREDIT">CREDIT</option>
                    </select>
                  </td>
                  <td className="p-2 text-center">
                    {(colFilterNo || colFilterName || colFilterDate || colFilterDrName || colFilterMinAmount || colFilterMaxAmount || colFilterPayVia) && (
                      <button
                        onClick={() => {
                          setColFilterNo('');
                          setColFilterName('');
                          setColFilterDate('');
                          setColFilterDrName('');
                          setColFilterMinAmount('');
                          setColFilterMaxAmount('');
                          setColFilterPayVia('');
                        }}
                        className="text-xs text-red hover:underline font-bold"
                      >
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map((inv, idx) => (
                  <tr key={inv.id} className="hover:bg-white/10 transition-all duration-300 group relative z-10 hover:shadow-lg hover:-translate-y-0.5">
                    <td className="p-4 border-b border-glass-border/50 relative cursor-pointer">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary to-purple-500 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center"></div>
                      <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20 shadow-sm">{inv.invoice_no}</span>
                    </td>
                    <td className="p-4 border-b border-glass-border/50 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="bg-white/5 p-2 rounded-full border border-glass-border shadow-sm group-hover:bg-white/10 group-hover:shadow-md transition-all">
                          <User size={14} className="text-muted group-hover:text-primary transition-colors" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-text group-hover:text-primary transition-colors">{inv.customer_name || 'Walk-in'}</div>
                          {inv.customer_phone && <div className="text-[10px] text-muted font-medium mt-0.5">{inv.customer_phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 border-b border-glass-border/50 text-sm text-muted">
                      {formatDate(inv.date)}
                    </td>
                    <td className="p-4 border-b border-glass-border/50 text-sm text-muted">
                      {inv.doctor_name || '-'}
                    </td>
                    <td className="p-4 border-b border-glass-border/50">
                      <span className="text-sm font-bold text-text">₹{Math.round(Number(inv.subtotal || 0))}</span>
                    </td>
                    <td className="p-4 border-b border-glass-border/50">
                      <span className="text-sm font-bold text-green">₹{Math.round(Number(inv.total_amount || 0))}</span>
                    </td>
                    <td className="p-4 border-b border-glass-border/50 text-sm text-muted">
                      ₹{Math.round(Number(inv.discount || 0))}
                    </td>
                    <td className="p-4 border-b border-glass-border/50">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-muted">
                        {inv.payment_medium || 'CASH'}
                      </span>
                    </td>

                    <td className="p-4 border-b border-glass-border/50">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 min-w-[140px]">
                        {deleteConfirm === inv.id ? (
                          <div className="flex items-center gap-2 p-1 rounded-lg bg-red/10 border border-red/20 w-full justify-center">
                            <button
                              onClick={() => handleDelete(inv.id)}
                              className="px-3 py-1.5 bg-red text-white rounded-md text-[10px] font-bold hover:bg-red/80 shadow-md transform hover:scale-105 transition-all"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-3 py-1.5 bg-white/10 text-text rounded-md text-[10px] font-bold hover:bg-white/20 shadow-sm transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => openView(inv)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-sky-500 hover:text-white border border-glass-border hover:border-sky-500 shadow-sm hover:shadow-[0_0_15px_rgba(14,165,233,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95"
                              title="View invoice"
                            >
                              <FileText size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(inv.id)}
                              className="p-2 rounded-lg bg-white/5 hover:bg-red hover:text-white border border-glass-border hover:border-red shadow-sm hover:shadow-[0_0_15px_rgba(220,38,38,0.4)] text-muted transition-all transform hover:scale-105 active:scale-95"
                              title="Delete invoice"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-[#18181b]/60 backdrop-blur-sm border-t border-glass-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text select-none">
              <div className="text-muted">
                Showing <span className="font-semibold text-text">{Math.min(filteredInvoices.length, (currentPage - 1) * pageSize + 1)}</span> to{' '}
                <span className="font-semibold text-text">{Math.min(filteredInvoices.length, currentPage * pageSize)}</span> of{' '}
                <span className="font-semibold text-text">{filteredInvoices.length}</span> invoices
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
                        <Fragment key={p}>
                          {showEllipsisBefore && <span className="px-1 text-muted">...</span>}
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
                        </Fragment>
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
        </>
      )}
      </div>

      {/* Edit Modal */}
      {editInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] overflow-y-auto border-primary/20">
            {/* Modal Header */}
            <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5 sticky top-0 z-10">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Edit3 size={18} className="text-primary" />
                  Edit Invoice: {editInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-1">Modify items, customer, or payment details</p>
              </div>
              <button
                onClick={() => setEditInvoice(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5">
              {/* Customer Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Customer Name</label>
                  <input
                    type="text"
                    value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                    placeholder="Customer name..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                    placeholder="Phone number..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted uppercase tracking-wider mb-1 block">Payment Method</label>
                  <select
                    value={editPaymentMedium}
                    onChange={e => setEditPaymentMedium(e.target.value)}
                    className="w-full px-3 py-2 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-muted uppercase tracking-wider">Invoice Items</h4>
                  <span className="text-xs text-muted">{editItems.length} item{editItems.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="overflow-x-auto border border-glass-border rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Medicine</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Batch</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Expiry</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">Strips</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">Loose</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20 text-center">CD %</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">MRP</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Unit Price</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Subtotal</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.map((item, idx) => {
                        const packSize = item.pack_size || 10;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={item.id} className="hover:bg-white/5">
                            <td className="p-3 border-b border-glass-border/50 text-sm font-semibold">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleOpenEnrichment(item)}
                                  className="text-primary hover:text-sky-400 p-1 bg-primary/10 rounded-lg transition-colors border border-primary/20 shadow-sm"
                                  title="View Medical Profile"
                                >
                                  <BookOpen size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (item.medicine_id) setUniversalEditMedicineId(item.medicine_id);
                                  }}
                                  disabled={!item.medicine_id}
                                  className={`p-1 rounded-lg transition-all border shadow-sm ${item.medicine_id ? 'bg-sky/10 border-sky/20 text-sky hover:text-white hover:bg-sky' : 'opacity-30 cursor-not-allowed border-glass-border text-muted bg-white/5'}`}
                                  title="Quick Edit Medicine"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <span>{item.medicine_name || `Item #${item.inventory_id}`}</span>
                              </div>
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded">{item.batch_number || '-'}</span>
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-[11px] text-muted">{item.expiry_date || '-'}</td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={e => updateItemQty(idx, parseInt(e.target.value) || 0)}
                                className="w-16 px-2 py-1 bg-black/20 border border-glass-border rounded text-sm text-text text-center focus:outline-none focus:border-primary/50"
                                min={0}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={looseQty}
                                onChange={e => updateItemLooseQty(idx, parseInt(e.target.value) || 0)}
                                className="w-16 px-2 py-1 bg-amber/10 border border-amber/30 rounded text-sm text-amber text-center focus:outline-none focus:border-amber/50"
                                min={0}
                                max={packSize - 1}
                                title={`Loose units (max ${packSize - 1} per strip)`}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center">
                              <input
                                type="number"
                                value={item.discount_per || ''}
                                onChange={e => updateItemDiscountPer(idx, parseFloat(e.target.value) || 0)}
                                className="w-16 px-2 py-1 bg-sky/10 border border-sky/30 rounded text-sm text-sky text-center focus:outline-none focus:border-sky/50"
                                min={0}
                                max={100}
                                placeholder="%"
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.mrp || 0}
                                onChange={e => updateItemMrp(idx, parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 bg-purple/10 border border-purple/30 rounded text-sm text-purple text-right focus:outline-none focus:border-purple/50"
                                min={0}
                                step={0.01}
                                title="MRP (Maximum Retail Price)"
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <input
                                type="number"
                                value={item.unit_price}
                                onChange={e => updateItemPrice(idx, parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 bg-black/20 border border-glass-border rounded text-sm text-text text-right focus:outline-none focus:border-primary/50"
                                min={0}
                                step={0.01}
                              />
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-bold text-green text-right">
                              ₹{Math.round(itemTotal)}
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <button
                                onClick={() => removeItem(idx)}
                                className="p-1 rounded hover:bg-red/20 text-muted hover:text-red transition-all"
                                title="Remove item"
                              >
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-white/5">
                        <td colSpan={6} className="p-3 text-sm font-bold text-muted text-right">Subtotal:</td>
                        <td className="p-3 text-sm font-bold text-green text-right">
                          ₹{Math.round(editItems.reduce((sum, item) => {
                            const pSize = item.pack_size || 10;
                            const q = item.quantity || 0;
                            const l = item.loose_qty || 0;
                            const d = item.discount_per || 0;
                            const dPrice = item.unit_price * (1 - d / 100);
                            return sum + (q * dPrice) + (l * (dPrice / pSize));
                          }, 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Discount */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Discount (₹)</label>
                <input
                  type="number"
                  value={editDiscount}
                  onChange={e => setEditDiscount(parseFloat(e.target.value) || 0)}
                  className="w-24 px-3 py-1.5 bg-black/20 border border-glass-border rounded-lg text-sm text-text focus:outline-none focus:border-primary/50"
                  min={0}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-glass-border flex justify-between items-center bg-white/5 sticky bottom-0">
              <button
                onClick={() => setEditInvoice(null)}
                className="px-4 py-2 bg-white/10 text-muted rounded-lg text-sm font-semibold hover:bg-white/20 transition-all"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-muted">Total</div>
                  <div className="text-lg font-extrabold text-green">
                    ₹{Math.round(editItems.reduce((sum, item) => {
                      const pSize = item.pack_size || 10;
                      const q = item.quantity || 0;
                      const l = item.loose_qty || 0;
                      const d = item.discount_per || 0;
                      const dPrice = item.unit_price * (1 - d / 100);
                      return sum + (q * dPrice) + (l * (dPrice / pSize));
                    }, 0) - editDiscount)}
                  </div>
                </div>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/80 disabled:opacity-50 transition-all"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* View Modal */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] flex flex-col border-sky-500/20">
            {/* Modal Header */}
            <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5 shrink-0">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <FileText size={18} className="text-sky-500" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-1">Read-only view of the invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5 flex-1 overflow-y-auto">
              {/* Customer Info */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/5 p-4 rounded-xl border border-glass-border">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Customer Name</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Phone</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Payment Method</div>
                  <div className="text-sm font-semibold text-text">{viewInvoice.payment_medium || 'CASH'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Date</div>
                  <div className="text-sm font-semibold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-muted uppercase tracking-wider">Invoice Items</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item{(viewInvoice.items?.length || 0) !== 1 ? 's' : ''}</span>
                </div>
                <div className="overflow-x-auto border border-glass-border rounded-lg bg-black/20">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Medicine</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Batch</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">Qty (Strips/Loose)</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center">CD %</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">MRP</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Unit Price</th>
                        <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewInvoice.items?.map((item, idx) => {
                        const packSize = item.pack_size || 10;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-white/5">
                            <td className="p-3 border-b border-glass-border/50 text-sm font-semibold">
                              {item.medicine_name || `Item #${item.inventory_id}`}
                            </td>
                            <td className="p-3 border-b border-glass-border/50">
                              <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded">{item.batch_number || '-'}</span>
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center text-sm">
                              {item.quantity} / {looseQty}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-center text-sm">
                              {discPer}%
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm text-muted">
                              ₹{item.mrp || 0}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-medium">
                              ₹{discountedPrice.toFixed(2)}
                            </td>
                            <td className="p-3 border-b border-glass-border/50 text-sm font-bold text-green">
                              ₹{Math.round(itemTotal)}
                            </td>
                          </tr>
                        );
                      })}
                      {(!viewInvoice.items || viewInvoice.items.length === 0) && (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-muted">No items found in this invoice</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discount & Tax Info */}
              <div className="flex justify-end pt-2 mt-6">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Subtotal:</span>
                    <span className="font-semibold">₹{Math.round(viewInvoice.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Discount:</span>
                    <span className="font-semibold text-amber-500">-₹{Math.round(viewInvoice.discount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-glass-border/50">
                    <span className="text-text">Grand Total:</span>
                    <span className="text-green text-xl">₹{Math.round(viewInvoice.total_amount || 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-glass-border flex justify-between items-center bg-white/5 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-white/10 text-muted rounded-lg text-sm font-semibold hover:bg-white/20 transition-all"
              >
                Close Preview
              </button>
              <button
                onClick={() => openEdit(viewInvoice)}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/80 transition-all"
              >
                <Edit3 size={14} />
                Edit Invoice
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Sliding Details Drawer for OpenFDA Enrichment */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-[450px] bg-[#121214]/95 backdrop-blur-xl border-l border-glass-border shadow-[-8px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-in-out z-drawer flex flex-col ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedEnrichedItem && (
          <>
            {/* Header */}
            <div className="p-6 border-b border-glass-border flex justify-between items-center bg-white/5">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-purple-400 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                  Medical Profile
                </span>
                <h4 className="text-xl font-bold mt-1 text-white">{selectedEnrichedItem.medicine_name}</h4>
              </div>
              <button 
                onClick={() => setPanelOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-muted hover:text-white transition-colors"
                aria-label="Close panel"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Enrichment Section */}
              <div className="space-y-5">
                <h5 className="text-xs font-bold uppercase tracking-widest text-muted border-b border-glass-border pb-2">openFDA Intelligence</h5>

                {detailsLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 space-y-3">
                    <RefreshCw className="animate-spin text-purple-500" size={24} />
                    <span className="text-sm text-muted">Retrieving OpenFDA monographs...</span>
                  </div>
                ) : enrichedData ? (
                  <div className="space-y-5 fade-in">
                    {/* Active Ingredients */}
                    <div>
                      <span className="text-xs text-muted uppercase font-bold block mb-2">Active Ingredients</span>
                      <div className="flex flex-wrap gap-2">
                        {enrichedData.activeIngredients && enrichedData.activeIngredients.length > 0 ? (
                          enrichedData.activeIngredients.map((ing: string, i: number) => (
                            <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              {ing}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-muted italic">Generic formula not indexed.</span>
                        )}
                      </div>
                    </div>

                    {/* Indications */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-sky-400">
                        <BookOpen size={14} className="text-sky-400" /> Indications & Usage
                      </span>
                      <div className="bg-white/5 p-3 rounded-lg border border-glass-border text-sm text-muted leading-relaxed max-h-48 overflow-y-auto">
                        {enrichedData.indications || 'Not available.'}
                      </div>
                    </div>

                    {/* Warnings */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-yellow-500">
                        <AlertTriangle size={14} /> Warnings & Precautions
                      </span>
                      <div className="bg-yellow-500/5 p-3 rounded-lg border border-yellow-500/20 text-sm text-yellow-200/80 leading-relaxed max-h-48 overflow-y-auto">
                        {enrichedData.warnings || 'No active drug safety warnings.'}
                      </div>
                    </div>

                    {/* Side Effects */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-red-500">
                        <ShieldAlert size={14} /> Adverse Reactions
                      </span>
                      <div className="bg-red-500/5 p-3 rounded-lg border border-red-500/20 text-sm text-red-300 leading-relaxed max-h-48 overflow-y-auto">
                        {enrichedData.sideEffects || 'No common adverse reactions logged.'}
                      </div>
                    </div>

                    {/* Source and Manufacturer */}
                    <div className="pt-2 flex justify-between items-center text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <Factory size={12} /> Mfg: {enrichedData.manufacturer || 'Unknown'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-500 font-bold uppercase text-[10px] tracking-wide">
                        Source: {enrichedData.enrichmentSource || 'FDA'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted italic">No enrichment profile found.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>,
        document.body
      )}

      {universalEditMedicineId && (
        <UniversalMedicineEditModal 
          medicineId={universalEditMedicineId} 
          onClose={() => setUniversalEditMedicineId(null)} 
          onSave={() => {
            // Refetch to reflect any potential naming changes if needed
            fetchInvoices(true);
          }} 
        />
      )}

    </div>
  );
};

export default Sells;
