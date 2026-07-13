import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Store,
  X
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import AdminMatchPanel from '../../components/AdminMatchPanel';

// Module-level cache for instant re-render on page switch (SPA performance contract)
let cachedMessages: any[] = [];
let cachedIgnored: Map<string, string> = new Map();
let cachedActiveChat: any = null;
let cachedChatMessages: any[] = [];

export default function MessageListener() {
  const [messages, setMessages] = useState<any[]>(cachedMessages);
  const [ignoredPhones, setIgnoredPhones] = useState<Map<string, string>>(cachedIgnored);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [pendingReviews, setPendingReviews] = useState<any[]>([]);
  
  // Chat thread states
  const [activeChat, setActiveChat] = useState<any>(() => cachedActiveChat);
  const [chatMessages, setChatMessages] = useState<any[]>(() => cachedChatMessages);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [showIgnoreModal, setShowIgnoreModal] = useState(false);
  const [newIgnorePhone, setNewIgnorePhone] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef<any>(null);

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    toastEvent.trigger(msg, type, '/message-listener');
  };

  const handleAddIgnore = async () => {
    let clean = newIgnorePhone.trim();
    if (!clean) return;

    // Sanitize phone input
    if (!clean.endsWith('@g.us') && !clean.endsWith('@broadcast') && !clean.endsWith('@c.us') && !clean.endsWith('@lid')) {
      const digits = clean.replace(/\D/g, '');
      if (digits.length === 10) {
        clean = `91${digits}@c.us`;
      } else if (digits.length > 10) {
        clean = `${digits}@c.us`;
      }
    }

    try {
      await api.toggleIgnore(clean, true);
      // Re-fetch from DB to get the accurate list (avoids optimistic-update bugs)
      await fetchIgnoredPhones();
      setNewIgnorePhone('');
      showNotif(`Added ${clean} to ignore list`);
    } catch (err) {
      console.error('Failed to manually ignore phone:', err);
      showNotif('Failed to ignore number', 'error');
    }
  };

  useEffect(() => {
    activeChatRef.current = activeChat;
    cachedActiveChat = activeChat;
  }, [activeChat]);

  useEffect(() => {
    cachedChatMessages = chatMessages;
    if (chatMessages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [chatMessages]);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const chats = await api.getWhatsappChats();
      cachedMessages = chats;
      setMessages(chats);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
    setLoading(false);
  }, []);

  const fetchIgnoredPhones = useCallback(async () => {
    try {
      const data = await api.getIgnoredPhones();
      const map = new Map<string, string>(
        Array.isArray(data) ? data.map((r: any) => [r.phone, r.reason]) : []
      );
      cachedIgnored = map;
      setIgnoredPhones(map);
    } catch {
      // Table may not have API yet — will be added
    }
  }, []);

  const selectChat = useCallback(async (chat: any) => {
    setActiveChat(chat);
    setMessagesLoading(true);
    try {
      const data = await api.getWhatsappMessages(chat.id);
      setChatMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
    }
    setMessagesLoading(false);
  }, []);

  const fetchPendingReviews = useCallback(async () => {
    try {
      const data = await api.getPendingWhatsappReviews();
      if (data && data.success && Array.isArray(data.reviews)) {
        setPendingReviews(data.reviews);
      }
    } catch (err) {
      console.error('Failed to fetch pending WhatsApp reviews:', err);
    }
  }, []);

  useEffect(() => {
    if (cachedMessages.length === 0) fetchMessages();
    fetchIgnoredPhones();
    fetchPendingReviews();

    // Silently refresh active chat messages on mount if present
    if (cachedActiveChat) {
      api.getWhatsappMessages(cachedActiveChat.id)
        .then(msgs => setChatMessages(Array.isArray(msgs) ? msgs : []))
        .catch(console.error);
    }

    // Listen for SSE events for live updates
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wa_new_message') {
          fetchMessages();
          if (activeChatRef.current && activeChatRef.current.id === data.payload?.chat_id) {
            // Silently append/update messages for the active chat thread
            api.getWhatsappMessages(activeChatRef.current.id)
              .then(msgs => setChatMessages(Array.isArray(msgs) ? msgs : []))
              .catch(console.error);
          }
        }
        if (data.type === 'wa_medicine_match') {
          setSelectedMatch(data.payload);
          fetchPendingReviews();
        }
        if (data.type === 'catalog_review_updated') {
          fetchPendingReviews();
        }
      } catch {}
    };
    return () => evtSource.close();
  }, [fetchMessages, fetchIgnoredPhones, fetchPendingReviews]);

  const toggleIgnore = useCallback(async (phone: string, currentIgnored: boolean) => {
    try {
      await api.toggleIgnore(phone, !currentIgnored);
      // Re-fetch from DB to get the accurate list
      await fetchIgnoredPhones();
      showNotif(currentIgnored ? `Scanning ${phone}` : `Ignored ${phone}`);

      // If we are ignoring the active chat, close it
      if (!currentIgnored && activeChat && activeChat.id === phone) {
        setActiveChat(null);
        setChatMessages([]);
      }
      
      // Refresh chat list to remove the ignored chat from the database view
      fetchMessages();
    } catch (err) {
      console.error('Failed to toggle ignore:', err);
      showNotif('Failed to update ignore status', 'error');
    }
  }, [fetchIgnoredPhones, fetchMessages, activeChat]);

  const filtered = messages.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (m.name || '').toLowerCase().includes(s) ||
           (m.id || '').includes(s) ||
           (m.lastMessage || '').toLowerCase().includes(s);
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

  const formatDividerDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      if (date.getFullYear() === today.getFullYear()) {
        return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      }
      return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    }
  };

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      
      {/* Left panel: Message list */}
      <div className="w-[320px] shrink-0 bg-glass-bg border border-glass-border rounded-2xl flex flex-col min-h-0 overflow-hidden p-4 gap-3">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h1 className="text-sm font-bold text-text uppercase tracking-wider">Chats</h1>
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
              {messages.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowIgnoreModal(true)}
              className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text hover:bg-bg3 transition-colors flex items-center justify-center shrink-0"
              title="Manage Ignore List"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={fetchMessages}
              disabled={loading}
              className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text hover:bg-bg3 transition-colors"
              title="Refresh Chats"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-bg2 border border-glass-border text-text text-xs placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        {/* Chats list */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {filtered.map(chat => {
            const phone = (chat.id || '').replace(/@c\.us$/, '');
            const chatId = chat.id || '';

            // Calculate current ignore status (groups and broadcasts ignore by default)
            let isIgnored = false;
            const explicitReason = ignoredPhones.get(phone) || ignoredPhones.get(chatId);
            if (explicitReason !== undefined) {
              isIgnored = explicitReason !== 'unignored';
            } else {
              const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
              isIgnored = isGroupOrBroadcast;
            }
            const isGroup = !!chat.isGroup;

            return (
              <div
                key={chat.id}
                onClick={() => {
                  if (isIgnored) {
                    showNotif('This chat is ignored. Uncheck the checkbox to scan and open it.', 'error');
                    return;
                  }
                  selectChat(chat);
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                  activeChat?.id === chat.id
                    ? 'bg-primary/10 border-primary/30 shadow-sm'
                    : isIgnored
                    ? 'bg-bg2/30 border-glass-border/30 opacity-60'
                    : 'bg-bg2/70 border-glass-border/50 hover:border-primary/20 hover:bg-bg3'
                }`}
              >
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isGroup ? 'bg-blue-500/10 text-blue-400' : 'bg-primary/10 text-primary'
                }`}>
                  {isGroup ? <MessageSquare className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-text truncate">
                      {chat.name || phone}
                    </span>
                    {chat.unreadCount > 0 && (
                      <span className="bg-primary text-white text-[9px] px-1.5 py-0.2 rounded-full font-bold">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted truncate mt-0.5">
                    {chat.lastMessage || 'No messages'}
                  </p>
                </div>

                {/* Time + actions */}
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <span className="text-[9px] text-muted">{formatTime(chat.timestamp)}</span>
                  <input
                    type="checkbox"
                    checked={isIgnored}
                    onChange={() => toggleIgnore(chatId || phone, isIgnored)}
                    className="w-3.5 h-3.5 rounded border-glass-border bg-bg3 text-primary focus:ring-0 cursor-pointer transition-colors"
                    title={isIgnored ? 'Ignored (Uncheck to scan)' : 'Scanning (Check to ignore)'}
                  />
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && !loading && (
            <div className="text-center text-muted text-xs py-12">
              No chats found
            </div>
          )}
        </div>
      </div>

      {/* Middle panel: Message thread details */}
      <div className="flex-1 bg-glass-bg border border-glass-border rounded-2xl flex flex-col min-h-0 overflow-hidden">
        {activeChat ? (
          <>
            {/* Thread Header */}
            <div className="p-3 border-b border-glass-border bg-bg3 flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 rounded-full bg-bg2 flex items-center justify-center">
                <User size={16} className="text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-xs text-text truncate">{activeChat.name}</h3>
                <p className="text-[9px] text-muted truncate">{activeChat.id}</p>
              </div>
              <button onClick={() => setActiveChat(null)} className="p-1.5 hover:bg-bg2 rounded-full text-muted">
                <X size={14} />
              </button>
            </div>

            {/* Messages Pane */}
            <div className="flex-1 flex flex-col-reverse overflow-y-auto p-4 gap-3 bg-bg2/30 custom-scrollbar">
              {messagesLoading ? (
                <div className="text-center text-muted text-xs py-4 flex flex-col items-center justify-center h-full gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted/60" />
                  <span>Loading messages...</span>
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted h-full gap-3">
                  <Clock className="w-10 h-10 text-muted/20 animate-pulse" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-text">No Message History Cached</p>
                    <p className="text-[10px] text-muted max-w-[240px] leading-relaxed mx-auto">
                      Only new incoming and outgoing messages are stored. Previous history is not synced.
                    </p>
                  </div>
                  {activeChat?.lastMessage && (
                    <div className="mt-2 p-3 bg-bg3 border border-glass-border rounded-xl text-left max-w-xs text-xs shadow-sm w-full">
                      <span className="text-[9px] font-bold text-primary uppercase tracking-wider block mb-1">Last Received Message:</span>
                      <p className="italic text-text font-medium">"{activeChat.lastMessage}"</p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div ref={messagesEndRef} />
                  {[...chatMessages].reverse().map((msg, idx, arr) => {
                    const prevMsg = arr[idx + 1];
                    const showDateDivider = !prevMsg || 
                      new Date(msg.timestamp * 1000).toDateString() !== new Date(prevMsg.timestamp * 1000).toDateString();

                    return (
                      <React.Fragment key={msg.id || idx}>
                        <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-xl p-2.5 text-xs shadow-sm relative border ${
                            msg.fromMe 
                              ? 'bg-primary/10 text-text border-primary/20 rounded-tr-none' 
                              : 'bg-bg3 text-text border-glass-border rounded-tl-none'
                          }`}>
                            <span className="whitespace-pre-wrap">{msg.body}</span>
                            <div className="text-[8px] text-muted mt-1 text-right float-right ml-3 pt-0.5 select-none">
                              {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                        {showDateDivider && (
                          <div className="flex justify-center my-2">
                            <span className="bg-bg3 border border-glass-border px-3 py-1 rounded-full text-[9px] font-bold text-muted uppercase tracking-wider select-none shadow-sm">
                              {formatDividerDate(msg.timestamp)}
                            </span>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </div>
          </>
        ) : (
          /* Placeholder */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted">
            <MessageSquare className="w-12 h-12 text-muted/20 mb-3 animate-pulse" />
            <h3 className="font-bold text-xs text-text mb-1">No Chat Selected</h3>
            <p className="text-[11px] max-w-[280px]">Select a chat on the left to start viewing messages.</p>
          </div>
        )}
      </div>

      {/* Right panel: Matches & Pending WhatsApp Approvals */}
      {(selectedMatch || pendingReviews.length > 0) && (
        <div className="w-[420px] flex-shrink-0 bg-glass-bg border border-glass-border rounded-2xl flex flex-col min-h-0 overflow-hidden p-4 gap-3">
          {selectedMatch ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <AdminMatchPanel match={selectedMatch} onClose={() => setSelectedMatch(null)} onSuccess={showNotif} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-2 border-b border-glass-border shrink-0">
                <div className="flex items-center gap-2">
                  <Pill className="w-5 h-5 text-primary" />
                  <h2 className="text-sm font-bold text-text uppercase tracking-wider">Pending Approvals</h2>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                    {pendingReviews.length}
                  </span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 mt-3 pr-1 custom-scrollbar">
                {pendingReviews.map((review) => {
                  const data = review.original_row_data || {};
                  const topMatches = data.topMatches || [];

                  return (
                    <div key={review.id} className="bg-bg3/60 border border-glass-border/40 rounded-xl p-3.5 space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-text truncate">{review.medicine_name}</h4>
                          <p className="text-[9px] text-muted truncate mt-0.5">
                            Query: "{review.search_query}" • Customer: {data.customerName || 'New'} ({data.customerPhone?.replace('@c.us', '') || 'Unknown'})
                          </p>
                        </div>
                        <span className="text-[8px] bg-purple/10 text-purple border border-purple/20 px-1.5 py-0.5 rounded-full font-bold uppercase select-none shrink-0">
                          Review #{review.id}
                        </span>
                      </div>

                      {topMatches.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="text-[8px] font-bold text-muted uppercase tracking-wider block">PharmaRack Matches</span>
                          {topMatches.slice(0, 3).map((match: any, mIdx: number) => (
                            <div key={mIdx} className="flex justify-between items-center bg-bg/50 border border-glass-border/30 rounded-lg p-2 text-[10px]">
                              <div className="min-w-0 pr-2">
                                <span className="font-semibold text-text truncate block">{match.name}</span>
                                <span className="text-muted block text-[8px] truncate">{match.distributor} • {match.packaging}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-text font-bold">₹{match.mrp}</span>
                                <button
                                  onClick={async () => {
                                    try {
                                      await api.approveCatalogReview(review.id, {
                                        name: match.name,
                                        packaging: match.packaging,
                                        manufacturer: match.manufacturer || '',
                                        mrp: match.mrp
                                      });
                                      showNotif('Approved medicine and added to database');
                                    } catch (err) {
                                      console.error('Approve failed:', err);
                                      showNotif('Failed to approve review', 'error');
                                    }
                                  }}
                                  className="px-2 py-1 bg-green hover:bg-emerald-600 text-white font-extrabold rounded-lg text-[9px] uppercase tracking-wider transition-colors active:scale-95"
                                >
                                  Approve
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted italic bg-bg/30 p-2 rounded-lg text-center">
                          No matches returned from PharmaRack.
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2 border-t border-glass-border/30">
                        <button
                          onClick={async () => {
                            try {
                              await api.rejectCatalogReview(review.id);
                              showNotif('Rejected and removed from queue');
                            } catch (err) {
                              console.error('Reject failed:', err);
                              showNotif('Failed to reject review', 'error');
                            }
                          }}
                          className="px-2.5 py-1 hover:bg-red-500/10 text-muted hover:text-red-400 font-bold rounded-lg text-[10px] transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ignore List Manager Modal */}
      {showIgnoreModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-primary animate-pulse" />
                <h3 className="font-bold text-xs text-text uppercase tracking-wider">Manage Ignore List</h3>
              </div>
              <button 
                onClick={() => {
                  setShowIgnoreModal(false);
                  setNewIgnorePhone('');
                }}
                className="text-muted hover:text-text hover:bg-bg2 p-1 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add Ignore Form */}
            <div className="p-4 border-b border-glass-border bg-bg2/40 shrink-0">
              <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">
                Ignore New Number or Group ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or group ID"
                  value={newIgnorePhone}
                  onChange={(e) => setNewIgnorePhone(e.target.value)}
                  className="flex-1 bg-bg3 border border-glass-border rounded-lg px-3 py-1.5 text-xs text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddIgnore()}
                />
                <button
                  type="button"
                  onClick={handleAddIgnore}
                  className="bg-primary/20 hover:bg-primary/30 border border-primary/20 text-primary text-xs font-bold px-4 py-1.5 rounded-lg transition-colors shrink-0"
                >
                  Ignore
                </button>
              </div>
              <p className="text-[9px] text-muted mt-1.5 leading-relaxed">
                Tip: 10-digit phone numbers will be automatically formatted (e.g., adding country prefix 91 and @c.us suffix).
              </p>
            </div>

            {/* List of ignored numbers */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-2">
                Currently Ignored ({ignoredPhones.size})
              </span>
              {Array.from(ignoredPhones.entries()).map(([phone, status]) => {
                const isExplicitUnignored = status === 'unignored';
                const isGroup = phone.endsWith('@g.us') || phone.includes('-');
                
                return (
                  <div 
                    key={phone} 
                    className="flex justify-between items-center bg-bg3/60 border border-glass-border/30 rounded-xl p-2.5 hover:bg-bg3 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text truncate">{phone}</p>
                      <p className="text-[8px] text-muted font-mono uppercase mt-0.5">
                        {isGroup ? 'Group Chat' : 'Individual'} • {isExplicitUnignored ? 'Scanning Allowed (Override)' : 'Muted'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleIgnore(phone, !isExplicitUnignored)}
                      className="text-xs font-semibold px-2 py-1 rounded bg-red/10 text-red-400 hover:bg-red/20 transition-all uppercase tracking-wider text-[9px] shrink-0"
                      title={isExplicitUnignored ? 'Mute' : 'Allow Scanning'}
                    >
                      {isExplicitUnignored ? 'Mute' : 'Unignore'}
                    </button>
                  </div>
                );
              })}

              {ignoredPhones.size === 0 && (
                <div className="text-center py-8 text-muted text-xs">
                  Ignore list is empty. All active chats will be scanned.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
