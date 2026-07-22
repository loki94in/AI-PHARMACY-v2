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

const WhatsAppSection: React.FC = () => {
  const [status, setStatus] = useState<{ isReady: boolean; qrUrl: string | null; message?: string }>({ isReady: false, qrUrl: null });
  const [chats, setChats] = useState<WaChatItem[]>([]);
  const [activeChat, setActiveChat] = useState<WaChatItem | null>(null);
  const [messages, setMessages] = useState<WaMessageItem[]>([]);
  const [chatSearch, setChatSearch] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [launchingLogin, setLaunchingLogin] = useState(false);

  // New Chat modal/state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkStatus = async () => {

    try {
      const data = await apiClient.get('/messaging/qr').then(res => res.data);
      setStatus(data || { isReady: false, qrUrl: null });
    } catch (err) {
      console.error('Failed to check WhatsApp status:', err);
    }
  };

  const fetchChats = async () => {
    setLoadingChats(true);
    try {
      const data = await apiClient.get('/messaging/chats').then(res => res.data);
      if (Array.isArray(data)) {
        setChats(data);
        if (!activeChat && data.length > 0) {
          setActiveChat(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp chats:', err);
    } finally {
      setLoadingChats(false);
    }
  };

  const fetchMessages = async (chatId: string) => {
    setLoadingMsgs(true);
    try {
      const data = await apiClient.get(`/messaging/chats/${encodeURIComponent(chatId)}/messages`).then(res => res.data);
      if (Array.isArray(data)) {
        setMessages(data);
        setTimeout(scrollToBottom, 100);
      }
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
    } finally {
      setLoadingMsgs(false);
    }
  };

  const [storeSettings, setStoreSettings] = useState<{


    storeName: string;
    storeAddress: string;
    medicalPhones: string[];
    deliveryPhones: string[];
    distributorPhones: string[];
  }>({
    storeName: 'AI Pharmacy',
    storeAddress: '',
    medicalPhones: [],
    deliveryPhones: [],
    distributorPhones: [],
  });

  const fetchStoreSettings = async () => {
    try {
      const [res, profilesRes] = await Promise.all([
        apiClient.get('/settings').then(r => r.data || {}).catch(() => ({})),
        apiClient.get('/distributor-learning/profiles').then(r => Array.isArray(r.data) ? r.data : []).catch(() => [])
      ]);

      const storeName = res.pharmacy_name || res.pharmacyName || res.store_name || 'AI Pharmacy';
      const storeAddress = res.address || res.store_address || '';
      
      const medicalPhones = parseAllPhoneNumbers(
        res.phone, res.phone2, res.store_phone, res.admin_whatsapp, res.dineshWhatsappNumber
      );

      const deliveryPhones = parseAllPhoneNumbers(
        res.delivery_boy_whatsapp, res.delivery_boy_phone, res.delivery_boy_phone_2, res.delivery_boy_whatsapp_2
      );

      // Distributor numbers from Learning Distributors tab + Settings
      const profilePhones = profilesRes.map((p: any) => p.distributor_phone).filter(Boolean);
      const distributorPhones = parseAllPhoneNumbers(
        res.distributor_whatsapp, ...profilePhones
      );

      setStoreSettings({
        storeName,
        storeAddress,
        medicalPhones,
        deliveryPhones,
        distributorPhones
      });
    } catch (err) {
      console.error('Failed to load synced settings & distributor contacts:', err);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchChats();
    fetchStoreSettings();
    const interval = setInterval(() => {
      checkStatus();
      fetchChats();
      fetchStoreSettings();
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeChat) {
      fetchMessages(activeChat.id);
      const msgInterval = setInterval(() => {
        fetchMessages(activeChat.id);
      }, 5000);
      return () => clearInterval(msgInterval);
    }
  }, [activeChat?.id]);

  const handleLaunchLogin = async () => {
    setLaunchingLogin(true);
    try {
      toastEvent.trigger('Opening WhatsApp login page...', 'info');
      await apiClient.post('/messaging/login-window');
      toastEvent.trigger('WhatsApp login window launched in Chrome.', 'success');
      setTimeout(checkStatus, 2000);
    } catch (err: any) {
      console.error('Failed to launch login window:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to open login page', 'error');
    } finally {
      setLaunchingLogin(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeChat) return;

    const textToSend = messageInput.trim();
    const recipientNum = activeChat.resolvedNumber || activeChat.id.split('@')[0];

    setSending(true);
    try {
      await apiClient.post('/messaging/send', { number: recipientNum, message: textToSend });
      toastEvent.trigger('Message sent!', 'success');
      setMessageInput('');
      
      // Append optimistically
      const newMsg: WaMessageItem = {
        id: `temp_${Date.now()}`,
        body: textToSend,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000)
      };
      setMessages(prev => [...prev, newMsg]);
      setTimeout(scrollToBottom, 50);

      // Refresh messages
      await fetchMessages(activeChat.id);
      await fetchChats();
    } catch (err: any) {
      console.error('Failed to send message:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleStartNewChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatPhone.trim()) return;

    let clean = newChatPhone.replace(/\D/g, '');
    if (clean.length === 10) clean = `91${clean}`;
    const chatId = `${clean}@c.us`;

    const newChatItem: WaChatItem = {
      id: chatId,
      name: `+${clean}`,
      unreadCount: 0,
      resolvedNumber: clean
    };

    setChats(prev => [newChatItem, ...prev.filter(c => c.id !== chatId)]);
    setActiveChat(newChatItem);
    setShowNewChatModal(false);
    setNewChatPhone('');
  };

  const applyTemplate = (type: string) => {
    const sName = storeSettings.storeName || 'AI Pharmacy';
    const sAddress = storeSettings.storeAddress || '';
    const medPhonesStr = storeSettings.medicalPhones.join(' / ');
    const delPhonesStr = storeSettings.deliveryPhones.join(' / ');
    const distPhonesStr = storeSettings.distributorPhones.join(' / ');

    let templateMsg = '';
    if (type === 'delivery') {
      templateMsg = `🏥 *${sName}*\n${sAddress ? `📍 Address: ${sAddress}\n` : ''}${delPhonesStr ? `🛵 Delivery Contact: ${delPhonesStr}\n` : ''}${medPhonesStr ? `📞 Medical Contact: ${medPhonesStr}` : ''}`;
    } else if (type === 'refill') {
      templateMsg = `🏥 *${sName}*\nHello! This is a reminder from ${sName} that your monthly medicine refill is due. Please contact us to confirm.\n${medPhonesStr ? `📞 Medical Contact: ${medPhonesStr}` : ''}`;
    } else if (type === 'order') {
      templateMsg = `🏥 *${sName}*\nYour medicine order has been packed and is ready for pickup/delivery!\n${sAddress ? `📍 Address: ${sAddress}\n` : ''}${delPhonesStr ? `🛵 Delivery Contact: ${delPhonesStr}\n` : ''}${medPhonesStr ? `📞 Medical Contact: ${medPhonesStr}` : ''}`;
    } else if (type === 'distributor') {
      templateMsg = `🏥 *${sName}* — Order Query\nHello, please confirm stock availability and supply for our order.\n${distPhonesStr ? `🏬 Distributor Contacts: ${distPhonesStr}\n` : ''}${medPhonesStr ? `📞 Medical Contact: ${medPhonesStr}` : ''}`;
    } else {
      templateMsg = type;
    }

    setMessageInput(templateMsg.trim());
  };




  const filteredChats = chats.filter(c => 
    c.name.toLowerCase().includes(chatSearch.toLowerCase()) || 
    (c.resolvedNumber && c.resolvedNumber.includes(chatSearch)) ||
    (c.lastMessage && c.lastMessage.toLowerCase().includes(chatSearch.toLowerCase()))
  );

  const formatTimestamp = (ts?: number) => {
    if (!ts) return '';
    const date = new Date(ts * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg2 rounded-xl border border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-400">
            <MessageCircle size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-text uppercase tracking-wider">WhatsApp Live Chat Hub</h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                status.isReady 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {status.isReady ? 'Active & Connected' : 'Login Required'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchChats}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg3 border border-border rounded-lg text-xs font-medium text-text hover:bg-bg transition-colors"
            title="Refresh chats"
          >
            <RefreshCw size={13} className={loadingChats ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg3 border border-border rounded-lg text-xs font-medium text-text hover:bg-bg transition-colors"
          >
            <Send size={13} />
            + New Chat
          </button>
          <button
            onClick={handleLaunchLogin}
            disabled={launchingLogin}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
          >
            <Zap size={13} />
            {launchingLogin ? 'Opening...' : 'Link Account'}
          </button>
        </div>
      </div>

      {/* Main WhatsApp Workspace UI */}
      <div className="flex flex-1 min-h-0 bg-bg2 rounded-xl border border-border overflow-hidden">
        {/* Left Chat List Sidebar */}
        <div className="w-80 flex flex-col border-r border-border bg-bg2/60 flex-shrink-0">
          {/* Search Bar */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search chats or phone numbers..."
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-bg3 border border-border rounded-lg text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/50">
            {loadingChats && chats.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted">Loading WhatsApp chats...</div>
            ) : filteredChats.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted">
                {chats.length === 0 ? 'No active chats found. Start a new chat above!' : 'No chats match search filter.'}
              </div>
            ) : (
              filteredChats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => setActiveChat(chat)}
                  className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                    activeChat?.id === chat.id
                      ? 'bg-primary/10 border-l-2 border-l-primary'
                      : 'hover:bg-bg3/50'
                  }`}
                >
                  {/* Contact Avatar */}
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs flex-shrink-0 border border-emerald-500/30">
                    {(chat.name || 'W')[0].toUpperCase()}
                  </div>

                  {/* Contact Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-text truncate">{chat.name}</h4>
                      {chat.timestamp && (
                        <span className="text-[10px] text-muted flex-shrink-0">{formatTimestamp(chat.timestamp)}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {chat.lastMessage || 'No recent messages'}
                    </p>
                  </div>

                  {/* Unread badge */}
                  {chat.unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 bg-emerald-500 text-white rounded-full text-[10px] font-bold">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Active Chat Thread */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg">
          {activeChat ? (
            <>
              {/* Chat Thread Header */}
              <div className="flex items-center justify-between p-3.5 border-b border-border bg-bg2 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">
                    {(activeChat.name || 'W')[0].toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-text">{activeChat.name}</h3>
                    <p className="text-[10px] text-muted">{activeChat.resolvedNumber ? `+${activeChat.resolvedNumber}` : activeChat.id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-emerald-400 font-semibold px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                    In-App WhatsApp Session Active
                  </span>
                </div>

              </div>

              {/* Chat Message History Stream */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 bg-bg/50">
                {loadingMsgs && messages.length === 0 ? (
                  <div className="m-auto text-xs text-muted">Loading conversation history...</div>
                ) : messages.length === 0 ? (
                  <div className="m-auto text-center text-xs text-muted max-w-xs">
                    No recorded messages in this chat yet. Type a message below to start the conversation!
                  </div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[70%] ${
                        msg.fromMe ? 'ml-auto items-end' : 'mr-auto items-start'
                      }`}
                    >
                      <div
                        className={`p-3 rounded-2xl text-xs leading-relaxed break-words ${
                          msg.fromMe
                            ? 'bg-emerald-600 text-white rounded-br-none shadow-sm'
                            : 'bg-bg2 text-text border border-border rounded-bl-none shadow-sm'
                        }`}
                      >
                        {msg.body}
                      </div>
                      <span className="text-[10px] text-muted px-1 mt-1">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Template Chips */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg2 border-t border-border flex-shrink-0 overflow-x-auto">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex-shrink-0">Quick Templates:</span>
                {[
                  { label: '🚚 Delivery Alert', id: 'delivery' },
                  { label: '💊 Refill Reminder', id: 'refill' },
                  { label: '📦 Order Packed', id: 'order' },
                  { label: '🏬 Distributor Query', id: 'distributor' },
                ].map((tpl, i) => (

                  <button
                    key={i}
                    type="button"
                    onClick={() => applyTemplate(tpl.id)}
                    className="px-2.5 py-1 bg-bg3 border border-border hover:bg-emerald-500/20 hover:border-emerald-500/40 rounded-full text-[11px] font-medium text-text flex-shrink-0 transition-colors"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>


              {/* Message Composer Bar */}
              <form onSubmit={handleSendMessage} className="p-3 bg-bg2 border-t border-border flex items-center gap-2 flex-shrink-0">
                <textarea
                  rows={1}
                  placeholder="Type a WhatsApp message..."
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  className="flex-1 px-3.5 py-2 bg-bg3 border border-border rounded-xl text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary resize-none"
                />
                <button
                  type="submit"
                  disabled={sending || !messageInput.trim()}
                  className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-sm transition-colors disabled:opacity-40 flex-shrink-0"
                  title="Send message"
                >
                  <Send size={15} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
              <div className="p-3 bg-bg2 rounded-full text-muted">
                <MessageSquare size={36} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">No Chat Selected</h3>
                <p className="text-xs text-muted mt-1">Select a conversation from the left sidebar or click + New Chat to message a patient.</p>
              </div>
              <button
                onClick={() => setShowNewChatModal(true)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-500 shadow-sm"
              >
                + Start New WhatsApp Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-text">Start New WhatsApp Conversation</h3>
              <button onClick={() => setShowNewChatModal(false)} className="text-muted hover:text-text">✕</button>
            </div>

            <form onSubmit={handleStartNewChat} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text">Patient Mobile Number</label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2 bg-bg3 border border-border rounded-lg text-xs font-semibold text-text">+91</span>
                  <input
                    type="tel"
                    placeholder="Enter 10-digit mobile number"
                    value={newChatPhone}
                    onChange={e => setNewChatPhone(e.target.value)}
                    className="flex-1 px-3 py-2 bg-bg3 border border-border rounded-lg text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="px-4 py-2 bg-bg3 border border-border rounded-lg text-xs font-medium text-text hover:bg-bg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm"
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
