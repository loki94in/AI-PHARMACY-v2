import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/api';
import {
  RefreshCw, Send, Users, MessageSquare, Phone, Calendar,
  CheckCircle2, AlertCircle, Clock, Search, Repeat2, Bell,
  MessageCircle, Check, Package, Mail, ExternalLink, LogOut, Zap, Copy, FileText, X
} from 'lucide-react';
import { toastEvent } from '../../services/events';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RefillPatient {
  patient_name: string;
  patient_phone: string;
  next_refill_date: string;
  medicines: {
    id: number;
    medicine_name: string;
    quantity_needed: number;
    in_stock_qty: number;
    is_ready: number;
    acknowledged: number;
    hold_for_stock: number;
    status: string;
    quick_bill_id: number | null;
  }[];
}

interface AutomationLog {
  id: number;
  type: string;
  status: string;
  recipient: string;
  message: string;
  created_at: string;
  sent_at?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: number | string) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

const TABS = [
  { key: 'refills', label: 'Refills', icon: <Repeat2 size={15} /> },
  { key: 'credit', label: 'Customer Credit', icon: <Users size={15} /> },
  { key: 'messages', label: 'Distributor Messages', icon: <Bell size={15} /> },
  { key: 'whatsapp', label: 'WhatsApp Business', icon: <MessageCircle size={15} /> },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REFILLS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

const RefillsSection: React.FC = () => {
  const [data, setData] = useState<RefillPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [runningCheck, setRunningCheck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get<RefillPatient[]>('/refills/panel');
      setData(Array.isArray(r.data) ? r.data : []);
    } catch { toastEvent.trigger('Failed to load refills', 'error', '/crm'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCheck = async () => {
    setRunningCheck(true);
    try {
      await apiClient.post('/refills/check');
      toastEvent.trigger('Refill check triggered', 'success', '/crm');
      await load();
    } catch { toastEvent.trigger('Failed to run check', 'error', '/crm'); }
    finally { setRunningCheck(false); }
  };

  const handleSendReminder = async (phone: string) => {
    setSending(phone);
    try {
      await apiClient.post('/refills/send-tomorrow-reminder', { patient_phone: phone });
      toastEvent.trigger(`Reminder sent to ${phone}`, 'success', '/crm');
    } catch { toastEvent.trigger('Failed to send reminder', 'error', '/crm'); }
    finally { setSending(null); }
  };

  const filtered = data.filter(p =>
    p.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.patient_phone?.includes(search)
  );

  const overdue = filtered.filter(p => new Date(p.next_refill_date) < new Date());
  const upcoming = filtered.filter(p => new Date(p.next_refill_date) >= new Date());

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search patient…"
            className="w-full pl-8 pr-3 py-2 bg-bg2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <button
          onClick={handleCheck}
          disabled={runningCheck}
          className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={runningCheck ? 'animate-spin' : ''} />
          {runningCheck ? 'Checking…' : 'Run Check'}
        </button>
        <button onClick={load} className="p-2 bg-bg2 border border-border rounded-lg hover:bg-bg3 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
        <div className="ml-auto flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{overdue.length} Overdue</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent inline-block" />{upcoming.length} Upcoming</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading refills…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted gap-2">
            <CheckCircle2 size={32} className="text-green-500/50" />
            <p className="text-sm">No pending refills found</p>
          </div>
        )}
        {[...overdue, ...upcoming].map((patient) => {
          const isOverdue = new Date(patient.next_refill_date) < new Date();
          const allReady = patient.medicines.every(m => m.is_ready);
          return (
            <div
              key={`${patient.patient_phone}-${patient.next_refill_date}`}
              className={`bg-bg2 border rounded-xl p-4 transition-all ${isOverdue ? 'border-red-500/30' : 'border-border'}`}
            >
              {/* Patient header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${isOverdue ? 'bg-red-500/15 text-red-400' : 'bg-primary/15 text-primary'}`}>
                    {patient.patient_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text">{patient.patient_name}</p>
                    <p className="text-xs text-muted flex items-center gap-1">
                      <Phone size={10} /> {patient.patient_phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isOverdue ? 'bg-red-500/15 text-red-400' : 'bg-accent/15 text-accent'}`}>
                    <Calendar size={10} />
                    {isOverdue ? 'Overdue · ' : 'Due · '}{formatDate(patient.next_refill_date)}
                  </div>
                  <button
                    onClick={() => handleSendReminder(patient.patient_phone)}
                    disabled={sending === patient.patient_phone}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-50"
                  >
                    <Send size={11} className={sending === patient.patient_phone ? 'animate-pulse' : ''} />
                    {sending === patient.patient_phone ? 'Sending…' : 'Remind'}
                  </button>
                </div>
              </div>

              {/* Medicines */}
              <div className="space-y-1.5">
                {patient.medicines.map(med => (
                  <div key={med.id} className="flex items-center gap-2 px-3 py-2 bg-bg3/50 rounded-lg">
                    <Package size={12} className="text-muted flex-shrink-0" />
                    <span className="text-xs text-text flex-1 truncate">{med.medicine_name}</span>
                    <span className="text-xs text-muted">Qty: {med.quantity_needed}</span>
                    <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                      med.is_ready ? 'bg-green-500/15 text-green-400' :
                      med.hold_for_stock ? 'bg-yellow-500/15 text-yellow-400' :
                      'bg-muted/15 text-muted'
                    }`}>
                      {med.is_ready ? <><Check size={9} /> Ready</> :
                       med.hold_for_stock ? <><Clock size={9} /> Hold</> :
                       <><AlertCircle size={9} /> Pending</>}
                    </div>
                  </div>
                ))}
              </div>

              {allReady && (
                <div className="mt-2 flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle2 size={11} /> All medicines ready for dispensing
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DISTRIBUTOR MESSAGES SECTION
// ═══════════════════════════════════════════════════════════════════════════════

const DistributorMessagesSection: React.FC = () => {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get('/automation/notifications', {
        params: {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: search || undefined,
          limit: 200
        }
      });
      setLogs(Array.isArray(r.data) ? r.data : []);
    } catch { toastEvent.trigger('Failed to load messages', 'error', '/crm'); }
    finally { setLoading(false); }
  }, [typeFilter, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (id: number) => {
    setRetrying(id);
    try {
      await apiClient.post(`/automation/notifications/${id}/retry`);
      toastEvent.trigger('Message queued for retry', 'success', '/crm');
      await load();
    } catch { toastEvent.trigger('Retry failed', 'error', '/crm'); }
    finally { setRetrying(null); }
  };

  const statusColor = (s: string) => {
    if (s === 'sent') return 'bg-green-500/15 text-green-400';
    if (s === 'failed') return 'bg-red-500/15 text-red-400';
    if (s === 'pending') return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-muted/10 text-muted';
  };

  const typeIcon = (t: string) => {
    if (t?.includes('whatsapp')) return <MessageCircle size={13} className="text-green-400" />;
    if (t?.includes('email')) return <Mail size={13} className="text-blue-400" />;
    return <Bell size={13} className="text-muted" />;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipient or message…"
            className="w-full pl-8 pr-3 py-2 bg-bg2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-bg2 border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-bg2 border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="refill">Refill</option>
        </select>
        <button onClick={load} className="p-2 bg-bg2 border border-border rounded-lg hover:bg-bg3 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
        <span className="text-xs text-muted ml-auto">{logs.length} messages</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted gap-2">
            <MessageSquare size={32} className="opacity-30" />
            <p className="text-sm">No messages found</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 bg-bg2 border border-border rounded-xl px-4 py-3 hover:border-primary/20 transition-colors">
                <div className="mt-0.5">{typeIcon(log.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text truncate">{log.recipient || '—'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(log.status)}`}>
                      {log.status}
                    </span>
                    <span className="text-[10px] text-muted">{log.type}</span>
                  </div>
                  <p className="text-xs text-muted truncate">{log.message}</p>
                  {log.error && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">↳ {log.error}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-muted whitespace-nowrap">
                    {log.created_at ? formatTs(log.created_at) : '—'}
                  </span>
                  {log.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(log.id)}
                      disabled={retrying === log.id}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 bg-primary/10 border border-primary/30 text-primary rounded-md hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={9} className={retrying === log.id ? 'animate-spin' : ''} />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP SECTION — embedded web.whatsapp.com iframe
// ═══════════════════════════════════════════════════════════════════════════════

function parseAllPhoneNumbers(...inputs: (string | undefined | null)[]): string[] {
  const nums: string[] = [];
  inputs.forEach(input => {
    if (!input) return;
    const parts = String(input).split(/[,/;\n]+/);
    parts.forEach(p => {
      const clean = p.replace(/\D/g, '');
      if (clean.length >= 10) {
        const formatted = clean.length === 10 ? `+91 ${clean}` : `+${clean}`;
        if (!nums.includes(formatted)) {
          nums.push(formatted);
        }
      }
    });
  });
  return nums;
}

function formatPhoneNumber(numStr?: string): string {
  if (!numStr) return '';
  const digits = numStr.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length > 13) {
    return '';
  }
  return numStr.includes('+') ? numStr : `+${numStr}`;
}

function resolveChatDisplay(chat: WaChatItem): { title: string; subtitle: string } {
  const rawId = chat.id || '';
  const isLid = rawId.endsWith('@lid');
  const cleanPhone = formatPhoneNumber(chat.resolvedNumber || (isLid ? '' : rawId.split('@')[0]));

  const rawName = (chat.name || '').trim();
  const isNameDigitsOnly = /^\d+$/.test(rawName.replace(/\D/g, '')) && rawName.replace(/\D/g, '').length >= 8;
  const isNameLid = rawName.includes('@lid');

  if (rawName && !isNameDigitsOnly && !isNameLid) {
    return {
      title: rawName,
      subtitle: cleanPhone || (isLid ? '' : chat.resolvedNumber || rawId.split('@')[0])
    };
  }

  if (cleanPhone) {
    return {
      title: cleanPhone,
      subtitle: 'WhatsApp Contact'
    };
  }

  return {
    title: rawName || chat.resolvedNumber || rawId.split('@')[0],
    subtitle: ''
  };
}

interface WaChatItem {
  id: string;
  name: string;
  unreadCount: number;
  timestamp?: number;
  isGroup?: boolean;
  lastMessage?: string | null;
  resolvedNumber?: string;
}

interface WaMessageItem {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type?: string;
  hasMedia?: boolean;
  scannedResult?: string | null;
}

interface WaMessageTemplate {
  id: number;
  name: string;
  category: string;
  body: string;
}

const WhatsAppSection: React.FC = () => {
  const [chats, setChats] = useState<WaChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [search, setSearch] = useState('');
  const [activeChat, setActiveChat] = useState<WaChatItem | null>(null);

  const [messages, setMessages] = useState<WaMessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ filename: string; mimetype: string; data: string } | null>(null);

  const [isReady, setIsReady] = useState(true);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string>('');
  const [templates, setTemplates] = useState<WaMessageTemplate[]>([]);
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [scanningOcrId, setScanningOcrId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  // OCR results keyed by message ID (populated from DB via scannedResult or SSE)
  const [ocrResults, setOcrResults] = useState<Record<string, string>>({});

  const handleStartNewChat = (rawNumber: string) => {
    let digits = rawNumber.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length === 10) digits = `91${digits}`;
    const chatId = `${digits}@c.us`;
    const newChatObj: WaChatItem = {
      id: chatId,
      name: formatPhoneNumber(digits),
      unreadCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
      resolvedNumber: digits,
      lastMessage: ''
    };

    setChats(prev => {
      if (prev.some(c => c.id === chatId || c.resolvedNumber === digits)) return prev;
      return [newChatObj, ...prev];
    });
    setActiveChat(newChatObj);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setSearch('');
  };

  // Resizable panel width state (persisted in localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('crm_sidebar_width');
    return saved ? parseInt(saved, 10) : 340;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Mouse move handler for resizing sidebar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = Math.min(Math.max(e.clientX - 260, 240), 550);
      setSidebarWidth(newWidth);
      localStorage.setItem('crm_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Template form state
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [tmplName, setTmplName] = useState('');
  const [tmplCategory, setTmplCategory] = useState('General');
  const [tmplBody, setTmplBody] = useState('');
  const [savingTmpl, setSavingTmpl] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so SSE handler always sees the latest activeChat without stale closure
  const activeChatRef = useRef<WaChatItem | null>(null);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  // Load WhatsApp status + QR code
  const checkStatus = useCallback(async () => {
    try {
      const res = await apiClient.get<{ isReady: boolean; qrUrl?: string; message?: string }>('/messaging/qr');
      setIsReady(res.data.isReady);
      setQrUrl(res.data.qrUrl || null);
      setQrMessage(res.data.message || '');
    } catch {
      setIsReady(false);
      setQrUrl(null);
    }
  }, []);

  // Fetch Chat List
  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await apiClient.get<WaChatItem[]>('/messaging/chats');
      setChats(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastEvent.trigger('Failed to load WhatsApp chats', 'error', '/crm');
    } finally {
      setLoadingChats(false);
    }
  }, []);

  // Fetch Message Templates
  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiClient.get<WaMessageTemplate[]>('/messaging/templates');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load message templates:', err);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    loadChats();
    loadTemplates();

    // Poll status every 5s when not ready (for QR), every 30s when ready (for chat list)
    const pollId = setInterval(() => {
      checkStatus();
      if (isReady) loadChats();
    }, 5_000);
    return () => clearInterval(pollId);
  }, [checkStatus, loadChats, loadTemplates, isReady]);

  // Load Thread Messages when activeChat changes
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setOcrResults({});
      return;
    }

    const loadMessages = (isInitial = false) => {
      if (isInitial) setLoadingMessages(true);
      apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
        .then(res => {
          const msgs = Array.isArray(res.data) ? res.data : [];
          setMessages(prev => {
            const optimisticMsgs = prev.filter(m => m.id.startsWith('optimistic_'));
            if (optimisticMsgs.length === 0) return msgs;

            const fetchedBodies = new Set(msgs.map(m => m.body));
            const pendingOptimistic = optimisticMsgs.filter(m => !fetchedBodies.has(m.body));
            return [...msgs, ...pendingOptimistic];
          });
          // Populate ocrResults map from pre-existing DB scans
          const preloaded: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.scannedResult) {
              try {
                const parsed = JSON.parse(msg.scannedResult);
                const label = parsed?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                  || parsed?.text?.substring(0, 120);
                if (label) preloaded[msg.id] = label;
              } catch { /* ignore malformed JSON */ }
            }
          }
          setOcrResults(preloaded);
          if (isInitial) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        })
        .catch(() => { if (isInitial) toastEvent.trigger('Failed to load message history', 'error', '/crm'); })
        .finally(() => { if (isInitial) setLoadingMessages(false); });
    };

    loadMessages(true);
    // Live polling: refresh messages every 10 s when a chat is open
    const msgPollId = setInterval(() => loadMessages(false), 10_000);
    return () => clearInterval(msgPollId);
  }, [activeChat]);

function isSameChat(chat: WaChatItem, targetChatId: string, resolvedNum?: string): boolean {
  if (!chat) return false;
  if (chat.id === targetChatId) return true;
  if (chat.resolvedNumber && targetChatId.includes(chat.resolvedNumber)) return true;
  if (resolvedNum && (chat.id.includes(resolvedNum) || chat.resolvedNumber === resolvedNum)) return true;

  const chatDigits = (chat.resolvedNumber || chat.id).replace(/\D/g, '').slice(-10);
  const targetDigits = ((resolvedNum || targetChatId) || '').replace(/\D/g, '').slice(-10);

  if (chatDigits && targetDigits && chatDigits.length >= 7 && chatDigits === targetDigits) {
    return true;
  }
  return false;
}

  // SSE event listener for real-time messages
  useEffect(() => {
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wa_new_message') {
          const newMsg: WaMessageItem = data.payload.message;
          const chatId: string = data.payload.chat_id;
          const resolvedNumber: string = data.payload.resolved_number;

          // Use ref to avoid stale closure on activeChat
          const currentChat = activeChatRef.current;
          if (currentChat && isSameChat(currentChat, chatId, resolvedNumber)) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          }
          // Refresh chats list preview
          loadChats();
        } else if (data.type === 'ocr_scan_complete') {
          // OCR result arrived from background scan — update pill badge in chat
          const { msgId, ocrResult } = data.payload || {};
          if (msgId && ocrResult) {
            try {
              const label = ocrResult?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                || ocrResult?.text?.substring(0, 120);
              if (label) setOcrResults(prev => ({ ...prev, [msgId]: label }));
            } catch { /* ignore */ }
          }
        } else if (data.type === 'auth_failure') {
          setIsReady(false);
        }
      } catch (err) {
        console.error('SSE message parse error:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [activeChat, loadChats]);

  // Handle Send Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChat) return;
    if (!composerText.trim() && !attachedFile) return;

    const recipient = activeChat.resolvedNumber || activeChat.id.split('@')[0];
    const textToSend = composerText.trim();
    setSending(true);

    // Optimistic update: show the message immediately in the thread
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticMsg: WaMessageItem = {
      id: optimisticId,
      body: attachedFile ? `[Document] ${attachedFile.filename}` : textToSend,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      type: attachedFile ? 'document' : 'text',
      hasMedia: !!attachedFile,
      scannedResult: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);

    // Clear composer immediately for better UX
    setComposerText('');
    setAttachedFile(null);

    try {
      await apiClient.post('/messaging/send', {
        number: recipient,
        message: textToSend,
        file: attachedFile || undefined
      });
      toastEvent.trigger('Message sent via WhatsApp', 'success', '/crm');
      // Refresh chat list immediately so the new or updated chat shows up with preview
      loadChats();
      // Reconcile optimistic message with DB record after short delay
      setTimeout(() => {
        if (activeChatRef.current) {
          apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChatRef.current.id)}/messages?limit=500`)
            .then(res => {
              if (Array.isArray(res.data) && res.data.length > 0) {
                setMessages(res.data);
                setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
              }
            })
            .catch(() => {});
        }
      }, 400);
    } catch (err: any) {
      // Remove optimistic message on failure so user knows the send failed
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      toastEvent.trigger(err.response?.data?.error || 'Failed to send message', 'error', '/crm');
    } finally {
      setSending(false);
    }
  };

  // Handle File Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setAttachedFile({
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
  };

  // Handle Save Template (Create / Edit)
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmplName.trim() || !tmplBody.trim()) {
      toastEvent.trigger('Name and content are required', 'error');
      return;
    }
    setSavingTmpl(true);
    try {
      if (editingTemplateId) {
        await apiClient.put(`/messaging/templates/${editingTemplateId}`, {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template updated', 'success');
      } else {
        await apiClient.post('/messaging/templates', {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template created', 'success');
      }
      setTmplName('');
      setTmplCategory('General');
      setTmplBody('');
      setEditingTemplateId(null);
      await loadTemplates();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to save template', 'error');
    } finally {
      setSavingTmpl(false);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id: number) => {
    try {
      await apiClient.delete(`/messaging/templates/${id}`);
      toastEvent.trigger('Template deleted', 'success');
      await loadTemplates();
    } catch {
      toastEvent.trigger('Failed to delete template', 'error');
    }
  };

  // Edit Template
  const handleStartEditTemplate = (t: WaMessageTemplate) => {
    setEditingTemplateId(t.id);
    setTmplName(t.name);
    setTmplCategory(t.category || 'General');
    setTmplBody(t.body);
  };

  const [viewMode, setViewMode] = useState<'live_web' | 'crm_chats'>('live_web');

  // Filtered Chats
  const filteredChats = chats.filter(c => {
    const query = search.toLowerCase().trim();
    if (!query) return true;
    return (
      (c.name && c.name.toLowerCase().includes(query)) ||
      (c.resolvedNumber && c.resolvedNumber.includes(query)) ||
      (c.id && c.id.includes(query))
    );
  });

  return (
    <div className="w-full h-full flex flex-col gap-3">
      {/* Top Controls: Engine Status & Action Controls */}
      <div className="flex items-center justify-between gap-3 bg-bg2 p-2.5 rounded-2xl border border-border shadow-sm shrink-0">
        <div className="flex items-center gap-2 select-none">
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live WhatsApp CRM Engine</span>
          </div>
          <span className="text-[11px] text-muted hidden sm:inline">
            Drag panel handle to customize width (auto-saved)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 text-xs font-bold transition-all active:scale-95"
            title="Start new chat with any phone number"
          >
            <MessageSquare size={13} />
            <span>New Chat</span>
          </button>

          <button
            onClick={() => setShowManageModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 border border-border text-text hover:text-primary text-xs font-bold transition-all active:scale-95"
            title="Manage Message Templates"
          >
            <Zap size={13} className="text-primary" />
            <span>Manage Templates</span>
          </button>

          <button
            onClick={async () => {
              try {
                toastEvent.trigger('Launching live WhatsApp Web Chrome window...', 'info');
                await apiClient.post('/messaging/login-window');
              } catch (err: any) {
                toastEvent.trigger(err?.response?.data?.error || 'Failed to launch WhatsApp window', 'error');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-sm active:scale-95"
            title="Open native live Google Chrome window logged into WhatsApp Web"
          >
            <ExternalLink size={13} />
            <span>Open Live Chrome Window</span>
          </button>
        </div>
      </div>

      {/* ── WhatsApp Not-Connected: full QR setup screen ── */}
      {!isReady ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 bg-bg2 border border-border rounded-2xl">
          <div className="text-center space-y-1">
            <h2 className="text-sm font-bold text-text flex items-center justify-center gap-2">
              <MessageCircle size={18} className="text-emerald-400" />
              Connect WhatsApp
            </h2>
            <p className="text-xs text-muted max-w-xs">
              {qrMessage || 'Scan the QR code below with your phone to connect WhatsApp. The QR refreshes automatically.'}
            </p>
          </div>

          {/* QR Code */}
          {qrUrl ? (
            <div className="p-4 bg-white rounded-2xl shadow-lg border border-border">
              <img src={qrUrl} alt="WhatsApp QR Code" className="w-56 h-56" />
            </div>
          ) : (
            <div className="w-64 h-64 bg-bg3 border border-border rounded-2xl flex flex-col items-center justify-center gap-3 text-muted">
              <RefreshCw size={28} className="animate-spin text-emerald-400" />
              <p className="text-xs">Generating QR code…</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={checkStatus}
              className="flex items-center gap-2 px-4 py-2 bg-bg3 border border-border rounded-xl text-xs font-bold text-text hover:bg-bg transition-all active:scale-95"
            >
              <RefreshCw size={13} /> Refresh QR
            </button>
            <button
              onClick={async () => {
                try {
                  toastEvent.trigger('Launching WhatsApp login window…', 'info');
                  await apiClient.post('/messaging/login-window');
                } catch (err: any) {
                  toastEvent.trigger(err?.response?.data?.error || 'Failed to launch login window', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
            >
              <ExternalLink size={13} /> Open Live Chrome Window
            </button>
          </div>

          <p className="text-[10px] text-muted text-center max-w-xs">
            Open WhatsApp on your phone → Linked Devices → Link a Device → scan the QR above.
          </p>
        </div>
      ) : (
      /* ── Main Interface: Resizable Native Chat Panel ── */
      <div className="flex-1 min-h-0 flex bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Left: Chat List Panel (Resizable Width) */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-border flex flex-col bg-bg3/40 min-h-0 shrink-0 select-none"
        >
          <div className="p-3 border-b border-border flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search chats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={loadChats}
              disabled={loadingChats}
              className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95 disabled:opacity-50"
              title="Refresh chat list"
            >
              <RefreshCw size={14} className={loadingChats ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loadingChats && chats.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading chats...</div>
            ) : filteredChats.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted flex flex-col items-center gap-3">
                <span>No WhatsApp chats found.</span>
                {search.replace(/\D/g, '').length >= 7 && (
                  <button
                    onClick={() => handleStartNewChat(search)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <MessageSquare size={13} />
                    <span>Start Chat with {search.trim()}</span>
                  </button>
                )}
              </div>
            ) : (
              filteredChats.map(c => {
                const isActive = activeChat?.id === c.id;
                const display = resolveChatDisplay(c);
                const initial = display.title.charAt(0).toUpperCase();

                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveChat(c)}
                    className={`p-3 flex items-start gap-3 cursor-pointer transition-all hover:bg-bg/60 ${
                      isActive ? 'bg-primary/10 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-text truncate">{display.title}</h4>
                        {c.timestamp && (
                          <span className="text-[10px] text-muted">{formatTs(c.timestamp)}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted truncate mt-0.5">
                        {display.subtitle ? `${display.subtitle} • ` : ''}{c.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary text-white font-bold text-[10px]">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className="w-1.5 hover:w-2 bg-border/40 hover:bg-primary/60 cursor-col-resize transition-all shrink-0 select-none flex items-center justify-center group"
          title="Drag to resize WhatsApp panel (auto-saved)"
        >
          <div className="w-0.5 h-6 bg-muted/40 group-hover:bg-white rounded-full transition-colors" />
        </div>

        {/* Right: Active Chat Thread & Composer */}
        <div className="flex-1 flex flex-col min-h-0 bg-bg min-w-0">
          {activeChat ? (
            <>
              {/* Thread Header */}
              {(() => {
                const activeDisplay = resolveChatDisplay(activeChat);
                return (
                  <div className="p-3 border-b border-border bg-bg2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">
                        {activeDisplay.title.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-text">
                          {activeDisplay.title}
                        </h3>
                        {activeDisplay.subtitle && (
                          <p className="text-[10px] text-muted">
                            {activeDisplay.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Thread Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg/50">
                {loadingMessages ? (
                  <div className="p-8 text-center text-xs text-muted">Loading message history...</div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No messages in this chat.</div>
                ) : (
                  messages.map(m => {
                    const isOut = m.fromMe;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`group relative max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm select-text ${
                            isOut
                              ? 'bg-primary text-white rounded-br-none'
                              : 'bg-bg2 border border-border text-text rounded-bl-none'
                          }`}
                        >
                          {/* Copy Button */}
                          {m.body && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(m.body);
                                setCopiedMsgId(m.id);
                                toastEvent.trigger('Message copied to clipboard', 'success');
                                setTimeout(() => setCopiedMsgId(null), 2000);
                              }}
                              className={`absolute top-1.5 right-1.5 p-1 rounded-md transition-all ${
                                isOut
                                  ? 'bg-white/20 text-white hover:bg-white/30'
                                  : 'bg-bg3/80 text-muted hover:text-text hover:bg-bg3'
                              }`}
                              title="Copy message text"
                            >
                              {copiedMsgId === m.id ? (
                                <Check size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          )}

                          <div className="whitespace-pre-wrap break-words pr-5 select-text">{m.body}</div>
                          {/* OCR medicine result pill — shown when scan result exists */}
                          {ocrResults[m.id] && (
                            <div className="mt-2 pt-1.5 border-t border-border/40 select-text flex items-center justify-between gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-400 text-[10px] font-semibold select-text">
                                💊 {ocrResults[m.id]}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(ocrResults[m.id]);
                                  toastEvent.trigger('OCR medicine text copied', 'success');
                                }}
                                className="p-1 text-[10px] text-teal-400 hover:underline flex items-center gap-0.5"
                                title="Copy OCR text"
                              >
                                <Copy size={9} /> Copy
                              </button>
                            </div>
                          )}
                          {m.hasMedia && (
                            <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-[10px]">
                              <span className="text-muted flex items-center gap-1">📁 Media Attachment</span>
                              <button
                                onClick={async () => {
                                  setScanningOcrId(m.id);
                                  try {
                                    toastEvent.trigger('Queuing OCR prescription scan...', 'info');
                                    await apiClient.post(
                                      `/messaging/chats/${encodeURIComponent(activeChat!.id)}/messages/${encodeURIComponent(m.id)}/scan`
                                    );
                                    toastEvent.trigger('OCR scan queued – result will appear shortly', 'success', '/crm');
                                  } catch {
                                    toastEvent.trigger('Failed to queue prescription scan', 'error');
                                  } finally {
                                    setScanningOcrId(null);
                                  }
                                }}
                                disabled={scanningOcrId === m.id}
                                className="px-2 py-0.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-bold transition-all flex items-center gap-1"
                              >
                                <span>{scanningOcrId === m.id ? 'Scanning OCR...' : '🔍 OCR Scan Prescription'}</span>
                              </button>
                            </div>
                          )}
                          <div
                            className={`text-[9px] mt-1 text-right ${
                              isOut ? 'text-white/70' : 'text-muted'
                            }`}
                          >
                            {formatTs(m.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Attached File Bar */}
              {attachedFile && (
                <div className="px-4 py-2 bg-primary/10 border-t border-primary/20 flex items-center justify-between text-xs text-primary">
                  <div className="flex items-center gap-2 truncate">
                    <Package size={14} />
                    <span className="font-bold truncate">{attachedFile.filename}</span>
                  </div>
                  <button
                    onClick={() => setAttachedFile(null)}
                    className="p-1 hover:text-text transition-all"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Composer & Quick Templates Popover */}
              <div className="p-3 border-t border-border bg-bg2 relative">
                {/* Templates Popover */}
                {showTemplatePopover && (
                  <div className="absolute bottom-16 left-3 w-80 max-h-64 bg-bg2 border border-border rounded-2xl shadow-xl z-20 flex flex-col overflow-hidden">
                    <div className="p-2.5 border-b border-border bg-bg3 flex items-center justify-between text-xs font-bold text-text">
                      <span>Quick Message Templates</span>
                      <button
                        onClick={() => {
                          setShowTemplatePopover(false);
                          setShowManageModal(true);
                        }}
                        className="text-[10px] text-primary hover:underline"
                      >
                        Manage
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 divide-y divide-border/40">
                      {templates.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted">No templates found.</div>
                      ) : (
                        templates.map(t => (
                          <div
                            key={t.id}
                            onClick={() => {
                              setComposerText(prev => (prev ? `${prev}\n${t.body}` : t.body));
                              setShowTemplatePopover(false);
                            }}
                            className="p-2 hover:bg-bg3 rounded-xl cursor-pointer transition-all"
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-text">
                              <span>{t.name}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                                {t.category || 'General'}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted truncate mt-0.5">{t.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplatePopover(prev => !prev)}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-primary transition-all active:scale-95 text-xs font-bold flex items-center gap-1"
                    title="Quick Templates"
                  >
                    <Zap size={14} />
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95"
                    title="Attach file"
                  >
                    <Package size={14} />
                  </button>

                  <input
                    type="text"
                    placeholder="Type WhatsApp message..."
                    value={composerText}
                    onChange={e => setComposerText(e.target.value)}
                    className="flex-1 px-4 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />

                  <button
                    type="submit"
                    disabled={sending || (!composerText.trim() && !attachedFile)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                  >
                    <Send size={13} />
                    <span>{sending ? 'Sending...' : 'Send'}</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                <MessageCircle size={24} />
              </div>
              <p className="text-xs">Select a WhatsApp chat from the list to view history &amp; send messages.</p>
            </div>
          )}
        </div>
      </div>
      )} {/* end isReady ternary */}

      {/* Template Manager Modal */}
      {showManageModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span>Manage Quick Message Templates</span>
              </h3>
              <button
                onClick={() => setShowManageModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {/* Form */}
              <form onSubmit={handleSaveTemplate} className="p-3 bg-bg3/50 border border-border rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Template Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Refill Notice"
                      value={tmplName}
                      onChange={e => setTmplName(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Patients / General"
                      value={tmplCategory}
                      onChange={e => setTmplCategory(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-muted uppercase">Message Body</label>
                  <textarea
                    rows={3}
                    placeholder="Type template message text..."
                    value={tmplBody}
                    onChange={e => setTmplBody(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  {editingTemplateId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplateId(null);
                        setTmplName('');
                        setTmplCategory('General');
                        setTmplBody('');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted hover:bg-bg3"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingTmpl}
                    className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {savingTmpl ? 'Saving...' : editingTemplateId ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </form>

              {/* Template List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider">Existing Templates</h4>
                <div className="space-y-2">
                  {templates.map(t => (
                    <div
                      key={t.id}
                      className="p-3 bg-bg border border-border rounded-xl flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text">{t.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                            {t.category || 'General'}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 whitespace-pre-wrap">{t.body}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleStartEditTemplate(t)}
                          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-bg3"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="p-1.5 rounded-lg text-muted hover:text-rose-400 hover:bg-bg3"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <MessageSquare size={16} className="text-emerald-400" />
                <span>Start New WhatsApp Chat</span>
              </h3>
              <button
                onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newChatNumber.trim()) handleStartNewChat(newChatNumber);
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Mobile / WhatsApp Number</label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or 919876543210"
                  value={newChatNumber}
                  onChange={e => setNewChatNumber(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-muted hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChatNumber.trim()}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50"
                >
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};







// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER CREDIT SECTION
// ═══════════════════════════════════════════════════════════════════════════════

interface CreditCustomerItem {
  id: number;
  name: string;
  phone: string;
  address?: string;
  credit_balance: number;
  credit_due_date?: string;
  unpaid_bills_count: number;
  last_sale_date?: string;
}

const CustomerCreditSection: React.FC = () => {
  const [customers, setCustomers] = useState<CreditCustomerItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CreditCustomerItem | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [collectingPayment, setCollectingPayment] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);

  const loadCustomerInvoices = useCallback(async (customerId: number) => {
    setLoadingInvoices(true);
    try {
      const res = await apiClient.get<any[]>(`/crm/${customerId}/history`);
      setCustomerInvoices(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastEvent.trigger('Failed to load customer purchase bills', 'error', '/crm');
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const loadCreditCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CreditCustomerItem[]>('/crm/credit-customers');
      const data = Array.isArray(res.data) ? res.data : [];
      setCustomers(data);
      if (data.length > 0) {
        setSelectedCustomer(prev => {
          const match = data.find(c => c.id === prev?.id);
          const active = match || data[0];
          loadCustomerInvoices(active.id);
          return active;
        });
      }
    } catch {
      toastEvent.trigger('Failed to load credit customers', 'error', '/crm');
    } finally {
      setLoading(false);
    }
  }, [loadCustomerInvoices]);

  useEffect(() => {
    loadCreditCustomers();
  }, [loadCreditCustomers]);

  const handleSaveDueDate = async (id: number) => {
    try {
      await apiClient.put(`/crm/credit-customers/${id}/due-date`, { due_date: newDueDate || null });
      toastEvent.trigger('Due date updated', 'success', '/crm');
      setEditingId(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to update due date', 'error', '/crm');
    }
  };

  const handleSendManualReminder = async (cust: CreditCustomerItem) => {
    setSendingId(cust.id);
    try {
      await apiClient.post(`/crm/credit-customers/${cust.id}/send-reminder`, {});
      toastEvent.trigger(`Manual credit reminder sent to ${cust.name}`, 'success', '/crm');
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to send WhatsApp reminder', 'error', '/crm');
    } finally {
      setSendingId(null);
    }
  };

  const handlePayBalance = async (id: number) => {
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toastEvent.trigger('Enter a valid payment amount', 'error', '/crm');
      return;
    }
    setCollectingPayment(true);
    try {
      const res = await apiClient.post('/crm/ledger/pay', { amount: amt, customer_id: id });
      const successMsg = res.data?.message || `Collected ₹${amt.toFixed(2)} payment`;
      toastEvent.trigger(successMsg, 'success', '/crm');
      setPayingId(null);
      setPayAmount('');
      await loadCreditCustomers();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to process payment', 'error', '/crm');
    } finally {
      setCollectingPayment(false);
    }
  };

  const handleClearCredit = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to clear/remove credit entry for ${name}?`)) return;
    try {
      await apiClient.post(`/crm/credit-customers/${id}/clear`);
      toastEvent.trigger(`Cleared credit entry for ${name}`, 'success', '/crm');
      setSelectedCustomer(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to clear customer credit', 'error', '/crm');
    }
  };

  const filtered = customers.filter(c => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  });

  const totalDues = customers.reduce((sum, c) => sum + (c.credit_balance || 0), 0);

  return (
    <div className="w-full h-full flex flex-col gap-3 overflow-hidden pr-1">
      {/* Header Cards & Quick Search */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="p-3.5 bg-bg2 border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Total Medical Outstanding Dues</p>
            <h3 className="text-lg font-bold text-amber-400 mt-0.5">₹{totalDues.toFixed(2)}</h3>
          </div>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg2 border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Active Credit Customers</p>
            <h3 className="text-lg font-bold text-text mt-0.5">{customers.length} Customers</h3>
          </div>
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg2 border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <button
            onClick={loadCreditCustomers}
            disabled={loading}
            className="w-full h-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-bg3 border border-border text-xs font-bold text-text hover:text-primary transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Ledger Dues</span>
          </button>
        </div>
      </div>

      {/* Split-View Container */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 overflow-hidden min-h-0">
        {/* LEFT PANEL: Customer Credit Accounts List */}
        <div className="w-full md:w-80 lg:w-96 shrink-0 bg-bg2 border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-3 border-b border-border bg-bg3/40 flex items-center justify-between">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="text-amber-400" />
              Credit Customers / Accounts
            </h3>
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold">
              {filtered.length}
            </span>
          </div>

          {/* Search Input */}
          <div className="p-2 border-b border-border bg-bg">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search customer name or mobile..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Customer Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading && customers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading credit customers...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">No credit customers found.</div>
            ) : (
              filtered.map(cust => {
                const isSelected = selectedCustomer?.id === cust.id;
                return (
                  <div
                    key={cust.id}
                    onClick={() => {
                      setSelectedCustomer(cust);
                      loadCustomerInvoices(cust.id);
                    }}
                    className={`p-3 cursor-pointer transition-all flex items-center justify-between hover:bg-primary/5 ${
                      isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-text">{cust.name || 'Unnamed Patient'}</div>
                      <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5">
                        <span>📱 {cust.phone || 'No phone'}</span>
                        <span>•</span>
                        <span>{cust.unpaid_bills_count} Unpaid Bill(s)</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-amber-400">₹{(cust.credit_balance || 0).toFixed(2)}</div>
                      <div className="text-[9px] text-muted mt-0.5">
                        {cust.credit_due_date ? `Due: ${formatDate(cust.credit_due_date)}` : 'No Due Date'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Selected Account Purchases & Actions */}
        <div className="flex-1 bg-bg2 border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          {selectedCustomer ? (
            <>
              {/* Account Header */}
              <div className="p-3.5 border-b border-border bg-bg3/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-text">{selectedCustomer.name || 'Unnamed Patient'}</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      CREDIT ACCOUNT
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-3">
                    <span>📱 {selectedCustomer.phone || 'No phone'}</span>
                    {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
                  </div>
                </div>

                {/* Right Side Balance & Action Buttons */}
                <div className="flex items-center gap-3">
                  <div className="text-right pr-2">
                    <div className="text-[10px] text-muted font-medium uppercase tracking-wider">Outstanding Balance</div>
                    <div className="text-base font-extrabold text-amber-400">₹{(selectedCustomer.credit_balance || 0).toFixed(2)}</div>
                  </div>

                  {/* Collect Payment Action Toggle */}
                  <button
                    onClick={() => {
                      if (payingId === selectedCustomer.id) {
                        setPayingId(null);
                      } else {
                        setPayingId(selectedCustomer.id);
                        setPayAmount(String(selectedCustomer.credit_balance || 0));
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                      payingId === selectedCustomer.id
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                  >
                    <Zap size={14} className={payingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>{payingId === selectedCustomer.id ? 'Cancel Payment' : 'Collect Payment'}</span>
                  </button>

                  {/* WhatsApp Reminder Button */}
                  <button
                    onClick={() => handleSendManualReminder(selectedCustomer)}
                    disabled={sendingId === selectedCustomer.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all disabled:opacity-50"
                    title="Send instant manual credit reminder on WhatsApp"
                  >
                    <Send size={12} className={sendingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>Send WhatsApp Message</span>
                  </button>

                  {/* Clear Credit Entry Button */}
                  <button
                    onClick={() => handleClearCredit(selectedCustomer.id, selectedCustomer.name || 'Customer')}
                    className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red border border-red-500/30 hover:bg-red-500/20 text-xs font-bold transition-all"
                    title="Clear credit balance and remove entry from CRM credit list"
                  >
                    Clear Entry
                  </button>
                </div>
              </div>

              {/* LIVE ANIMATED PAYMENT CALCULATION & AUTO-RECEIPT PANEL */}
              {payingId === selectedCustomer.id && (() => {
                const originalBal = selectedCustomer.credit_balance || 0;
                const enteredPay = parseFloat(payAmount) || 0;
                const liveRemaining = Math.max(0, originalBal - enteredPay);
                const payPercent = Math.min(100, Math.max(0, (enteredPay / (originalBal || 1)) * 100));
                const isFullPay = enteredPay >= originalBal && originalBal > 0;

                return (
                  <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-bg3 to-bg2 border-b border-emerald-500/30 flex flex-col gap-2.5 transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-1 shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {/* Input & Quick Percent Chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Zap size={14} className="text-emerald-400 animate-bounce" />
                          Collect Amount:
                        </span>
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-xs font-bold text-muted">₹</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={payAmount}
                            onChange={e => setPayAmount(e.target.value)}
                            className="w-32 pl-6 pr-2.5 py-1.5 bg-bg border border-emerald-500/40 rounded-xl text-xs font-bold text-text focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner"
                            autoFocus
                          />
                        </div>

                        {/* Quick preset chips */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPayAmount(String(originalBal))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${isFullPay ? 'bg-emerald-500 text-white shadow-sm' : 'bg-bg3 text-muted hover:text-text border border-border'}`}
                          >
                            100% Full (₹{originalBal.toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.5).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            50% (₹{(originalBal * 0.5).toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.25).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            25% (₹{(originalBal * 0.25).toFixed(2)})
                          </button>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePayBalance(selectedCustomer.id)}
                          disabled={collectingPayment || enteredPay <= 0}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} className={collectingPayment ? 'animate-spin' : ''} />
                          <span>{collectingPayment ? 'Collecting & Sending Receipt...' : `Confirm & Collect ₹${enteredPay.toFixed(2)}`}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayingId(null)}
                          className="px-2.5 py-1.5 rounded-xl bg-bg3 border border-border text-muted hover:text-text text-xs font-semibold transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {/* Live Calculation Preview Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-border/40 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-bg/50 border border-border/50">
                        <span className="text-muted text-[11px]">Original Dues:</span>
                        <span className="font-bold text-amber-400">₹{originalBal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <span className="text-emerald-400 text-[11px] font-medium">Paying Now:</span>
                        <span className="font-extrabold text-emerald-400">– ₹{enteredPay.toFixed(2)}</span>
                      </div>
                      <div className={`flex items-center justify-between p-2 rounded-xl border transition-all duration-300 ${liveRemaining === 0 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-bg/50 border-border/50 text-text'}`}>
                        <span className="text-[11px] font-medium">New Remaining Dues:</span>
                        <span className="font-extrabold text-xs transition-all duration-300">
                          {liveRemaining === 0 ? '✨ Fully Cleared (₹0.00)' : `₹${liveRemaining.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    {/* Live Progress Bar & WhatsApp Auto Notice */}
                    <div className="w-full">
                      <div className="flex justify-between text-[10px] text-muted mb-1 font-medium">
                        <span>Dues Cleared: {payPercent.toFixed(0)}%</span>
                        <span className="text-emerald-400 font-semibold">
                          {selectedCustomer.phone ? '📱 Auto WhatsApp Receipt Will Be Sent' : 'No phone saved for WhatsApp'}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-bg rounded-full overflow-hidden border border-border/40 p-0.5">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out shadow-sm"
                          style={{ width: `${payPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Due Date Management Bar */}
              <div className="px-4 py-2 bg-bg border-b border-border flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted font-medium">Agreed Credit Due Date:</span>
                  {editingId === selectedCustomer.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={e => setNewDueDate(e.target.value)}
                        className="px-2 py-0.5 bg-bg2 border border-border rounded text-xs text-text focus:outline-none"
                      />
                      <button onClick={() => handleSaveDueDate(selectedCustomer.id)} className="px-2 py-0.5 rounded bg-emerald-500 text-white font-bold text-[10px]">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-muted text-[10px]">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={selectedCustomer.credit_due_date ? 'text-text font-bold' : 'text-muted italic'}>
                        {selectedCustomer.credit_due_date ? formatDate(selectedCustomer.credit_due_date) : 'Not Set'}
                      </span>
                      <button onClick={() => { setEditingId(selectedCustomer.id); setNewDueDate(selectedCustomer.credit_due_date || ''); }} className="text-[10px] text-primary hover:underline font-bold">
                        Edit Date
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-muted text-[11px] font-medium">{customerInvoices.length} Credit Purchase Bill(s)</span>
              </div>

              {/* Credit Purchase History Table */}
              <div className="flex-1 overflow-y-auto p-4">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText size={14} className="text-primary" />
                  Credit Purchase History &amp; Bills
                </h4>

                {loadingInvoices ? (
                  <div className="p-8 text-center text-xs text-muted">Loading purchase bills...</div>
                ) : customerInvoices.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No credit purchase bills found for this customer.</div>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-bg3/50 border-b border-border text-muted font-bold">
                          <th className="p-2.5">Purchase Date</th>
                          <th className="p-2.5">Bill Number</th>
                          <th className="p-2.5">Doctor</th>
                          <th className="p-2.5">Payment Mode</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5 text-right">Bill Amount</th>
                          <th className="p-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {customerInvoices.map((inv: any) => (
                          <tr key={inv.id} className="hover:bg-bg/50 transition-colors">
                            <td className="p-2.5 text-muted">{formatDate(inv.date)}</td>
                            <td className="p-2.5 font-bold">
                              <button
                                onClick={() => setViewInvoice(inv)}
                                className="text-primary hover:underline font-mono font-bold flex items-center gap-1"
                                title="Click to view full medicine list & bill preview"
                              >
                                <FileText size={12} />
                                <span>{inv.invoice_no}</span>
                              </button>
                            </td>
                            <td className="p-2.5 text-muted">{inv.doctor_name || '-'}</td>
                            <td className="p-2.5 font-semibold text-text">{inv.payment_medium || 'CREDIT'}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                inv.payment_status === 'PAID'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {inv.payment_status || 'UNPAID'}
                              </span>
                            </td>
                            <td className="p-2.5 font-extrabold text-amber-400 text-right">₹{(inv.total_amount || 0).toFixed(2)}</td>
                            <td className="p-2.5 text-center">
                              <button
                                onClick={() => setViewInvoice(inv)}
                                className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-[11px] font-semibold text-text hover:text-primary transition-all flex items-center gap-1 mx-auto"
                              >
                                <FileText size={11} />
                                <span>View Bill</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-muted text-xs">
              Select a credit customer from the left panel to view purchase bills &amp; details.
            </div>
          )}
        </div>
      </div>

      {/* Bill Preview Modal (Matching Sales History Page Popup) */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] flex flex-col border-primary/20 bg-bg2 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2 text-text">
                  <FileText size={18} className="text-primary" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-0.5">Read-only preview of credit sale invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              {/* Customer & Invoice Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-bg3/30 p-3.5 rounded-xl border border-border text-xs">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Patient Name</div>
                  <div className="font-bold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">WhatsApp / Phone</div>
                  <div className="font-bold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Payment Method</div>
                  <div className="font-bold text-amber-400">{viewInvoice.payment_medium || 'CREDIT'} ({viewInvoice.payment_status || 'UNPAID'})</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Sale Date</div>
                  <div className="font-bold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Purchased Medicines Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Purchased Medicines</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item(s)</span>
                </div>
                <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                        <th className="p-2.5">Medicine Name</th>
                        <th className="p-2.5">Batch</th>
                        <th className="p-2.5 text-center">Qty (Strips/Loose)</th>
                        <th className="p-2.5 text-center">CD %</th>
                        <th className="p-2.5">MRP</th>
                        <th className="p-2.5">Unit Price</th>
                        <th className="p-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {viewInvoice.items?.map((item: any, idx: number) => {
                        const packSize = item.pack_size || 10;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-bg2/50">
                            <td className="p-2.5 font-semibold text-text">{item.medicine_name || `Item #${item.inventory_id}`}</td>
                            <td className="p-2.5 font-mono text-[11px] text-muted">{item.batch_number || '-'}</td>
                            <td className="p-2.5 text-center font-bold">{item.quantity} / {looseQty}</td>
                            <td className="p-2.5 text-center text-muted">{discPer}%</td>
                            <td className="p-2.5 text-muted">₹{item.mrp || 0}</td>
                            <td className="p-2.5 font-medium text-text">₹{discountedPrice.toFixed(2)}</td>
                            <td className="p-2.5 font-bold text-emerald-400 text-right">₹{Math.round(itemTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text"
              >
                Close Preview
              </button>
              <div className="text-right">
                <div className="text-[10px] text-muted">Total Bill Amount</div>
                <div className="text-lg font-extrabold text-amber-400">
                  ₹{(viewInvoice.total_amount || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CRM PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const CRM: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'refills';

  const setTab = (key: string) => setSearchParams({ tab: key });

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex-shrink-0">
        <h1 className="text-lg font-bold text-text">CRM &amp; Messaging</h1>
        <p className="text-xs text-muted mt-0.5">Refills, customer credit ledger &amp; WhatsApp Web</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-bg2 border border-border rounded-xl flex-shrink-0 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === tab.key
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'refills' && <RefillsSection />}
        {activeTab === 'credit' && <CustomerCreditSection />}
        {activeTab === 'messages' && <DistributorMessagesSection />}
        {activeTab === 'whatsapp' && <WhatsAppSection />}
      </div>
    </div>
  );
};

export default CRM;
