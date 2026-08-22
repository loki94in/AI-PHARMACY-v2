import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, 
  WifiOff, Edit3, Play, Pause, ShieldAlert, ChevronDown, ChevronUp, Zap, Truck, Building2, MessageSquare, Calendar, Trash2, CheckCheck
} from 'lucide-react';
import { api, apiClient, peekWhatsAppQueueStatusCache } from '../services/api';
import { toastEvent, whatsappQueueEvent, messageSendEvent } from '../services/events';

interface QueueItem {
  id: number;
  number: string;
  message: string;
  type: string;
  status: 'pending' | 'sending' | 'sent' | 'failed_offline' | 'failed_perm';
  retry_count: number;
  created_at: number;
  sent_at: number | null;
  error_message?: string;
  target_name?: string;
}

function getFormattedFailureReason(errorMsg?: string, status?: string): string {
  if (!errorMsg && status === 'failed_offline') {
    return 'PC / Internet is offline or connection lost';
  }
  if (!errorMsg) {
    return 'Message delivery failed during queue dispatch attempt';
  }
  const msg = errorMsg.toLowerCase();
  if (msg.includes('invalid') || msg.includes('phone') || msg.includes('number')) {
    return 'Invalid recipient phone number format';
  }
  if (msg.includes('session') || msg.includes('auth') || msg.includes('token') || msg.includes('login')) {
    return 'WhatsApp Web session disconnected / login required';
  }
  if (msg.includes('timeout') || msg.includes('net::err') || msg.includes('econnrefused')) {
    return 'Network connection timeout';
  }
  if (msg.includes('not registered') || msg.includes('not on whatsapp')) {
    return 'Recipient phone number is not registered on WhatsApp';
  }
  return errorMsg;
}

interface WhatsAppQueuePopoverProps {
  onClose: () => void;
}

type TabType = 'all' | 'customer' | 'delivery' | 'purchase' | 'special' | 'pending' | 'sent' | 'failed';

// Module-level persistent cache for zero-latency instant rendering (<1ms)
let cachedQueueState: any | null = null;
let cachedDelayCreditBill = 0;
let cachedDelayDistributor = 0;
let cachedDelayDeliveryBoy = 0;

export const WhatsAppQueuePopover: React.FC<WhatsAppQueuePopoverProps> = ({ onClose }) => {
  const [queueState, setQueueState] = useState<any | null>(() => cachedQueueState);
  const [loading, setLoading] = useState(() => !cachedQueueState);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  // Pacing Slider state
  const [pacingSec, setPacingSec] = useState<number>(() => cachedQueueState?.currentPacingMinMs ? Math.round(cachedQueueState.currentPacingMinMs / 1000) : 10);

  // Delay Timers state
  const [delayCreditBill, setDelayCreditBill] = useState<number>(() => cachedDelayCreditBill);
  const [delayDistributor, setDelayDistributor] = useState<number>(() => cachedDelayDistributor);
  const [delayDeliveryBoy, setDelayDeliveryBoy] = useState<number>(() => cachedDelayDeliveryBoy);
  const [showDelayConfig, setShowDelayConfig] = useState(false);
  const [savingDelay, setSavingDelay] = useState(false);

  // Edit item modal state
  const [editingItem, setEditingItem] = useState<QueueItem | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchStatus = async () => {
    try {
      // Dedupe with Layout's active-queue poller: reuse its fresh result
      // instead of hitting the same endpoint again within ~2.5s.
      const cached = peekWhatsAppQueueStatusCache(2500);
      const data = cached ?? await api.getWhatsAppQueueStatus();
      cachedQueueState = data;
      setQueueState(data);
      if (data && data.currentPacingMinMs) {
        setPacingSec(Math.round(data.currentPacingMinMs / 1000));
      }
      if (data && data.delaySettings) {
        cachedDelayCreditBill = Number(data.delaySettings.whatsapp_delay_credit_bill) || 0;
        cachedDelayDistributor = Number(data.delaySettings.whatsapp_delay_distributor) || 0;
        cachedDelayDeliveryBoy = Number(data.delaySettings.whatsapp_delay_delivery_boy) || 0;
        setDelayCreditBill(cachedDelayCreditBill);
        setDelayDistributor(cachedDelayDistributor);
        setDelayDeliveryBoy(cachedDelayDeliveryBoy);
      }
      syncPollTimer(data);
    } catch (err) {
      console.error('Failed to fetch WhatsApp queue status:', err);
    } finally {
      setLoading(false);
    }
  };

  // P1 "events, not timers": poll ONLY while the queue is actively sending;
  // otherwise refresh via queue events + SSE push — no 2s polling of an idle queue.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncPollTimer = (data: any) => {
    const active = !!data && (
      (data.counts?.pending || 0) > 0 ||
      (data.counts?.sending || 0) > 0 ||
      data.isProcessing
    );
    if (active && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(fetchStatus, 2000);
    } else if (!active && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    fetchStatus();
    const unsub = whatsappQueueEvent.subscribeUpdated(() => fetchStatus());
    const handleSse = () => fetchStatus();
    window.addEventListener('sse-wa-queue-updated', handleSse);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      unsub();
      window.removeEventListener('sse-wa-queue-updated', handleSse);
    };
  }, []);

  const handleSaveDelayTimer = async (key: string, val: number) => {
    const updatedCredit = key === 'whatsapp_delay_credit_bill' ? val : delayCreditBill;
    const updatedDist = key === 'whatsapp_delay_distributor' ? val : delayDistributor;
    const updatedDeliv = key === 'whatsapp_delay_delivery_boy' ? val : delayDeliveryBoy;

    if (key === 'whatsapp_delay_credit_bill') setDelayCreditBill(val);
    if (key === 'whatsapp_delay_distributor') setDelayDistributor(val);
    if (key === 'whatsapp_delay_delivery_boy') setDelayDeliveryBoy(val);

    setSavingDelay(true);
    try {
      await apiClient.post('/settings/save', {
        whatsapp_delay_credit_bill: updatedCredit.toString(),
        whatsapp_delay_distributor: updatedDist.toString(),
        whatsapp_delay_delivery_boy: updatedDeliv.toString(),
      });
      toastEvent.trigger('WhatsApp message delay timer updated', 'success');
    } catch (err) {
      toastEvent.trigger('Failed to save delay setting', 'error');
    } finally {
      setSavingDelay(false);
    }
  };

  const [isFlushing, setIsFlushing] = useState(false);

  const handleFlushNow = async () => {
    if (isFlushing) return;
    setIsFlushing(true);
    try {
      messageSendEvent.triggerSendProgress('WhatsApp Queue Batch', 'Flushing pending queue messages...', 10);
      await api.flushWhatsAppQueue();
      toastEvent.trigger('Queue flush triggered', 'info');
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to flush queue', 'error');
    } finally {
      setTimeout(() => setIsFlushing(false), 2000);
    }
  };

  const [isFlushingNext, setIsFlushingNext] = useState(false);

  const handleFlushNext = async () => {
    if (isFlushingNext) return;
    setIsFlushingNext(true);
    try {
      const res = await api.flushNextWhatsAppQueueItem();
      if (res?.forced) {
        toastEvent.trigger('Dispatched next queue message immediately!', 'success');
      } else {
        toastEvent.trigger('No pending items in queue', 'info');
      }
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to dispatch next message', 'error');
    } finally {
      setTimeout(() => setIsFlushingNext(false), 1000);
    }
  };

  const handleSetPacingPreset = async (preset: 'turbo' | 'fast' | 'safe') => {
    try {
      const res = await api.setWhatsAppQueuePacingPreset(preset);
      const msg = preset === 'turbo' 
        ? '🚀 Ultra-Fast Turbo Pacing enabled (100ms speed)' 
        : preset === 'fast' 
          ? '⚡ Fast Pacing enabled (1-3s)' 
          : '🛡️ Safe Pacing enabled (8-12s)';
      toastEvent.trigger(msg, 'success');
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to update pacing preset', 'error');
    }
  };

  const handleTogglePause = async () => {
    try {
      await apiClient.post('/whatsapp/queue/toggle-pause');
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to toggle queue pause', 'error');
    }
  };

  const handleRetryFailed = async () => {
    try {
      const res = await api.retryFailedWhatsAppQueue();
      toastEvent.trigger(res.message || 'Reset failed items to pending', 'success');
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to retry messages', 'error');
    }
  };

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingFailed, setClearingFailed] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);

  const handleResendItem = async (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (resendingId === id) return;
    setResendingId(id);
    try {
      const res = await api.resendWhatsAppQueueItem(id);
      toastEvent.trigger(res.message || 'Message resent for immediate delivery', 'success');
      await fetchStatus();
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to resend message', 'error');
    } finally {
      setResendingId(null);
    }
  };

  const handleDeleteItem = async (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      setDeletingId(id);
      await api.deleteWhatsAppQueueItem(id);
      toastEvent.trigger('Notification removed permanently', 'success');
      await fetchStatus();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to remove notification', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllFailed = async () => {
    try {
      setClearingFailed(true);
      const res = await api.clearFailedWhatsAppQueue();
      toastEvent.trigger(res.message || 'Cleared failed notifications permanently', 'success');
      await fetchStatus();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to clear failed notifications', 'error');
    } finally {
      setClearingFailed(false);
    }
  };

  const handleSaveEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editPhone.trim()) return;
    setSavingEdit(true);
    try {
      await api.updateWhatsAppQueueItem({
        id: editingItem.id,
        number: editPhone.trim(),
        message: editMessage.trim() || undefined
      });
      toastEvent.trigger(`Updated item #${editingItem.id} and set to Pending`, 'success');
      setEditingItem(null);
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to update queue item', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const toggleDateExpand = (dateKey: string) => {
    setExpandedDates(prev => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const getDateKey = (timestampMs: number | string): string => {
    try {
      const d = new Date(typeof timestampMs === 'number' ? timestampMs : Number(timestampMs));
      if (isNaN(d.getTime())) return 'Older History';
      return d.toISOString().split('T')[0];
    } catch {
      return 'Older History';
    }
  };

  const formatDateHeader = (dateStr: string): string => {
    if (dateStr === 'Older History') return 'Older Message History';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return dateStr;
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (dateStr === todayStr) {
        return `Today (${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})`;
      }
      if (dateStr === yesterdayStr) {
        return `Yesterday (${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})`;
      }
      return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const items: QueueItem[] = queueState?.recentItems || [];

  const isSpecialOrder = (t: string) => 
    t === 'special_order' || t === 'quick_order' || t === 'special_order_arrived' || t === 'quick_order_resend';
  const isPurchase = (t: string) => 
    t === 'distributor' || t === 'distributor_collection' || t === 'pharmarack_batch' || t === 'purchase_order' || t === 'shortage_order';
  const isDelivery = (t: string) => 
    t === 'delivery_boy' || t === 'delivery_boy_summary' || t === 'delivery_staff' || t === 'dispatch';
  const isCustomer = (t: string) => 
    !isPurchase(t) && !isDelivery(t) && !isSpecialOrder(t);

  // If target_name is a raw numeric string (store ID leaked in), fall back gracefully
  const resolveDisplayName = (item: QueueItem): string => {
    const raw = item.target_name;
    if (isPurchase(item.type)) {
      // Numeric-only strings are store IDs, not user-friendly names
      if (!raw || /^\d+$/.test(raw.trim())) return 'Purchase / Distributor';
      return raw;
    }
    if (isDelivery(item.type)) return raw || 'Delivery Staff';
    if (isSpecialOrder(item.type)) return raw || 'Special Order';
    return raw || 'Customer';
  };

  // Helper to consolidate multiple same-day delivery boy summary dispatches into a single entry
  const consolidateDeliveryBoyItems = (rawItems: QueueItem[]): QueueItem[] => {
    const deliveryByDate: Record<string, QueueItem[]> = {};
    const result: QueueItem[] = [];

    for (const item of rawItems) {
      if (isDelivery(item.type)) {
        const dKey = getDateKey(item.created_at);
        deliveryByDate[dKey] = deliveryByDate[dKey] || [];
        deliveryByDate[dKey].push(item);
      } else {
        result.push(item);
      }
    }

    for (const dKey of Object.keys(deliveryByDate)) {
      const dItems = deliveryByDate[dKey];
      if (dItems.length <= 1) {
        result.push(...dItems);
      } else {
        const primary = dItems.find(i => i.type === 'delivery_boy_summary') || dItems[0];
        const distinctMsgs = Array.from(new Set(dItems.map(i => i.message.trim()).filter(Boolean)));
        const combinedMessage = distinctMsgs.length > 1 ? distinctMsgs.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n') : primary.message;
        const allSent = dItems.every(i => i.status === 'sent');
        const anyPending = dItems.some(i => i.status === 'pending' || i.status === 'sending');
        const anyFailed = dItems.some(i => i.status.includes('failed'));
        const aggregatedStatus = anyPending ? 'pending' : (anyFailed ? 'failed_perm' : (allSent ? 'sent' : primary.status));

        result.push({
          ...primary,
          message: combinedMessage,
          status: aggregatedStatus,
          target_name: `${primary.target_name || 'Delivery Staff'} (${dItems.length} dispatches consolidated)`
        });
      }
    }

    return result.sort((a, b) => b.created_at - a.created_at);
  };

  const filteredItems = items.filter(item => {
    // Search query check
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = item.target_name?.toLowerCase().includes(q);
      const matchNum = item.number?.includes(q);
      const matchMsg = item.message?.toLowerCase().includes(q);
      const matchType = item.type?.toLowerCase().includes(q);
      if (!matchName && !matchNum && !matchMsg && !matchType) return false;
    }

    if (activeTab === 'customer') return isCustomer(item.type);
    if (activeTab === 'delivery') return isDelivery(item.type);
    if (activeTab === 'purchase') return isPurchase(item.type);
    if (activeTab === 'special') return isSpecialOrder(item.type);
    if (activeTab === 'pending') return item.status === 'pending' || item.status === 'sending';
    if (activeTab === 'sent') return item.status === 'sent';
    if (activeTab === 'failed') return item.status === 'failed_offline' || item.status === 'failed_perm';
    return true; // 'all' shows everything
  });

  const preparedItems = consolidateDeliveryBoyItems(filteredItems);
  const todayStr = new Date().toISOString().split('T')[0];

  const todayItems = preparedItems.filter(i => getDateKey(i.created_at) === todayStr);
  const olderItems = preparedItems.filter(i => getDateKey(i.created_at) !== todayStr);

  const olderDateGroups: Record<string, QueueItem[]> = {};
  for (const item of olderItems) {
    const k = getDateKey(item.created_at);
    olderDateGroups[k] = olderDateGroups[k] || [];
    olderDateGroups[k].push(item);
  }
  const olderDates = Object.keys(olderDateGroups).sort((a, b) => b.localeCompare(a));

  // Compute Today-specific counts for tab pills and stats
  const todayRawItems = items.filter(i => getDateKey(i.created_at) === todayStr);
  const todayConsolidatedItems = consolidateDeliveryBoyItems(todayRawItems);

  const todayAllCount = todayConsolidatedItems.length;
  const todayCustomerCount = todayConsolidatedItems.filter(i => isCustomer(i.type)).length;
  const todayDeliveryCount = todayConsolidatedItems.filter(i => isDelivery(i.type)).length;
  const todayPurchaseCount = todayConsolidatedItems.filter(i => isPurchase(i.type)).length;
  const todaySpecialCount = todayConsolidatedItems.filter(i => isSpecialOrder(i.type)).length;
  const todayPendingCount = todayConsolidatedItems.filter(i => i.status === 'pending' || i.status === 'sending').length;
  const todaySentCount = todayConsolidatedItems.filter(i => i.status === 'sent').length;
  const todayFailedCount = todayConsolidatedItems.filter(i => i.status === 'failed_offline' || i.status === 'failed_perm').length;

  const counts = queueState?.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 };
  const pendingTotal = todayPendingCount > 0 ? todayPendingCount : ((counts.pending || 0) + (counts.sending || 0));
  const failedTotal = todayFailedCount > 0 ? todayFailedCount : ((counts.failed_offline || 0) + (counts.failed_perm || 0));
  const sentTotal = todaySentCount > 0 ? todaySentCount : (counts.sent || 0);

  const renderTypeBadge = (type: string) => {
    if (isSpecialOrder(type)) {
      return (
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/35 flex items-center gap-1 shrink-0 animate-pulse">
          <Zap size={9} className="text-purple-400 fill-purple-400" />
          <span>Special Order</span>
        </span>
      );
    }
    if (isPurchase(type)) {
      return (
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/35 flex items-center gap-1 shrink-0">
          <Building2 size={9} className="text-amber-400" />
          <span>Purchase / Distributor</span>
        </span>
      );
    }
    if (isDelivery(type)) {
      return (
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/35 flex items-center gap-1 shrink-0">
          <Truck size={9} className="text-cyan-400" />
          <span>Delivery Staff</span>
        </span>
      );
    }
    return (
      <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 flex items-center gap-1 shrink-0">
        <MessageSquare size={9} className="text-emerald-400" />
        <span>Customer</span>
      </span>
    );
  };

  const renderQueueItem = (item: QueueItem) => {
    const isExpanded = Boolean(expandedIds[item.id]);
    const displayName = resolveDisplayName(item);

    return (
      <div 
        key={item.id}
        onClick={() => toggleExpand(item.id)}
        className={`rounded-xl border transition-all overflow-hidden cursor-pointer ${
          item.status === 'sending'
            ? 'bg-sky-500/10 border-sky-500/30 ring-1 ring-sky-500/20'
            : item.status === 'sent'
              ? 'bg-bg2/40 border-glass-border/30 opacity-80 hover:opacity-100'
              : item.status.includes('failed')
                ? 'bg-rose-500/10 border-rose-500/30'
                : 'bg-bg2/70 border-glass-border hover:border-glass-border/80'
        }`}
      >
        {/* Streamlined Single Line Row */}
        <div className="p-2.5 flex items-center justify-between gap-3 text-xs">
          
          {/* Left: Type Badge & Name / Phone */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {renderTypeBadge(item.type)}

            <span className="font-bold text-text truncate max-w-[200px]" title={displayName}>
              {displayName}
            </span>

            <span className="text-[10px] font-mono text-muted bg-bg3/80 border border-glass-border/40 px-1.5 py-0.5 rounded shrink-0">
              +{item.number}
            </span>

            {item.retry_count > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono shrink-0">
                Retry #{item.retry_count}
              </span>
            )}

            {(item.status.includes('failed') || item.error_message) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1 shrink-0 max-w-[200px] truncate" title={item.error_message || 'Delivery failed'}>
                <ShieldAlert size={10} className="shrink-0 text-rose-400" />
                <span className="truncate">Reason: {getFormattedFailureReason(item.error_message, item.status)}</span>
              </span>
            )}
          </div>

          {/* Right: Status Pill & Quick Expand Trigger */}
          <div className="flex items-center gap-2 shrink-0">
            {item.status === 'sending' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky border border-sky-500/30 flex items-center gap-1 animate-pulse">
                <RefreshCw size={10} className="animate-spin" /> Sending
              </span>
            )}
            {item.status === 'pending' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <Clock size={10} /> Pending
              </span>
            )}
            {item.status === 'sent' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-mono">
                <CheckCircle2 size={10} /> 
                <span>Sent {item.sent_at ? `(${new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})` : ''}</span>
              </span>
            )}
            {item.status === 'failed_offline' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <WifiOff size={10} /> Waiting Net
              </span>
            )}
            {item.status === 'failed_perm' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                <ShieldAlert size={10} /> Failed
              </span>
            )}

            <button
              type="button"
              onClick={(e) => handleDeleteItem(item.id, e)}
              disabled={deletingId === item.id}
              className="p-1 hover:bg-rose-500/20 text-muted hover:text-rose-400 rounded-md transition-colors"
              title="Permanently remove / dismiss this notification"
            >
              {deletingId === item.id ? <RefreshCw size={13} className="animate-spin text-rose-400" /> : <Trash2 size={13} />}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              className="p-1 hover:bg-bg3 text-muted hover:text-text rounded-md transition-colors"
              title={isExpanded ? 'Hide message text' : 'View message text'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Expanded Message Content Drawer */}
        {isExpanded && (
          <div className="px-3 pb-3 pt-1 border-t border-glass-border/20 bg-bg3/30 text-xs space-y-2 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] text-muted font-mono whitespace-pre-wrap leading-relaxed">
              {item.message}
            </p>

            {(item.status.includes('failed') || item.error_message) && (
              <div className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1 my-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-400">
                  <ShieldAlert size={12} className="shrink-0" />
                  <span>Failure Cause: {getFormattedFailureReason(item.error_message, item.status)}</span>
                </div>
                {item.error_message && item.error_message !== getFormattedFailureReason(item.error_message, item.status) && (
                  <p className="text-[10px] font-mono text-rose-400/80">
                    Raw Output: {item.error_message}
                  </p>
                )}
                <p className="text-[10px] text-muted leading-tight">
                  💡 <strong>Fixing Tip:</strong> {item.error_message?.toLowerCase().includes('phone') ? 'Click Edit to update the phone number.' : 'Ensure internet is connected or click Retry Failed.'}
                </p>
              </div>
            )}

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={(e) => handleDeleteItem(item.id, e)}
                disabled={deletingId === item.id}
                className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-semibold text-[10px] rounded-lg transition-all flex items-center gap-1 border border-rose-500/20"
                title="Permanently remove notification"
              >
                <Trash2 size={11} /> Dismiss / Mark Read
              </button>

              {(item.status === 'sent' || item.status.includes('failed')) && (
                <button
                  type="button"
                  onClick={(e) => handleResendItem(item.id, e)}
                  disabled={resendingId === item.id}
                  className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold text-[10px] rounded-lg transition-all flex items-center gap-1 border border-emerald-500/25 disabled:opacity-50"
                  title="Send this message again immediately"
                >
                  {resendingId === item.id ? <RefreshCw size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                  {resendingId === item.id ? 'Resending...' : 'Resend'}
                </button>
              )}

              {item.status.includes('failed') && (
                <button
                  onClick={() => {
                    setEditingItem(item);
                    setEditPhone(item.number);
                    setEditMessage(item.message);
                  }}
                  className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky font-semibold text-[10px] rounded-lg transition-all flex items-center gap-1 border border-sky-500/20"
                >
                  <Edit3 size={11} /> Edit Phone & Resend
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md transition-all duration-300 animate-in fade-in">
      <div className="relative bg-bg3 border border-glass-border shadow-[0_25px_60px_rgba(0,0,0,0.6)] rounded-3xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-glass-border/30 flex items-center justify-between gap-3 bg-bg2/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`p-2 rounded-xl border shrink-0 ${
              !queueState?.isOnline 
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' 
                : pendingTotal > 0 
                  ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' 
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}>
              {!queueState?.isOnline ? <WifiOff size={18} /> : <Send size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm text-text shrink-0">
                  WhatsApp Live Queue Controller
                </h3>
                {!queueState?.isOnline ? (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full shrink-0 font-semibold">Offline / Reconnecting</span>
                ) : (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full shrink-0 font-semibold">Online</span>
                )}
              </div>
              <p className="text-[11px] text-muted truncate">
                {pendingTotal > 0
                  ? `${pendingTotal} message(s) queued for paced dispatch`
                  : failedTotal > 0
                    ? `${failedTotal} message(s) failed delivery — see details below or retry`
                    : (counts.sent || 0) > 0
                      ? `All ${counts.sent} queued message(s) delivered successfully`
                      : 'Queue is empty'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-bg2 rounded-lg text-muted hover:text-text transition-all shrink-0 cursor-pointer"
            title="Close Modal (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Status & Quick Actions Bar */}
        <div className="p-4 bg-bg2/40 border-b border-glass-border/30 space-y-3 shrink-0">
          {/* Live Progress Bar & Comprehensive Metric Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <div className="flex items-center gap-2">
                <span className="text-text">Queue Dispatch Progress:</span>
                <span className="text-sky font-mono">
                  {queueState?.counts?.total > 0 ? `${queueState.counts.sent} / ${queueState.counts.total}` : `${todaySentCount} / ${todayAllCount}`}
                </span>
              </div>
              <span className="text-sky font-mono font-extrabold text-sm">
                {queueState?.progressPercent !== undefined ? `${queueState.progressPercent}%` : `${todayAllCount > 0 ? Math.round((todaySentCount / todayAllCount) * 100) : 100}%`}
              </span>
            </div>

            {/* Progress Bar with smooth transition */}
            <div className="w-full bg-bg3/80 h-2 rounded-full overflow-hidden border border-glass-border/40 relative">
              <div 
                className="h-full bg-gradient-to-r from-sky-500 via-emerald-400 to-emerald-500 transition-all duration-500 rounded-full"
                style={{ 
                  width: `${queueState?.progressPercent !== undefined ? queueState.progressPercent : (todayAllCount > 0 ? (todaySentCount / todayAllCount) * 100 : 100)}%` 
                }}
              />
            </div>

            {/* Status Metric Chips */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
              <span className="px-2 py-0.5 rounded-lg bg-bg border border-glass-border font-bold text-text">
                Total: {queueState?.counts?.total || todayAllCount}
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold">
                ✓ Sent: {queueState?.counts?.sent || todaySentCount}
              </span>
              {(queueState?.counts?.sending || 0) > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky font-bold flex items-center gap-1 animate-pulse">
                  <RefreshCw size={10} className="animate-spin" /> Sending: {queueState.counts.sending}
                </span>
              )}
              {((queueState?.nextDispatchCountdownSeconds || 0) > 0 && queueState?.isProcessing) && (
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1">
                  <Clock size={10} /> Waiting Delay: {queueState.nextDispatchCountdownSeconds}s
                </span>
              )}
              {(queueState?.counts?.remaining || 0) > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky font-semibold">
                  Remaining: {queueState?.counts?.remaining}
                </span>
              )}
              {((queueState?.counts?.failed || 0) > 0 || todayFailedCount > 0) && (
                <span className="px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold flex items-center gap-1">
                  <AlertTriangle size={11} /> Failed: {queueState?.counts?.failed || todayFailedCount}
                </span>
              )}
            </div>
          </div>

          {/* Currently Sending / Next Message Hero Cards */}
          {(queueState?.currentItem || queueState?.nextItem || (queueState?.counts?.sending || 0) > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {/* Currently Active Card */}
              {queueState?.currentItem ? (
                <div className="p-2.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-1 text-xs animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-sky flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky animate-ping" /> Currently Sending
                    </span>
                    <span className="text-[10px] font-mono text-sky font-bold">+{queueState.currentItem.number}</span>
                  </div>
                  <div className="font-bold text-text truncate">
                    {resolveDisplayName(queueState.currentItem)}
                  </div>
                  <p className="text-[10px] font-mono text-muted line-clamp-1 truncate">
                    {queueState.currentItem.message}
                  </p>
                </div>
              ) : (
                <div className="p-2.5 rounded-2xl bg-bg2/40 border border-glass-border/40 space-y-1 text-xs opacity-75">
                  <span className="text-[10px] uppercase font-bold text-muted">Currently Active Send</span>
                  <div className="text-xs text-muted font-semibold">Idle / Ready for next</div>
                </div>
              )}

              {/* Next Waiting / Countdown Card */}
              {queueState?.nextItem ? (
                <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-1 text-xs animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-amber-300 flex items-center gap-1">
                      <Clock size={11} /> Next in Queue
                    </span>
                    {queueState?.nextDispatchCountdownSeconds > 0 ? (
                      <span className="text-[10px] font-mono font-extrabold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/30 animate-pulse">
                        Wait: {queueState.nextDispatchCountdownSeconds}s
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-muted">Ready</span>
                    )}
                  </div>
                  <div className="font-bold text-text truncate">
                    {resolveDisplayName(queueState.nextItem)}
                  </div>
                  <p className="text-[10px] font-mono text-muted line-clamp-1 truncate">
                    +{queueState.nextItem.number} • {queueState.nextItem.message}
                  </p>
                </div>
              ) : (
                <div className="p-2.5 rounded-2xl bg-bg2/40 border border-glass-border/40 space-y-1 text-xs opacity-75">
                  <span className="text-[10px] uppercase font-bold text-muted">Next in Queue</span>
                  <div className="text-xs text-muted font-semibold">No more pending items</div>
                </div>
              )}
            </div>
          )}

          {/* Completed State Banner */}
          {queueState?.isCompleted && (queueState?.counts?.sent || todaySentCount) > 0 && (
            <div className="p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300 animate-fadeIn">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                <div>
                  <span className="font-bold">BULK DISPATCH COMPLETED:</span> All {queueState?.counts?.sent || todaySentCount} queued messages delivered successfully.
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">100% COMPLETE</span>
            </div>
          )}

          {/* Quick Actions & Speed Pacing Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
            {/* Pacing Preset Pills */}
            <div className="flex items-center bg-bg/60 p-0.5 rounded-xl border border-glass-border/40 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => handleSetPacingPreset('turbo')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                  queueState?.pacingPreset === 'turbo' || queueState?.currentPacingMinMs === 100
                    ? 'bg-rose-500 text-white font-extrabold shadow-sm animate-pulse'
                    : 'text-muted hover:text-text'
                }`}
                title="Ultra-Fast Speed: 100ms (0.1s) instant queue dispatch"
              >
                <Zap size={10} className="fill-current text-amber-300" />
                <span>Turbo (100ms)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetPacingPreset('fast')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                  queueState?.pacingPreset === 'fast' || queueState?.currentPacingMinMs === 1000
                    ? 'bg-amber-500 text-black font-extrabold shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
                title="Fast Pacing: 1-3 seconds between messages"
              >
                <span>Fast (1-3s)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetPacingPreset('safe')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                  queueState?.pacingPreset === 'safe' || (queueState?.currentPacingMinMs === 10000 && queueState?.pacingPreset !== 'fast' && queueState?.pacingPreset !== 'turbo')
                    ? 'bg-emerald-500 text-black font-extrabold shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
                title="Safe Pacing: 10-12 seconds (default 11s) anti-detection spacing"
              >
                <span>Safe (10-12s)</span>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleTogglePause}
                className={`px-2.5 py-1.5 font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
                  queueState?.isPaused
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-white/10 hover:bg-white/20 text-text border border-glass-border'
                }`}
                title={queueState?.isPaused ? 'Resume WhatsApp Queue' : 'Pause WhatsApp Queue'}
              >
                {queueState?.isPaused ? <Play size={12} className="fill-current" /> : <Pause size={12} className="fill-current" />}
                <span>{queueState?.isPaused ? 'Resume' : 'Pause'}</span>
              </button>

              <button
                onClick={handleFlushNext}
                disabled={pendingTotal === 0 || isFlushingNext}
                className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 disabled:opacity-40 font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                title="Send the very next pending message immediately without waiting for delay countdown"
              >
                <Zap size={12} className="text-amber-400 fill-amber-400" />
                <span>{isFlushingNext ? 'Sending...' : 'Send Next Now'}</span>
              </button>

              <button
                onClick={handleFlushNow}
                disabled={pendingTotal === 0 || isFlushing}
                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                title="Flush and process all pending queue messages"
              >
                <Play size={12} /> Flush All
              </button>

              {failedTotal > 0 && (
                <>
                  <button
                    onClick={handleRetryFailed}
                    className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                    title="Retry all failed messages"
                  >
                    <RefreshCw size={12} /> Retry Failed
                  </button>
                  <button
                    onClick={handleClearAllFailed}
                    disabled={clearingFailed}
                    className="px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                    title="Permanently remove / dismiss all failed notifications"
                  >
                    <Trash2 size={12} /> {clearingFailed ? 'Clearing...' : 'Clear Failed'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="p-3 bg-bg2/60 border-b border-glass-border/30 flex flex-col gap-2 shrink-0">
          <div className="relative flex items-center w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved WhatsApp notifications by phone, recipient, or text..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl bg-bg border border-glass-border text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-400/50"
            />
            <MessageSquare size={13} className="absolute left-3 text-muted" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-muted hover:text-text cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex border-b border-glass-border/30 overflow-x-auto custom-scrollbar gap-1.5 shrink-0 items-center pb-1">
            <button
              onClick={() => setActiveTab('all')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'all' 
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              💬 Today's All ({todayAllCount})
            </button>
            <button
              onClick={() => setActiveTab('customer')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'customer' 
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <MessageSquare size={11} className="text-emerald-400" />
              <span>Customer ({todayCustomerCount})</span>
            </button>
            <button
              onClick={() => setActiveTab('delivery')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'delivery' 
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <Truck size={11} className="text-cyan-400" />
              <span>Delivery ({todayDeliveryCount})</span>
            </button>
            <button
              onClick={() => setActiveTab('purchase')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'purchase' 
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <Building2 size={11} className="text-amber-400" />
              <span>Purchase ({todayPurchaseCount})</span>
            </button>
            <button
              onClick={() => setActiveTab('special')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'special' 
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <Zap size={11} className="text-purple-400" />
              <span>Special Orders ({todaySpecialCount})</span>
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'pending' 
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <Clock size={11} className="text-sky-400" />
              <span>Pending ({todayPendingCount})</span>
            </button>
            <button
              onClick={() => setActiveTab('sent')}
              className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'sent' 
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' 
                  : 'bg-bg text-muted hover:text-text border border-glass-border'
              }`}
            >
              <CheckCircle2 size={11} className="text-emerald-400" />
              <span>Sent ({todaySentCount})</span>
            </button>
            {failedTotal > 0 && (
              <button
                onClick={() => setActiveTab('failed')}
                className={`py-1.5 px-3 text-xs font-bold rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'failed' 
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/35' 
                    : 'bg-bg text-muted hover:text-text border border-glass-border'
                }`}
              >
                Failed ({todayFailedCount > 0 ? todayFailedCount : failedTotal})
              </button>
            )}
          </div>
        </div>

        {/* Date-Grouped Queue Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center text-xs text-muted flex items-center justify-center gap-2">
              <RefreshCw className="animate-spin text-sky" size={16} /> Fetching queue details...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted flex flex-col items-center gap-2">
              <CheckCircle2 size={24} className="text-emerald-400/40" />
              No items match this queue category filter.
            </div>
          ) : (
            <>
              {/* ── 1. TODAY'S LIVE QUEUE SECTION (ALWAYS VISIBLE & EXPANDED) ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-1 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <h4 className="text-xs font-bold text-text uppercase tracking-wider">
                      Today's Live Queue ({todayItems.length})
                    </h4>
                  </div>
                  <span className="text-[10px] text-muted font-mono">
                    {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>

                {todayItems.length === 0 ? (
                  <div className="py-5 px-4 text-center text-xs text-muted bg-bg2/30 border border-glass-border/30 rounded-2xl flex flex-col items-center justify-center gap-1.5">
                    <Clock size={16} className="text-muted/60" />
                    <span>No WhatsApp messages queued or sent yet today.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayItems.map(item => renderQueueItem(item))}
                  </div>
                )}
              </div>

              {/* ── 2. OLDER MESSAGE HISTORY SECTION (COMPRESSED BY DATE) ── */}
              {olderDates.length > 0 && (
                <div className="pt-3 border-t border-glass-border/40 space-y-2.5">
                  <div className="flex items-center justify-between pb-1 px-1">
                    <div className="flex items-center gap-2">
                      <Calendar size={13} className="text-muted" />
                      <h4 className="text-xs font-bold text-muted uppercase tracking-wider">
                        Older Message History ({olderItems.length})
                      </h4>
                    </div>
                    <span className="text-[10px] text-muted font-mono">
                      {olderDates.length} Past Date{olderDates.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {olderDates.map(dateKey => {
                    const dateItems = olderDateGroups[dateKey] || [];
                    const isDateExpanded = Boolean(expandedDates[dateKey]);
                    const dateSent = dateItems.filter(i => i.status === 'sent').length;
                    const dateFailed = dateItems.filter(i => i.status.includes('failed')).length;
                    const datePending = dateItems.filter(i => i.status === 'pending' || i.status === 'sending').length;

                    return (
                      <div 
                        key={dateKey} 
                        className="rounded-2xl border border-glass-border/40 bg-bg2/40 overflow-hidden transition-all hover:border-glass-border/80"
                      >
                        {/* Collapsible Date Header Card */}
                        <button
                          type="button"
                          onClick={() => toggleDateExpand(dateKey)}
                          className="w-full p-3 flex items-center justify-between gap-3 text-xs hover:bg-bg2/80 transition-colors cursor-pointer text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-1.5 rounded-lg bg-bg3/80 border border-glass-border/40 text-muted shrink-0">
                              <Calendar size={13} className="text-sky" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-text truncate text-xs">
                                {formatDateHeader(dateKey)}
                              </div>
                              <div className="text-[10px] text-muted font-mono">
                                {dateKey}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-glass-border">
                              {dateItems.length} msg{dateItems.length > 1 ? 's' : ''}
                            </span>
                            {dateSent > 0 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                                ✓ {dateSent} Sent
                              </span>
                            )}
                            {dateFailed > 0 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/25">
                                ⚠ {dateFailed} Failed
                              </span>
                            )}
                            {datePending > 0 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
                                ⏳ {datePending} Pending
                              </span>
                            )}
                            <div className="p-1 text-muted hover:text-text rounded-md">
                              {isDateExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </div>
                        </button>

                        {/* Expanded Date Items Sub-List */}
                        {isDateExpanded && (
                          <div className="p-3 pt-2 border-t border-glass-border/30 space-y-2 bg-bg/50 animate-fadeIn">
                            {dateItems.map(item => renderQueueItem(item))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Edit Phone Item Modal Overlay */}
        {editingItem && (
          <div className="fixed inset-0 z-submodal bg-black/60 flex items-center justify-center p-4">
            <form onSubmit={handleSaveEditItem} className="bg-bg border border-glass-border/40 p-4 rounded-2xl max-w-md w-full space-y-3 shadow-2xl">
              <h4 className="text-xs font-bold text-text">Edit Phone & Resend Item #{editingItem.id}</h4>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase">Phone Number</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="e.g. 919876543210"
                  className="w-full bg-bg3/60 border border-glass-border rounded-xl px-3 py-1.5 text-xs text-text focus:outline-none focus:border-sky font-mono mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase">Message Preview</label>
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  rows={4}
                  className="w-full bg-bg3/60 border border-glass-border rounded-xl px-3 py-1.5 text-xs text-text focus:outline-none focus:border-sky font-mono mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-3 py-1.5 text-xs text-muted hover:text-text rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs rounded-xl transition-all"
                >
                  {savingEdit ? 'Saving...' : 'Save & Resend'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
