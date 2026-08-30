import { useEffect, useState, useRef } from 'react';
import { X, MessageSquareText, CheckCircle2, XCircle, Clock, ExternalLink, Send, Check, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { getFormattedFailureReason } from '../utils/whatsappFailureReason';
import { whatsappQueueEvent, automationHubEvent, messageSendEvent } from '../services/events';
import type { AutomationHubActivityItem } from '../types/api';
import { useModalEscape } from '../services/keyboardShortcuts';

interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface AutomationHubPopoverProps {
  onClose: () => void;
}

export default function AutomationHubPopover({ onClose }: AutomationHubPopoverProps) {
  useModalEscape(true, onClose);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [activity, setActivity] = useState<AutomationHubActivityItem[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Live in-flight animation state for currently sending WhatsApp message
  const [activeSending, setActiveSending] = useState<{
    id?: string;
    recipient: string;
    progress: number;
    secondsLeft: number;
    completed: boolean;
    type?: string;
  } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = async () => {
    try {
      const [catalogRes, summaryRes] = await Promise.all([
        api.getAutomationCatalog(),
        api.getAutomationHubSummary(),
      ]);
      setCatalog(catalogRes);
      setActivity(summaryRes.activity);
      setUnresolvedCount(summaryRes.unresolvedFailuresCount || 0);

      // If backend reports an active sending item and no local timer is running, start 10s countdown
      if (summaryRes.activeSendingItem && !activeSending) {
        startSendAnimation(summaryRes.activeSendingItem.targetName, summaryRes.activeSendingItem.type, 10);
      }
    } catch (err) {
      console.error('Failed to load automation hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  const startSendAnimation = (recipient: string, type?: string, durationSec = 10) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const totalSteps = durationSec * 10;
    let currentStep = 0;

    setActiveSending({
      recipient,
      progress: 0,
      secondsLeft: durationSec,
      completed: false,
      type
    });

    timerRef.current = setInterval(() => {
      currentStep++;
      const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
      const secsLeft = Math.max(0, Math.ceil(durationSec - (currentStep / 10)));

      if (currentStep >= totalSteps) {
        if (timerRef.current) clearInterval(timerRef.current);
        setActiveSending(prev => prev ? { ...prev, progress: 100, secondsLeft: 0, completed: true } : null);
        setTimeout(() => {
          setActiveSending(null);
          loadData();
        }, 2000);
      } else {
        setActiveSending(prev => prev ? { ...prev, progress: percent, secondsLeft: secsLeft } : null);
      }
    }, 100);
  };

  useEffect(() => {
    loadData();
    const unsubscribeHub = automationHubEvent.subscribeUpdated(() => loadData());
    const unsubscribeQueue = whatsappQueueEvent.subscribeUpdated(() => loadData());
    const unsubscribeSend = messageSendEvent.subscribeSendProgress((detail) => {
      startSendAnimation(detail.recipient, detail.messagePreview, detail.durationSec || 10);
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      unsubscribeHub();
      unsubscribeQueue();
      unsubscribeSend();
    };
  }, []);

  const handleToggle = async (entry: CatalogEntry) => {
    setTogglingId(entry.id);
    const nextEnabled = !entry.enabled;
    setCatalog(prev => prev.map(e => (e.id === entry.id ? { ...e, enabled: nextEnabled } : e)));
    try {
      await api.setAutomationToggle(entry.id, nextEnabled);
    } catch (err) {
      console.error('Failed to toggle automation:', err);
      setCatalog(prev => prev.map(e => (e.id === entry.id ? { ...e, enabled: entry.enabled } : e)));
    } finally {
      setTogglingId(null);
    }
  };

  const handleResolve = async (item: AutomationHubActivityItem) => {
    const itemKey = item.id || String(item.rawId);
    setResolvingId(itemKey);
    try {
      await api.resolveAutomationFailure({
        id: item.id,
        rawId: item.rawId,
        source: item.source
      });
      setActivity(prev => prev.map(a => (a.id === item.id || (item.rawId && a.rawId === item.rawId)) ? { ...a, acknowledged: 1 } : a));
      setUnresolvedCount(prev => Math.max(0, prev - 1));
      automationHubEvent.triggerUpdated();
    } catch (err) {
      console.error('Failed to resolve failure:', err);
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolveAll = async () => {
    setResolvingId('all');
    try {
      await api.resolveAutomationFailure({ resolveAll: true });
      setActivity(prev => prev.map(a => ({ ...a, acknowledged: 1 })));
      setUnresolvedCount(0);
      automationHubEvent.triggerUpdated();
    } catch (err) {
      console.error('Failed to resolve all failures:', err);
    } finally {
      setResolvingId(null);
    }
  };

  const statusPill = (status: string) => {
    if (status === 'sent') {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
          <CheckCircle2 size={10} /> Sent
        </span>
      );
    }
    if (status.startsWith('failed')) {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
          <XCircle size={10} /> Failed
        </span>
      );
    }
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
        <Clock size={10} /> Pending
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-end p-4 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-glass-bg backdrop-blur-xl border border-glass-border rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-glass-border sticky top-0 bg-glass-bg backdrop-blur-xl z-10">
          <div className="flex items-center gap-2">
            <MessageSquareText size={18} className="text-sky-400" />
            <h2 className="text-sm font-bold text-text">WhatsApp Automation Hub</h2>
            {unresolvedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                {unresolvedCount} Failed
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {unresolvedCount > 0 && (
              <button
                onClick={handleResolveAll}
                disabled={resolvingId === 'all'}
                className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-colors"
                title="Mark all failed messages as acknowledged"
              >
                Resolve All
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg3/60 text-muted hover:text-text" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Live Active Sending Card (0-100% Progress + 10-0s Countdown Animation) */}
        {activeSending && (
          <div className="m-4 mb-2 p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 shadow-md space-y-2 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Send size={14} className={`text-sky-400 ${activeSending.completed ? '' : 'animate-bounce'}`} />
                <span className="text-xs font-bold text-text truncate">
                  {activeSending.completed ? `✓ Sent to ${activeSending.recipient}` : `Sending WhatsApp to ${activeSending.recipient}`}
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 shrink-0">
                {activeSending.completed ? '100% Complete' : `${activeSending.progress}% (${activeSending.secondsLeft}s left)`}
              </span>
            </div>

            <div className="w-full h-1.5 bg-bg border border-glass-border/40 rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full rounded-full transition-all duration-150 relative bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400"
                style={{ width: `${Math.min(100, Math.max(0, activeSending.progress))}%` }}
              >
                <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/80 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
              </div>
            </div>

            {activeSending.type && (
              <div className="text-[10px] text-muted truncate">
                Type: {activeSending.type}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-center text-xs text-muted">Loading automation details...</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Catalog Toggle List */}
            <div className="p-4 space-y-2">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Automations Config</h3>
              {catalog.map(entry => (
                <div key={entry.id} className="p-3 rounded-xl bg-bg3/30 border border-border flex items-start justify-between gap-3 hover:border-border/80 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-text">{entry.label}</p>
                    <p className="text-[11px] text-muted mt-0.5">{entry.description}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      disabled={togglingId === entry.id}
                      onChange={() => handleToggle(entry)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                  </label>
                </div>
              ))}
            </div>

            {/* Permanent Activity & Failure History */}
            <div className="p-4 pt-0 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Automation History</h3>
                <span className="text-[10px] text-muted font-mono">{activity.length} recorded</span>
              </div>

              {activity.length === 0 && (
                <p className="text-xs text-muted p-3">No WhatsApp messages sent yet.</p>
              )}

              {activity.map((item, idx) => {
                const isFailed = item.status.startsWith('failed');
                const isUnresolved = isFailed && item.acknowledged === 0;

                return (
                  <div
                    key={item.id || idx}
                    className={`p-3 rounded-xl border space-y-1.5 transition-all ${
                      isUnresolved
                        ? 'bg-rose-500/10 border-rose-500/40 shadow-sm ring-1 ring-rose-500/20'
                        : 'bg-bg3/30 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-text truncate block">
                          {item.automationType}{item.targetName ? ` — ${item.targetName}` : ''}
                        </span>
                        {item.phone && (
                          <span className="text-[10px] text-muted font-mono block">
                            Phone: {item.phone}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {statusPill(item.status)}
                      </div>
                    </div>

                    {item.message && (
                      <p className="text-[11px] text-muted/80 line-clamp-2 italic bg-bg2/40 rounded px-2 py-1">
                        "{item.message}"
                      </p>
                    )}

                    {isFailed && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                          <AlertTriangle size={13} className="text-rose-400 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="font-bold">Reason: </span>
                            {getFormattedFailureReason(item.errorMessage || undefined, item.status)}
                          </div>
                        </div>

                        {isUnresolved && (
                          <div className="flex justify-end pt-0.5">
                            <button
                              onClick={() => handleResolve(item)}
                              disabled={resolvingId === (item.id || String(item.rawId))}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Check size={11} /> Mark Resolved
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-4 pt-0">
              <button
                onClick={() => { whatsappQueueEvent.triggerOpen(); onClose(); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-bg3/60 hover:bg-bg3 text-text transition-all cursor-pointer"
              >
                View Full Queue <ExternalLink size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
