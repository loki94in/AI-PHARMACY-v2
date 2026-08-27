import { useEffect, useState } from 'react';
import { X, MessageSquareText, CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import { getFormattedFailureReason } from '../utils/whatsappFailureReason';
import { whatsappQueueEvent, automationHubEvent } from '../services/events';

interface CatalogEntry {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface ActivityItem {
  automationType: string;
  targetName: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: number | null;
  createdAt: string;
}

interface AutomationHubPopoverProps {
  onClose: () => void;
}

export default function AutomationHubPopover({ onClose }: AutomationHubPopoverProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [catalogRes, summaryRes] = await Promise.all([
        api.getAutomationCatalog(),
        api.getAutomationHubSummary(),
      ]);
      setCatalog(catalogRes);
      setActivity(summaryRes.activity);
    } catch (err) {
      console.error('Failed to load automation hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = automationHubEvent.subscribeUpdated(() => loadData());
    return unsubscribe;
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
        className="w-full max-w-md max-h-[80vh] overflow-y-auto bg-glass-bg backdrop-blur-xl border border-glass-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-glass-border sticky top-0 bg-glass-bg backdrop-blur-xl z-10">
          <div className="flex items-center gap-2">
            <MessageSquareText size={18} className="text-sky-400" />
            <h2 className="text-sm font-bold text-text">WhatsApp Automation Hub</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg3/60 text-muted hover:text-text" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-muted">Loading...</div>
        ) : (
          <>
            <div className="p-4 space-y-2">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Automations</h3>
              {catalog.map(entry => (
                <div key={entry.id} className="p-3 rounded-xl bg-bg3/30 border border-border flex items-start justify-between gap-3">
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

            <div className="p-4 pt-0 space-y-2">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-wide">Recent Activity</h3>
              {activity.length === 0 && (
                <p className="text-xs text-muted p-3">No WhatsApp messages sent yet.</p>
              )}
              {activity.map((item, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-bg3/30 border border-border space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-text truncate">
                      {item.automationType}{item.targetName ? ` — ${item.targetName}` : ''}
                    </span>
                    {statusPill(item.status)}
                  </div>
                  {item.status.startsWith('failed') && (
                    <div className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1.5">
                      Reason: {getFormattedFailureReason(item.errorMessage || undefined, item.status)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 pt-0">
              <button
                onClick={() => { whatsappQueueEvent.triggerOpen(); onClose(); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-bg3/60 hover:bg-bg3 text-text transition-all"
              >
                View Full Queue <ExternalLink size={12} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
