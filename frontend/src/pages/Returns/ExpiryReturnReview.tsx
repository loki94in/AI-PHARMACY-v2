import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Search, 
  Calendar, 
  Clock, 
  Building2, 
  FileText, 
  AlertTriangle, 
  Loader2, 
  Check, 
  X, 
  History, 
  Sparkles,
  ChevronRight,
  Filter
} from 'lucide-react';
import { api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';

interface ExpiryReviewItem {
  id: number;
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  pack_size?: number;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  current_stock_qty?: number;
  distributor_id?: number;
  distributor_name?: string;
  distributor_display_name?: string;
  cost_price: number;
  mrp: number;
  proposed_return_amount: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  return_id?: number;
  return_no?: string;
  notes?: string;
}

interface ReviewStats {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingAmount: number;
  approvedAmount: number;
  totalCount: number;
}

export const ExpiryReturnReview: React.FC<{ onPendingCountChange?: (count: number) => void }> = ({ onPendingCountChange }) => {
  const queryClient = useQueryClient();
  const [reviews, setReviews] = useState<ExpiryReviewItem[]>([]);
  const [stats, setStats] = useState<ReviewStats>({
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingAmount: 0,
    approvedAmount: 0,
    totalCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  // Audit history modal
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Reject modal state
  const [rejectingItem, setRejectingItem] = useState<ExpiryReviewItem | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  // Single Approval modal state
  const [approvingItem, setApprovingItem] = useState<ExpiryReviewItem | null>(null);
  const [approveLossPercentage, setApproveLossPercentage] = useState<string>('0');
  const [approveNotes, setApproveNotes] = useState('');
  const [approveError, setApproveError] = useState('');

  // Bulk Approval modal state
  const [showBulkApproveModal, setShowBulkApproveModal] = useState(false);
  const [bulkLossPercentage, setBulkLossPercentage] = useState<string>('0');
  const [bulkError, setBulkError] = useState('');

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getExpiryReviews({
        status: statusFilter,
        search: searchQuery || undefined,
      });

      if (res && res.success) {
        setReviews(res.reviews || []);
        setStats(res.stats || {
          pendingCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          pendingAmount: 0,
          approvedAmount: 0,
          totalCount: 0,
        });
        if (onPendingCountChange) {
          onPendingCountChange(res.stats?.pendingCount || 0);
        }
      }
    } catch (err) {
      console.error('Failed to load expiry reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, onPendingCountChange]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const res = await api.scanExpiryReviews();
      alert(`Scan Completed: Found ${res.expiredCount} expired batch(es), created ${res.pendingCreated} new review item(s). Stock remains untouched until approved.`);
      await fetchReviews();
    } catch (err) {
      console.error('Scan failed:', err);
      alert('Failed to trigger scan.');
    } finally {
      setScanning(false);
    }
  };

  const openApproveModal = (item: ExpiryReviewItem) => {
    setApprovingItem(item);
    setApproveLossPercentage('0');
    setApproveNotes('');
    setApproveError('');
  };

  const handleConfirmApprove = async () => {
    if (!approvingItem) return;
    const lossNum = parseFloat(approveLossPercentage);
    if (approveLossPercentage.trim() === '' || isNaN(lossNum) || lossNum < 0 || lossNum > 100) {
      setApproveError('Return percentage required: Please enter a valid percentage between 0% and 100% (use 0% for full recovery).');
      return;
    }

    setActionInProgressId(approvingItem.id);
    try {
      const res = await api.approveExpiryReview(approvingItem.id, {
        notes: approveNotes || undefined,
        loss_percentage: lossNum,
      });
      alert(`Return ${res.returnNo} approved and created successfully with ${lossNum}% distributor deduction!`);
      setApprovingItem(null);
      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
      await fetchReviews();
    } catch (err: any) {
      console.error('Failed to approve review:', err);
      setApproveError(`Approval failed: ${err?.response?.data?.error || err.message}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  const openRejectModal = (item: ExpiryReviewItem) => {
    setRejectingItem(item);
    setRejectNotes('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingItem) return;
    setActionInProgressId(rejectingItem.id);
    try {
      await api.rejectExpiryReview(rejectingItem.id, { notes: rejectNotes || 'Pharmacist rejected return proposal' });
      setRejectingItem(null);
      await fetchReviews();
    } catch (err: any) {
      console.error('Failed to reject review:', err);
      alert(`Rejection failed: ${err?.response?.data?.error || err.message}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllPending = () => {
    const pendingInView = reviews.filter(r => r.status === 'pending').map(r => r.id);
    if (selectedIds.size === pendingInView.length && pendingInView.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingInView));
    }
  };

  const openBulkApproveModal = () => {
    if (selectedIds.size === 0) return;
    setShowBulkApproveModal(true);
    setBulkLossPercentage('0');
    setBulkError('');
  };

  const handleConfirmBulkApprove = async () => {
    const lossNum = parseFloat(bulkLossPercentage);
    if (bulkLossPercentage.trim() === '' || isNaN(lossNum) || lossNum < 0 || lossNum > 100) {
      setBulkError('Return percentage required: Please enter a valid percentage between 0% and 100% (use 0% for full recovery).');
      return;
    }

    setBulkApproving(true);
    try {
      const res = await api.bulkApproveExpiryReviews(Array.from(selectedIds), lossNum);
      alert(`Successfully approved ${res.approvedCount} return(s) with ${lossNum}% deduction! Return Nos: ${res.returnNos?.join(', ') || 'Done'}`);
      setSelectedIds(new Set());
      setShowBulkApproveModal(false);
      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
      await fetchReviews();
    } catch (err: any) {
      console.error('Bulk approval failed:', err);
      setBulkError(`Bulk approval error: ${err?.response?.data?.error || err.message}`);
    } finally {
      setBulkApproving(false);
    }
  };

  const handleOpenAuditHistory = async () => {
    setShowAuditModal(true);
    setLoadingAudit(true);
    try {
      const res = await api.getExpiryReviewsAuditHistory();
      setAuditLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const pendingInView = reviews.filter(r => r.status === 'pending');

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden bg-bg text-text">
      {/* Top Banner / Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {/* Pending Card */}
        <div className="p-3.5 rounded-2xl bg-bg2/90 border border-amber-500/30 backdrop-blur-md flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert size={14} />
              Pending Review
            </span>
            <div className="text-xl font-black text-text font-mono">
              {stats.pendingCount} <span className="text-xs font-normal text-muted">batches</span>
            </div>
            <p className="text-[10px] text-muted font-medium">Require explicit pharmacist approval</p>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* Proposed Return Value */}
        <div className="p-3.5 rounded-2xl bg-bg2/90 border border-border/80 backdrop-blur-md flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={14} className="text-primary" />
              Proposed Claim Value
            </span>
            <div className="text-xl font-black text-text font-mono">
              ₹{stats.pendingAmount?.toFixed(2) || '0.00'}
            </div>
            <p className="text-[10px] text-muted font-medium">Total cost price of pending stock</p>
          </div>
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Sparkles size={20} />
          </div>
        </div>

        {/* Approved Card */}
        <div className="p-3.5 rounded-2xl bg-bg2/90 border border-emerald-500/30 backdrop-blur-md flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 size={14} />
              Approved Returns
            </span>
            <div className="text-xl font-black text-emerald-500 font-mono">
              {stats.approvedCount} <span className="text-xs font-normal text-muted">(₹{stats.approvedAmount?.toFixed(2) || '0.00'})</span>
            </div>
            <p className="text-[10px] text-muted font-medium">Processed with stock deduction</p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <Check size={20} />
          </div>
        </div>

        {/* Audit & Rejected Summary */}
        <div className="p-3.5 rounded-2xl bg-bg2/90 border border-border/80 backdrop-blur-md flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <History size={14} className="text-indigo-400" />
              Audit & History
            </span>
            <div className="text-xl font-black text-text font-mono">
              {stats.rejectedCount} <span className="text-xs font-normal text-muted">rejected</span>
            </div>
            <p className="text-[10px] text-muted font-medium">Full pharmacist audit trail preserved</p>
          </div>
          <button
            onClick={handleOpenAuditHistory}
            className="p-2.5 rounded-xl bg-bg3 text-text hover:bg-primary/20 hover:text-primary transition-all border border-border/60 cursor-pointer"
            title="View Audit Trail Logs"
          >
            <History size={20} />
          </button>
        </div>
      </div>

      {/* Action Bar & Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl p-3 shadow-sm shrink-0">
        {/* Search and Status Pills */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-bg3/60 p-1 rounded-xl border border-border/60">
            {[
              { id: 'pending', label: 'Pending', count: stats.pendingCount },
              { id: 'approved', label: 'Approved', count: stats.approvedCount },
              { id: 'rejected', label: 'Rejected', count: stats.rejectedCount },
              { id: 'all', label: 'All', count: stats.totalCount },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.id
                    ? 'bg-bg2 text-primary shadow-sm border border-border font-extrabold ring-1 ring-primary/20'
                    : 'text-muted hover:text-text'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  statusFilter === tab.id ? 'bg-primary/20 text-primary font-black' : 'bg-bg/60 text-muted'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search medicine, batch, distributor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text text-xs"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {statusFilter === 'pending' && selectedIds.size > 0 && (
            <button
              onClick={openBulkApproveModal}
              disabled={bulkApproving}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {bulkApproving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              <span>Approve Selected ({selectedIds.size})</span>
            </button>
          )}

          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="px-3.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            title="Scan inventory for expired stock and create pending review items"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            <span>{scanning ? 'Scanning…' : 'Scan Expired Stock'}</span>
          </button>

          <button
            onClick={fetchReviews}
            className="p-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-muted hover:text-text border border-border/60 transition-all cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Review Table Workspace */}
      <div className="flex-1 min-h-0 bg-bg2/90 backdrop-blur-md border border-border/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-bg3/90 backdrop-blur-md border-b border-border/80 text-muted uppercase text-[10px] font-black tracking-wider z-10">
              <tr>
                {statusFilter === 'pending' && (
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={pendingInView.length > 0 && selectedIds.size === pendingInView.length}
                      onChange={handleSelectAllPending}
                      className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                    />
                  </th>
                )}
                <th className="p-3">Medicine</th>
                <th className="p-3">Batch & Expiry</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Distributor</th>
                <th className="p-3 text-right">Proposed Claim</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3">Timeline</th>
                <th className="p-3 text-center">Pharmacist Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium text-text">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={18} className="animate-spin text-primary" />
                      <span>Loading expiry return reviews...</span>
                    </div>
                  </td>
                </tr>
              ) : reviews.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted/70 italic">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ShieldAlert size={32} className="text-muted/40" />
                      <p className="font-semibold text-xs text-text">No expiry reviews found in this category.</p>
                      <p className="text-[11px] text-muted">Click &quot;Scan Expired Stock&quot; to check active inventory for expired medicines.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                reviews.map(item => {
                  const isSelected = selectedIds.has(item.id);
                  const isPending = item.status === 'pending';
                  const isApproved = item.status === 'approved';
                  const isRejected = item.status === 'rejected';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-bg3/40 transition-colors ${
                        isSelected ? 'bg-primary/5' : ''
                      }`}
                    >
                      {statusFilter === 'pending' && (
                        <td className="p-3 text-center">
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(item.id)}
                              className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                            />
                          )}
                        </td>
                      )}
                      
                      {/* Medicine Name */}
                      <td className="p-3">
                        <div className="font-bold text-text text-xs flex items-center gap-1.5">
                          <span>{item.medicine_name}</span>
                        </div>
                        {item.pack_size && (
                          <div className="text-[10px] text-muted font-mono">
                            Pack: {item.pack_size}
                          </div>
                        )}
                      </td>

                      {/* Batch & Expiry */}
                      <td className="p-3">
                        <div className="font-mono font-bold text-xs text-text">{item.batch_no || '—'}</div>
                        <div className="text-[10px] text-red-500 font-bold font-mono">
                          Exp: {item.expiry_date || '—'}
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="p-3 font-mono">
                        <div className="font-bold text-xs text-text">{item.quantity} units</div>
                        {item.current_stock_qty !== undefined && isPending && (
                          <div className="text-[10px] text-muted">
                            Stock on hand: {item.current_stock_qty}
                          </div>
                        )}
                      </td>

                      {/* Distributor */}
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 text-xs text-text font-medium">
                          <Building2 size={13} className="text-muted shrink-0" />
                          <span className="truncate max-w-[160px]" title={item.distributor_display_name}>
                            {item.distributor_display_name || 'Unknown Distributor'}
                          </span>
                        </div>
                      </td>

                      {/* Proposed Claim Amount */}
                      <td className="p-3 text-right font-mono">
                        <div className="font-black text-xs text-emerald-500">
                          ₹{item.proposed_return_amount?.toFixed(2) || '0.00'}
                        </div>
                        <div className="text-[10px] text-muted">
                          @ ₹{item.cost_price?.toFixed(2) || '0.00'}/unit
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                            <Clock size={10} />
                            Pending Review
                          </span>
                        )}
                        {isApproved && (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                              <CheckCircle2 size={10} />
                              Approved
                            </span>
                            {item.return_no && (
                              <span className="text-[9px] font-mono font-bold text-primary mt-0.5">
                                {item.return_no}
                              </span>
                            )}
                          </div>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500/10 text-red-500 border border-red-500/30" title={item.notes || ''}>
                            <XCircle size={10} />
                            Rejected
                          </span>
                        )}
                      </td>

                      {/* Timeline */}
                      <td className="p-3 text-[10px] text-muted font-mono">
                        <div>Detected: {item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : '—'}</div>
                        {item.reviewed_at && (
                          <div className="text-text font-semibold">
                            Reviewed: {item.reviewed_at.substring(0, 16).replace('T', ' ')}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center">
                        {isPending ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => openApproveModal(item)}
                              disabled={actionInProgressId === item.id}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                              title="Approve return, enter deduction %, and deduct inventory"
                            >
                              {actionInProgressId === item.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => openRejectModal(item)}
                              disabled={actionInProgressId === item.id}
                              className="px-2.5 py-1 rounded-lg bg-bg3 hover:bg-red-500/10 text-muted hover:text-red-500 border border-border/60 hover:border-red-500/30 font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                              title="Reject proposed return"
                            >
                              <X size={12} />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : isApproved ? (
                          <span className="text-[11px] font-bold text-emerald-500 font-mono">
                            Deducted & Tracked
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted font-italic">
                            Stock Unchanged
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Single Item Approval Modal */}
      {approvingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg2 border border-border rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-sm font-black text-text flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" />
                Approve Expiry Return & Credit Note
              </h3>
              <button
                onClick={() => setApprovingItem(null)}
                className="text-muted hover:text-text cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Medicine & Batch Overview Card */}
            <div className="p-3 rounded-xl bg-bg3/40 border border-border/60 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-xs font-black text-text">{approvingItem.medicine_name}</h4>
                  <div className="text-[11px] text-muted font-mono mt-0.5">
                    Batch: <span className="font-bold text-text">{approvingItem.batch_no}</span> | Exp: {approvingItem.expiry_date}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono font-bold text-xs border border-primary/20">
                  Qty: {approvingItem.quantity}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs pt-1 border-t border-border/40">
                <span className="text-muted">Distributor:</span>
                <span className="font-bold text-text">{approvingItem.distributor_name || 'Direct / Supplier'}</span>
              </div>
            </div>

            {/* Loss / Commission Deduction Percentage Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-text">
                  Distributor Return Loss / Commission Deduction % <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] text-muted font-medium">Use 0% if full 100% refund</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0.0"
                  value={approveLossPercentage}
                  onChange={(e) => {
                    setApproveLossPercentage(e.target.value);
                    setApproveError('');
                  }}
                  className={`w-full px-3 py-2 text-sm bg-bg border rounded-xl font-mono text-text focus:outline-none focus:border-primary ${
                    approveError ? 'border-red-500 ring-1 ring-red-500/30' : 'border-border'
                  }`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-bold text-xs text-muted">%</span>
              </div>
              {approveError && (
                <p className="text-[11px] font-bold text-red-400 animate-in fade-in">{approveError}</p>
              )}
            </div>

            {/* Live Financial Calculation Breakdown */}
            {(() => {
              const totalVal = (approvingItem.cost_price || 0) * (approvingItem.quantity || 0);
              const lossNum = parseFloat(approveLossPercentage) || 0;
              const deductionVal = totalVal * (lossNum / 100);
              const expectedCredit = Math.max(0, totalVal - deductionVal);
              return (
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-muted">
                    <span>Total Purchase Cost:</span>
                    <span className="font-mono font-bold text-text">₹{totalVal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-muted">
                    <span>Deduction ({lossNum.toFixed(1)}%):</span>
                    <span className="font-mono font-bold text-amber-500">-₹{deductionVal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1.5 border-t border-emerald-500/20 font-bold">
                    <span className="text-text">Expected Credit Note Claim:</span>
                    <span className="font-mono text-emerald-500 text-sm">₹{expectedCredit.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-text">Approval Notes / Verification Remarks:</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="E.g. Physically verified against stock rack"
                className="w-full px-3 py-1.5 text-xs bg-bg border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button
                onClick={() => setApprovingItem(null)}
                className="px-4 py-1.5 rounded-xl bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApprove}
                disabled={actionInProgressId === approvingItem.id}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
              >
                {actionInProgressId === approvingItem.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirm Return & Deduct Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Approval Modal */}
      {showBulkApproveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg2 border border-border rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-sm font-black text-text flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" />
                Bulk Approve {selectedIds.size} Expiry Return(s)
              </h3>
              <button
                onClick={() => setShowBulkApproveModal(false)}
                className="text-muted hover:text-text cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted font-medium">
              You are approving <strong className="text-text">{selectedIds.size}</strong> expired batch(es). This will generate official supplier debit note transactions, deduct inventory quantities, and register credit notes.
            </p>

            {/* Loss % Input for Bulk */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-text">
                  Distributor Return Loss / Commission Deduction % <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] text-muted">0% to 100%</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0.0"
                  value={bulkLossPercentage}
                  onChange={(e) => {
                    setBulkLossPercentage(e.target.value);
                    setBulkError('');
                  }}
                  className={`w-full px-3 py-2 text-sm bg-bg border rounded-xl font-mono text-text focus:outline-none focus:border-primary ${
                    bulkError ? 'border-red-500 ring-1 ring-red-500/30' : 'border-border'
                  }`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-bold text-xs text-muted">%</span>
              </div>
              {bulkError && (
                <p className="text-[11px] font-bold text-red-400 animate-in fade-in">{bulkError}</p>
              )}
            </div>

            {/* Summary Preview */}
            {(() => {
              const selectedItems = reviews.filter(r => selectedIds.has(r.id));
              const totalGross = selectedItems.reduce((s, it) => s + ((it.cost_price || 0) * (it.quantity || 0)), 0);
              const lossNum = parseFloat(bulkLossPercentage) || 0;
              const totalDeduction = totalGross * (lossNum / 100);
              const totalExpected = Math.max(0, totalGross - totalDeduction);
              return (
                <div className="p-3 rounded-xl bg-bg3/40 border border-border/60 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-muted">
                    <span>Total Items Gross:</span>
                    <span className="font-mono font-bold text-text">₹{totalGross.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-muted">
                    <span>Agreed Deduction ({lossNum.toFixed(1)}%):</span>
                    <span className="font-mono font-bold text-amber-500">-₹{totalDeduction.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1.5 border-t border-border/40 font-bold">
                    <span className="text-text">Total Credit Claims:</span>
                    <span className="font-mono text-emerald-500 text-sm">₹{totalExpected.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button
                onClick={() => setShowBulkApproveModal(false)}
                className="px-4 py-1.5 rounded-xl bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBulkApprove}
                disabled={bulkApproving}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
              >
                {bulkApproving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm Bulk Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg2 border border-border rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-sm font-black text-text flex items-center gap-2">
                <XCircle size={18} className="text-red-500" />
                Reject Return Proposal
              </h3>
              <button
                onClick={() => setRejectingItem(null)}
                className="text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted font-medium">
              Reject return proposal for <strong className="text-text">{rejectingItem.medicine_name}</strong> (Batch: {rejectingItem.batch_no}). Inventory stock will remain unchanged.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-text">Rejection Reason / Notes (Optional):</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="E.g., Stock re-verified physically, pending manufacturer credit note, etc."
                rows={3}
                className="w-full p-2.5 text-xs bg-bg border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button
                onClick={() => setRejectingItem(null)}
                className="px-3.5 py-1.5 rounded-xl bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                disabled={actionInProgressId === rejectingItem.id}
                className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {actionInProgressId === rejectingItem.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg2 border border-border rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 shrink-0">
              <h3 className="text-sm font-black text-text flex items-center gap-2">
                <History size={18} className="text-indigo-400" />
                Expiry Return Review Audit Trail
              </h3>
              <button
                onClick={() => setShowAuditModal(false)}
                className="text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1 min-h-[300px]">
              {loadingAudit ? (
                <div className="py-12 text-center text-muted flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  <span>Loading audit trail...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-12 text-center text-muted/70 italic text-xs">
                  No expiry return audit entries recorded yet.
                </div>
              ) : (
                auditLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-bg3/40 border border-border/60 flex flex-col gap-1 text-xs"
                  >
                    <div className="flex justify-between items-center text-[11px] font-bold">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                        log.action_type === 'EXPIRY_RETURN_APPROVED'
                          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                          : log.action_type === 'EXPIRY_RETURN_REJECTED'
                          ? 'bg-red-500/10 text-red-500 border border-red-500/30'
                          : 'bg-amber-500/10 text-amber-500 border border-amber-500/30'
                      }`}>
                        {log.action_type}
                      </span>
                      <span className="font-mono text-muted text-[10px]">
                        {log.created_at ? log.created_at.substring(0, 19).replace('T', ' ') : ''}
                      </span>
                    </div>
                    <p className="text-text font-medium text-xs mt-0.5">{log.description}</p>
                    {log.metadata && (
                      <pre className="text-[10px] font-mono text-muted bg-bg p-1.5 rounded-lg overflow-x-auto">
                        {log.metadata}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border/60 shrink-0">
              <button
                onClick={() => setShowAuditModal(false)}
                className="px-4 py-1.5 rounded-xl bg-bg3 text-text hover:bg-bg3/80 text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ExpiryReturnReview;
