import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../services/api';
import {
  RefreshCw, Send, Users, MessageSquare, Phone, Calendar,
  CheckCircle2, AlertCircle, Clock, Search, Repeat2, Bell,
  MessageCircle, Check, Package, Mail, ExternalLink, LogOut, Zap
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
  const [templates, setTemplates] = useState<WaMessageTemplate[]>([]);
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);

  // Template form state
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [tmplName, setTmplName] = useState('');
  const [tmplCategory, setTmplCategory] = useState('General');
  const [tmplBody, setTmplBody] = useState('');
  const [savingTmpl, setSavingTmpl] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load WhatsApp status
  const checkStatus = useCallback(async () => {
    try {
      const res = await apiClient.get<{ isReady: boolean }>('/messaging/qr');
      setIsReady(res.data.isReady);
    } catch {
      setIsReady(false);
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
  }, [checkStatus, loadChats, loadTemplates]);

  // Load Thread Messages when activeChat changes
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
      .then(res => {
        setMessages(Array.isArray(res.data) ? res.data : []);
        setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .catch(() => toastEvent.trigger('Failed to load message history', 'error', '/crm'))
      .finally(() => setLoadingMessages(false));
  }, [activeChat]);

  // SSE event listener for real-time messages
  useEffect(() => {
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wa_new_message') {
          const newMsg: WaMessageItem = data.payload.message;
          const chatId: string = data.payload.chat_id;

          if (activeChat && activeChat.id === chatId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          }
          // Refresh chats list preview
          loadChats();
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
    setSending(true);

    try {
      await apiClient.post('/messaging/send', {
        number: recipient,
        message: composerText.trim(),
        file: attachedFile || undefined
      });
      setComposerText('');
      setAttachedFile(null);
      toastEvent.trigger('Message sent via WhatsApp', 'success', '/crm');
    } catch (err: any) {
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
      {/* Top Controls: Mode Toggle & Live WhatsApp Launcher */}
      <div className="flex items-center justify-between gap-3 bg-bg2 p-2 rounded-2xl border border-border shadow-sm shrink-0">
        <div className="flex items-center gap-1.5 bg-bg3/60 p-1 rounded-xl border border-glass-border/40 text-xs font-bold select-none">
          <button
            onClick={() => setViewMode('live_web')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              viewMode === 'live_web'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
            }`}
          >
            <MessageCircle size={14} className="text-emerald-400" />
            <span>Live WhatsApp Web</span>
          </button>
          <button
            onClick={() => setViewMode('crm_chats')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              viewMode === 'crm_chats'
                ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
            }`}
          >
            <MessageSquare size={14} />
            <span>CRM History & Inquiries</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
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

      {/* WhatsApp Disconnected Banner */}
      {!isReady && (
        <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} />
            <span>WhatsApp session is initializing or disconnected. Click to launch or reconnect.</span>
          </div>
          <button
            onClick={async () => {
              try {
                toastEvent.trigger('Launching WhatsApp login window...', 'info');
                await apiClient.post('/messaging/login-window');
              } catch (err: any) {
                toastEvent.trigger(err?.response?.data?.error || 'Failed to launch login window', 'error');
              }
            }}
            className="flex items-center gap-1 font-bold underline hover:text-amber-300 transition-all text-xs"
          >
            <span>Launch Login Window</span>
            <ExternalLink size={12} />
          </button>
        </div>
      )}

      {/* Main Interface: Live WhatsApp Web vs CRM History */}
      {viewMode === 'live_web' ? (
        <div className="flex-1 min-h-0 bg-bg border border-border rounded-2xl overflow-hidden relative flex flex-col shadow-sm">
          <iframe
            src="https://web.whatsapp.com"
            className="w-full h-full border-0 flex-1 min-h-[550px]"
            title="Live WhatsApp Web Interface"
            allow="camera; microphone; clipboard-read; clipboard-write; notifications"
          />
        </div>
      ) : (
        /* Main Chat Grid Interface */
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
          {/* Left: Chat List Panel (4 cols) */}
          <div className="md:col-span-4 border-r border-border flex flex-col bg-bg3/40 min-h-0">
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
              <div className="p-8 text-center text-xs text-muted">No WhatsApp chats found.</div>
            ) : (
              filteredChats.map(c => {
                const isActive = activeChat?.id === c.id;
                const displayName = c.name || c.resolvedNumber || c.id.split('@')[0];
                const initial = displayName.charAt(0).toUpperCase();

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
                        <h4 className="text-xs font-bold text-text truncate">{displayName}</h4>
                        {c.timestamp && (
                          <span className="text-[10px] text-muted">{formatTs(c.timestamp)}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted truncate mt-0.5">
                        {c.lastMessage || 'No messages yet'}
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

        {/* Right: Active Chat Thread & Composer (8 cols) */}
        <div className="md:col-span-8 flex flex-col min-h-0 bg-bg">
          {activeChat ? (
            <>
              {/* Thread Header */}
              <div className="p-3 border-b border-border bg-bg2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">
                    {(activeChat.name || activeChat.id).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-text">
                      {activeChat.name || activeChat.resolvedNumber || activeChat.id.split('@')[0]}
                    </h3>
                    <p className="text-[10px] text-muted">
                      {activeChat.resolvedNumber || activeChat.id}
                    </p>
                  </div>
                </div>
              </div>

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
                          className={`max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                            isOut
                              ? 'bg-primary text-white rounded-br-none'
                              : 'bg-bg2 border border-border text-text rounded-bl-none'
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          {m.hasMedia && (
                            <div className="mt-1 pt-1 border-t border-white/20 text-[10px] opacity-80 flex items-center gap-1">
                              <span>📁 Media Attachment</span>
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
      )}

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
        <p className="text-xs text-muted mt-0.5">Refills, distributor alerts &amp; WhatsApp Web</p>
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
        {activeTab === 'messages' && <DistributorMessagesSection />}
        {activeTab === 'whatsapp' && <WhatsAppSection />}
      </div>
    </div>
  );
};

export default CRM;
