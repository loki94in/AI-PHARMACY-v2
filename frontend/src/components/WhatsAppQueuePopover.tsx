import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, 
  WifiOff, Edit3, Play, Pause, ShieldAlert, ChevronDown, ChevronUp, Zap, Truck, Building2, MessageSquare
} from 'lucide-react';
import { api, apiClient } from '../services/api';
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

interface WhatsAppQueuePopoverProps {
  onClose: () => void;
}

type TabType = 'all' | 'special' | 'distributor' | 'delivery' | 'pending' | 'sent' | 'failed';

export const WhatsAppQueuePopover: React.FC<WhatsAppQueuePopoverProps> = ({ onClose }) => {
  const [queueState, setQueueState] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  // Pacing Slider state
  const [pacingSec, setPacingSec] = useState<number>(10);

  // Delay Timers state
  const [delayCreditBill, setDelayCreditBill] = useState<number>(0);
  const [delayDistributor, setDelayDistributor] = useState<number>(0);
  const [delayDeliveryBoy, setDelayDeliveryBoy] = useState<number>(0);
  const [showDelayConfig, setShowDelayConfig] = useState(false);
  const [savingDelay, setSavingDelay] = useState(false);

  // Edit item modal state
  const [editingItem, setEditingItem] = useState<QueueItem | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.getWhatsAppQueueStatus();
      setQueueState(data);
      if (data && data.currentPacingMinMs) {
        setPacingSec(Math.round(data.currentPacingMinMs / 1000));
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp queue status:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDelaySettings = async () => {
    try {
      const { data } = await apiClient.get('/settings');
      if (data) {
        setDelayCreditBill(Number(data.whatsapp_delay_credit_bill) || 0);
        setDelayDistributor(Number(data.whatsapp_delay_distributor) || 0);
        setDelayDeliveryBoy(Number(data.whatsapp_delay_delivery_boy) || 0);
      }
    } catch (err) {
      console.warn('Failed to load WhatsApp delay settings:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchDelaySettings();
    const interval = setInterval(fetchStatus, 3000);
    const unsub = whatsappQueueEvent.subscribeUpdated(() => fetchStatus());
    return () => {
      clearInterval(interval);
      unsub();
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

  const handleSetPacingPreset = async (preset: 'fast' | 'safe') => {
    try {
      const res = await api.setWhatsAppQueuePacingPreset(preset);
      toastEvent.trigger(preset === 'fast' ? '⚡ Turbo Pacing enabled (3-5s)' : '🛡️ Safe Pacing enabled (8-12s)', 'success');
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

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const items: QueueItem[] = queueState?.recentItems || [];

  const isSpecialOrder = (t: string) => 
    t === 'special_order' || t === 'quick_order' || t === 'special_order_arrived' || t === 'quick_order_resend';
  const isDistributor = (t: string) => 
    t === 'distributor' || t === 'distributor_collection' || t === 'pharmarack_batch';
  const isDelivery = (t: string) => 
    t === 'delivery_boy' || t === 'delivery_boy_summary' || t === 'delivery_staff';

  const filteredItems = items.filter(item => {
    if (activeTab === 'special') return isSpecialOrder(item.type);
    if (activeTab === 'distributor') return isDistributor(item.type);
    if (activeTab === 'delivery') return isDelivery(item.type);
    if (activeTab === 'pending') return (item.status === 'pending' || item.status === 'sending') && !isDistributor(item.type);
    if (activeTab === 'sent') return item.status === 'sent' && !isDistributor(item.type);
    if (activeTab === 'failed') return (item.status === 'failed_offline' || item.status === 'failed_perm') && !isDistributor(item.type);
    return !isDistributor(item.type);
  });

  const counts = queueState?.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 };
  const pendingTotal = (counts.pending || 0) + (counts.sending || 0);
  const failedTotal = (counts.failed_offline || 0) + (counts.failed_perm || 0);

  const specialCount = items.filter(i => isSpecialOrder(i.type)).length;
  const distCount = items.filter(i => isDistributor(i.type)).length;
  const deliveryCount = items.filter(i => isDelivery(i.type)).length;

  const renderTypeBadge = (type: string) => {
    if (isSpecialOrder(type)) {
      return (
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/35 flex items-center gap-1 shrink-0 animate-pulse">
          <Zap size={9} className="text-purple-400 fill-purple-400" />
          <span>Special Order</span>
        </span>
      );
    }
    if (isDistributor(type)) {
      return (
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/35 flex items-center gap-1 shrink-0">
          <Building2 size={9} className="text-amber-400" />
          <span>Distributor</span>
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
                {pendingTotal > 0 ? `${pendingTotal} message(s) queued for paced dispatch` : 'All queued messages sent'}
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            
            {/* Status Pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky font-semibold">
                Pending: {pendingTotal}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold">
                Sent: {counts.sent || 0}
              </span>
              {failedTotal > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-semibold flex items-center gap-1">
                  <AlertTriangle size={12} /> Failed: {failedTotal}
                </span>
              )}
            </div>

            {/* Speed Pacing Toggle & Quick Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Pacing Preset Pills */}
              <div className="flex items-center bg-bg/60 p-0.5 rounded-xl border border-glass-border/40 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => handleSetPacingPreset('fast')}
                  className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                    queueState?.pacingPreset === 'fast' || queueState?.currentPacingMinMs === 3000
                      ? 'bg-amber-500 text-black font-extrabold shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                  title="Turbo Pacing: 3-5 seconds between messages for rapid sending"
                >
                  <Zap size={10} className="fill-current" />
                  <span>Turbo (3-5s)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPacingPreset('safe')}
                  className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                    queueState?.pacingPreset === 'safe' || (queueState?.currentPacingMinMs === 8000 && queueState?.pacingPreset !== 'fast')
                      ? 'bg-emerald-500 text-black font-extrabold shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                  title="Safe Pacing: 8-12 seconds anti-detection pacing"
                >
                  <span>Safe (8-12s)</span>
                </button>
              </div>

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
                <button
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <RefreshCw size={12} /> Retry Failed
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex border-b border-glass-border/30 px-4 bg-bg2/50 overflow-x-auto custom-scrollbar gap-2 shrink-0 items-center">
          <button
            onClick={() => setActiveTab('all')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'all' 
                ? 'border-sky text-sky' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            All Queue ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'pending' 
                ? 'border-sky text-sky' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Clock size={11} className="text-sky" />
            <span>Upcoming / Pending ({pendingTotal})</span>
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'sent' 
                ? 'border-emerald-400 text-emerald-400' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <CheckCircle2 size={11} className="text-emerald-400" />
            <span>Sent / Completed ({counts.sent || 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('special')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'special' 
                ? 'border-purple-400 text-purple-300' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Zap size={11} className="text-purple-400" />
            <span>Special Orders ({specialCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('distributor')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'distributor' 
                ? 'border-amber-400 text-amber-300' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Building2 size={11} className="text-amber-400" />
            <span>Distributors ({distCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('delivery')}
            className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'delivery' 
                ? 'border-cyan-400 text-cyan-300' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Truck size={11} className="text-cyan-400" />
            <span>Delivery Staff ({deliveryCount})</span>
          </button>
          {failedTotal > 0 && (
            <button
              onClick={() => setActiveTab('failed')}
              className={`py-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'failed' 
                  ? 'border-rose-500 text-rose-400' 
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              Failed ({failedTotal})
            </button>
          )}
        </div>

        {/* Streamlined One-Line Queue Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
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
            filteredItems.map(item => {
              const isExpanded = Boolean(expandedIds[item.id]);
              const displayName = item.target_name || (isDelivery(item.type) ? 'Delivery Staff' : isDistributor(item.type) ? 'Distributor Pickup' : 'Customer');

              return (
                <div 
                  key={item.id}
                  onMouseEnter={() => setExpandedIds(prev => ({ ...prev, [item.id]: true }))}
                  className={`rounded-xl border transition-all overflow-hidden cursor-pointer ${
                    item.status === 'sending'
                      ? 'bg-sky-500/10 border-sky-500/30 ring-1 ring-sky-500/20'
                      : item.status === 'sent'
                        ? 'bg-bg2/40 border-glass-border/30 opacity-80'
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
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 size={10} /> Sent
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
                        onClick={() => toggleExpand(item.id)}
                        className="p-1 hover:bg-bg3 text-muted hover:text-text rounded-md transition-colors"
                        title={isExpanded ? 'Hide message text' : 'View message text'}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Message Content Drawer */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-glass-border/20 bg-bg3/30 text-xs space-y-2 animate-fadeIn">
                      <p className="text-[11px] text-muted font-mono whitespace-pre-wrap leading-relaxed">
                        {item.message}
                      </p>

                      {item.error_message && (
                        <p className="text-[10px] text-rose-400 font-semibold">
                          ⚠️ Error: {item.error_message}
                        </p>
                      )}

                      {item.status.includes('failed') && (
                        <div className="pt-1 flex justify-end">
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
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
