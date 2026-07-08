import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Image,
  Phone,
  Clock,
  EyeOff,
  Eye,
  Search,
  RefreshCw,
  ChevronRight,
  Pill,
  User,
  Package,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Sparkles,
  Store
} from 'lucide-react';

// Module-level cache for instant re-render on page switch (SPA performance contract)
let cachedMessages: any[] = [];
let cachedIgnored: Set<string> = new Set();

export default function MessageListener() {
  const [messages, setMessages] = useState<any[]>(cachedMessages);
  const [ignoredPhones, setIgnoredPhones] = useState<Set<string>>(cachedIgnored);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/messaging/chats');
      if (res.ok) {
        const data = await res.json();
        const chats = Array.isArray(data) ? data : data.chats || [];
        cachedMessages = chats;
        setMessages(chats);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
    setLoading(false);
  }, []);

  const fetchIgnoredPhones = useCallback(async () => {
    try {
      const res = await fetch('/api/messaging/ignored-phones');
      if (res.ok) {
        const data = await res.json();
        const set = new Set<string>(Array.isArray(data) ? data.map((r: any) => r.phone) : []);
        cachedIgnored = set;
        setIgnoredPhones(set);
      }
    } catch {
      // Table may not have API yet — will be added
    }
  }, []);

  useEffect(() => {
    if (cachedMessages.length === 0) fetchMessages();
    fetchIgnoredPhones();

    // Listen for SSE events for live updates
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wa_new_message') {
          fetchMessages();
        }
        if (data.type === 'wa_medicine_match') {
          setSelectedMatch(data.payload);
        }
      } catch {}
    };
    return () => evtSource.close();
  }, [fetchMessages, fetchIgnoredPhones]);

  const toggleIgnore = useCallback(async (phone: string) => {
    const isCurrentlyIgnored = ignoredPhones.has(phone);
    try {
      await fetch('/api/messaging/toggle-ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, ignore: !isCurrentlyIgnored })
      });
      setIgnoredPhones(prev => {
        const next = new Set(prev);
        if (isCurrentlyIgnored) next.delete(phone);
        else next.add(phone);
        cachedIgnored = next;
        return next;
      });
    } catch (err) {
      console.error('Failed to toggle ignore:', err);
    }
  }, [ignoredPhones]);

  const filtered = messages.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (m.name || '').toLowerCase().includes(s) ||
           (m.id || '').includes(s) ||
           (m.last_message || '').toLowerCase().includes(s);
  });

  const formatTime = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  return (
    <div className="flex h-full gap-4">
      {/* Left panel: Message list */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-text">WhatsApp Messages</h1>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {messages.length}
            </span>
          </div>
          <button
            onClick={fetchMessages}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg2 text-muted hover:text-text text-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg2 border border-border text-text text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map(chat => {
            const phone = (chat.id || '').replace(/@c\.us$/, '');
            const isIgnored = ignoredPhones.has(phone) || ignoredPhones.has(chat.id);
            const isGroup = chat.is_group === 1;

            return (
              <div
                key={chat.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${
                  isIgnored
                    ? 'bg-bg2/50 border-border/50 opacity-60'
                    : 'bg-bg2 border-border hover:border-primary/30 hover:bg-glass-bg'
                }`}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isGroup ? 'bg-blue-500/10 text-blue-400' : 'bg-primary/10 text-primary'
                }`}>
                  {isGroup ? <MessageSquare className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text truncate">
                      {chat.name || phone}
                    </span>
                    {chat.unread_count > 0 && (
                      <span className="bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                        {chat.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted truncate mt-0.5">
                    {chat.last_message || 'No messages'}
                  </p>
                </div>

                {/* Time + actions */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[10px] text-muted">{formatTime(chat.timestamp)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleIgnore(phone); }}
                    className={`p-1 rounded transition-colors ${
                      isIgnored
                        ? 'text-red-400 hover:bg-red-500/10'
                        : 'text-muted hover:text-text hover:bg-bg3'
                    }`}
                    title={isIgnored ? 'Click to start scanning' : 'Click to ignore this number'}
                  >
                    {isIgnored ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && !loading && (
            <div className="text-center text-muted text-sm py-12">
              No messages found
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Admin Match View (inline) */}
      {selectedMatch && (
        <div className="w-[420px] flex-shrink-0 bg-bg2 rounded-xl border border-border p-4 overflow-y-auto">
          <AdminMatchPanel match={selectedMatch} onClose={() => setSelectedMatch(null)} />
        </div>
      )}
    </div>
  );
}

/** Inline admin match panel for the right side */
function AdminMatchPanel({ match, onClose }: { match: any; onClose: () => void }) {
  const { customer, isNewCustomer, medicineName, quantity, unit, localMatches, catalogResults, confidence, isRepeat, messageBody, history } = match;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-bold text-text">Medicine Match</h2>
        </div>
        <button onClick={onClose} className="text-muted hover:text-text p-1 rounded hover:bg-bg3">
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Customer */}
      <div className="bg-bg3 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-muted" />
          <span className="text-xs font-medium text-muted uppercase tracking-wide">Customer</span>
        </div>
        {customer ? (
          <div className="text-sm text-text font-medium">{customer.name} <span className="text-muted">({customer.phone})</span></div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full text-xs font-medium">🆕 New Customer</span>
          </div>
        )}
      </div>

      {/* Message context */}
      {messageBody && (
        <div className="bg-bg3 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-muted" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Message</span>
          </div>
          <p className="text-sm text-text italic">"{messageBody}"</p>
        </div>
      )}

      {/* Detected medicine */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Pill className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wide">Detected Medicine</span>
        </div>
        <div className="text-sm text-text font-bold">{medicineName}</div>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted">
          {quantity > 0 && <span>Qty: <strong className="text-text">{quantity} {unit}</strong></span>}
          {confidence > 0 && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              confidence >= 90 ? 'bg-green-500/10 text-green-400' :
              confidence >= 70 ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400'
            }`}>
              {Math.round(confidence)}% confidence
            </span>
          )}
          {isRepeat && <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-medium">Repeat Order</span>}
        </div>
      </div>

      {/* Local matches */}
      {localMatches?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Local DB Matches</span>
          </div>
          <div className="space-y-1">
            {localMatches.slice(0, 5).map((name: string, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-bg3 text-sm text-text">
                <Pill className="w-3 h-3 text-muted" />
                {name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mapped distributors */}
      {catalogResults?.mapped?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Mapped Distributors ✅</span>
          </div>
          <div className="space-y-1">
            {catalogResults.mapped.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs">
                <div className="text-text">{p.name || p.distributor}</div>
                <div className="text-muted">
                  {p.mrp && <span>MRP ₹{p.mrp}</span>}
                  {p.distributorPrice && <span className="ml-2">PTR ₹{p.distributorPrice}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-mapped distributors */}
      {catalogResults?.nonMapped?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Non-Mapped Distributors</span>
          </div>
          <div className="space-y-1">
            {catalogResults.nonMapped.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs opacity-80">
                <div className="text-text">{p.name || p.distributor}</div>
                <div className="text-muted">
                  {p.mrp && <span>MRP ₹{p.mrp}</span>}
                  {p.distributorPrice && <span className="ml-2">PTR ₹{p.distributorPrice}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer history */}
      {history?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Purchase History</span>
          </div>
          <div className="space-y-1">
            {history.slice(0, 5).map((h: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs">
                <span className="text-text">{h.medicine_name}</span>
                <span className="text-muted">{h.last_dispensed?.split('T')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-sm font-medium transition-colors">
          <CheckCircle className="w-4 h-4" />
          Confirm
        </button>
        <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bg3 text-muted hover:text-text text-sm font-medium transition-colors">
          ✏️ Correct
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg bg-bg3 text-muted hover:text-red-400 text-sm transition-colors"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
