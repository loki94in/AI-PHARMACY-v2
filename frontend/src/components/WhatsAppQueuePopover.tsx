import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { 
  X, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, 
  Wifi, WifiOff, Edit3, Play, Sliders, ShieldAlert, Settings, ChevronDown, ChevronUp 
} from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent } from '../services/events';

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

export const WhatsAppQueuePopover: React.FC<WhatsAppQueuePopoverProps> = ({ onClose }) => {
  const [queueState, setQueueState] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'failed'>('all');

  // Pacing Slider state
  const [pacingSec, setPacingSec] = useState<number>(10);
  const [savingPacing, setSavingPacing] = useState(false);

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
    return () => clearInterval(interval);
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

  const handleFlushNow = async () => {
    try {
      await api.flushWhatsAppQueue();
      toastEvent.trigger('Queue flush triggered', 'info');
      await fetchStatus();
    } catch (err) {
      toastEvent.trigger('Failed to flush queue', 'error');
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

  const handlePacingChange = async (newSec: number) => {
    setPacingSec(newSec);
    setSavingPacing(true);
    try {
      await api.updateWhatsAppPacingConfig(newSec, newSec + 4);
      toastEvent.trigger(`Message pacing set to ${newSec}s - ${newSec + 4}s`, 'success');
    } catch (err) {
      toastEvent.trigger('Failed to update pacing', 'error');
    } finally {
      setSavingPacing(false);
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

  const items: QueueItem[] = queueState?.recentItems || [];
  const filteredItems = items.filter(item => {
    if (activeTab === 'pending') return item.status === 'pending' || item.status === 'sending';
    if (activeTab === 'failed') return item.status === 'failed_offline' || item.status === 'failed_perm';
    return true;
  });

  const counts = queueState?.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 };
  const pendingTotal = (counts.pending || 0) + (counts.sending || 0);
  const failedTotal = (counts.failed_offline || 0) + (counts.failed_perm || 0);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-bg border border-glass-border/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scaleIn">
        
        {/* Header */}
        <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl border ${
              !queueState?.isOnline 
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' 
                : pendingTotal > 0 
                  ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' 
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}>
              {!queueState?.isOnline ? <WifiOff size={18} /> : <Send size={18} />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                WhatsApp Live Queue Controller
                {!queueState?.isOnline ? (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">Offline / Reconnecting</span>
                ) : (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">Online</span>
                )}
              </h3>
              <p className="text-[11px] text-muted">
                {pendingTotal > 0 ? `${pendingTotal} message(s) queued for paced dispatch` : 'All queued messages sent'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-bg3 rounded-lg text-muted hover:text-text transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Status & Pacing Bar */}
        <div className="p-4 bg-bg3/30 border-b border-glass-border/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            
            {/* Status Pills */}
            <div className="flex items-center gap-2">
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

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleFlushNow}
                disabled={pendingTotal === 0}
                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Play size={12} /> Flush Now
              </button>
              {failedTotal > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <RefreshCw size={12} /> Retry Failed
                </button>
              )}
            </div>
          </div>

          {/* Pacing Control & Countdown Bar */}
          <div className="pt-2 border-t border-glass-border/20 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Sliders size={14} className="text-sky" />
              <span className="font-semibold text-text">Pacing Interval:</span>
              <input
                type="range"
                min="5"
                max="30"
                value={pacingSec}
                onChange={(e) => handlePacingChange(Number(e.target.value))}
                className="w-24 accent-sky-500 cursor-pointer"
              />
              <span className="font-mono text-sky font-bold">{pacingSec}s - {pacingSec + 4}s</span>
              {savingPacing && <span className="text-[10px] text-muted animate-pulse">(saving...)</span>}
            </div>

            {queueState?.nextDispatchCountdownMs > 0 && (
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-sky animate-pulse">
                <Clock size={13} />
                <span>Next send in: {queueState.nextDispatchCountdownMs}s</span>
              </div>
            )}
          </div>

          {/* Scheduled Message Delay Timers Quick Config */}
          <div className="pt-2 border-t border-glass-border/20">
            <button
              type="button"
              onClick={() => setShowDelayConfig(prev => !prev)}
              className="w-full flex items-center justify-between py-1 text-xs font-bold text-text hover:text-sky transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-emerald-400" />
                <span>Message Delay Timers (Credit Bills, Distributors, Delivery Staff)</span>
                {savingDelay && <span className="text-[10px] text-muted font-normal animate-pulse">(saving...)</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-normal text-muted">
                  Credit: {delayCreditBill === 0 ? '0m' : `${delayCreditBill}m`} | Dist: {delayDistributor === 0 ? '0m' : `${delayDistributor}m`} | Staff: {delayDeliveryBoy === 0 ? '0m' : `${delayDeliveryBoy}m`}
                </span>
                {showDelayConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>

            {showDelayConfig && (
              <div className="mt-2.5 p-3 rounded-xl bg-bg2/60 border border-glass-border space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between text-[11px] font-semibold text-text border-b border-glass-border/30 pb-1.5">
                  <span>Configure Post-Save Send Delays</span>
                  <Link
                    to="/settings"
                    onClick={onClose}
                    className="flex items-center gap-1 text-[10px] font-bold text-sky hover:text-sky-300 transition-colors"
                  >
                    <Settings size={11} /> Open Settings Page
                  </Link>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  {/* Credit Bills */}
                  <div className="space-y-1 bg-bg p-2 rounded-lg border border-glass-border/50">
                    <label className="text-[10px] font-bold text-muted uppercase block">Credit Bills</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={delayCreditBill}
                        onChange={(e) => handleSaveDelayTimer('whatsapp_delay_credit_bill', Math.max(0, Number(e.target.value)))}
                        className="w-full bg-bg2 text-text border border-glass-border rounded px-1.5 py-0.5 text-xs font-mono"
                      />
                      <span className="text-[10px] text-muted font-medium">m</span>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {[0, 5, 15, 60].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleSaveDelayTimer('whatsapp_delay_credit_bill', m)}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${
                            delayCreditBill === m ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold' : 'bg-bg2 border-glass-border text-muted hover:text-text'
                          }`}
                        >
                          {m === 0 ? '0m' : m >= 60 ? `${m/60}h` : `${m}m`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Distributors */}
                  <div className="space-y-1 bg-bg p-2 rounded-lg border border-glass-border/50">
                    <label className="text-[10px] font-bold text-muted uppercase block">Distributors</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={delayDistributor}
                        onChange={(e) => handleSaveDelayTimer('whatsapp_delay_distributor', Math.max(0, Number(e.target.value)))}
                        className="w-full bg-bg2 text-text border border-glass-border rounded px-1.5 py-0.5 text-xs font-mono"
                      />
                      <span className="text-[10px] text-muted font-medium">m</span>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {[0, 5, 15, 60].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleSaveDelayTimer('whatsapp_delay_distributor', m)}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${
                            delayDistributor === m ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold' : 'bg-bg2 border-glass-border text-muted hover:text-text'
                          }`}
                        >
                          {m === 0 ? '0m' : m >= 60 ? `${m/60}h` : `${m}m`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Delivery Staff */}
                  <div className="space-y-1 bg-bg p-2 rounded-lg border border-glass-border/50">
                    <label className="text-[10px] font-bold text-muted uppercase block">Delivery Staff</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={delayDeliveryBoy}
                        onChange={(e) => handleSaveDelayTimer('whatsapp_delay_delivery_boy', Math.max(0, Number(e.target.value)))}
                        className="w-full bg-bg2 text-text border border-glass-border rounded px-1.5 py-0.5 text-xs font-mono"
                      />
                      <span className="text-[10px] text-muted font-medium">m</span>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {[0, 5, 15, 60].map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleSaveDelayTimer('whatsapp_delay_delivery_boy', m)}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${
                            delayDeliveryBoy === m ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold' : 'bg-bg2 border-glass-border text-muted hover:text-text'
                          }`}
                        >
                          {m === 0 ? '0m' : m >= 60 ? `${m/60}h` : `${m}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex border-b border-glass-border/30 px-4 bg-bg2/30">
          <button
            onClick={() => setActiveTab('all')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'all' 
                ? 'border-sky text-sky' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            All Queue ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'pending' 
                ? 'border-sky text-sky' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            Pending / Sending ({pendingTotal})
          </button>
          <button
            onClick={() => setActiveTab('failed')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'failed' 
                ? 'border-rose-500 text-rose-400' 
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            Failed ({failedTotal})
          </button>
        </div>

        {/* Queue Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center text-xs text-muted flex items-center justify-center gap-2">
              <RefreshCw className="animate-spin text-sky" size={16} /> Fetching queue details...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted flex flex-col items-center gap-2">
              <CheckCircle2 size={24} className="text-emerald-400/40" />
              No items in this queue filter.
            </div>
          ) : (
            filteredItems.map(item => (
              <div 
                key={item.id}
                className={`p-3 rounded-xl border transition-all ${
                  item.status === 'sending'
                    ? 'bg-sky-500/10 border-sky-500/30'
                    : item.status === 'sent'
                      ? 'bg-bg2/40 border-glass-border/30 opacity-75'
                      : item.status.includes('failed')
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : 'bg-bg2/60 border-glass-border'
                }`}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs font-mono text-text">+{item.number}</span>
                    {item.target_name && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {item.target_name}
                      </span>
                    )}
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-black tracking-wider bg-sky-500/20 text-sky border border-sky-500/30">
                      {item.type || 'Collection'}
                    </span>
                    {item.retry_count > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                        Retry #{item.retry_count}
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div>
                    {item.status === 'sending' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky border border-sky-500/30 flex items-center gap-1 animate-pulse">
                        <RefreshCw size={10} className="animate-spin" /> Sending...
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Pending
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
                  </div>
                </div>

                <p className="text-[11px] text-muted line-clamp-2 font-mono whitespace-pre-wrap">
                  {item.message}
                </p>

                {item.error_message && (
                  <p className="text-[10px] text-rose-400 font-semibold mt-1">
                    ⚠️ Error: {item.error_message}
                  </p>
                )}

                {/* Edit Phone / Resend Action for failed items */}
                {item.status.includes('failed') && (
                  <div className="mt-2 pt-2 border-t border-glass-border/20 flex justify-end">
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
            ))
          )}
        </div>

        {/* Edit Phone Item Modal Overlay */}
        {editingItem && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
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
