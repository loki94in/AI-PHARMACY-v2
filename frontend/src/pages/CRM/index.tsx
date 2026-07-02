import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { Users, UserPlus, Search, Trash2, Edit, X, Clock, ChevronRight, CheckCircle, MessageCircle, Send, RefreshCw, Mail, Smartphone, LogIn, LogOut, Paperclip, Smile, FileText, Download } from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

interface Patient {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

const emptyForm = { name: '', phone: '', address: '', notes: '' };

const EMOJI_CATEGORIES: Record<string, string[]> = {
  'Smileys': ['😀', '😄', '😂', '😊', '😍', '🤔', '😎', '👍', '👎', '👏', '🙌', '🙏', '❤️', '🔥', '✨', '🎉', '🌟', '👀'],
  'Medical': ['💊', '🩺', '💉', '🩹', '🌡️', '🏥', '🔬', '🧪', '🤷', '😷', '🤧', '🤢', '🧠', '🫁', '🫀', '🦷', '👁️', '🧬'],
  'Office': ['📝', '📅', '✉️', '📱', '💻', '📎', '📦', '🛒', '🔑', '💡', '📌', '📁', '🗂️', '📊', '📈', '📋', '🔍', '⚙️'],
  'Symbols': ['✔️', '❌', '⚠️', '❗', '❓', 'ℹ️', '🟢', '🔴', '🟡', '🔵', '⭐', '💯', '🔔', '📣', '🕒', '🆗', '🆓', '🆕']
};

const WhatsAppMedia = ({ 
  msg, 
  chatId, 
  media, 
  loading, 
  onLoad, 
  onImageClick 
}: { 
  msg: any; 
  chatId: string; 
  media?: { mimetype: string; data: string; filename?: string }; 
  loading?: boolean; 
  onLoad: () => void; 
  onImageClick: (src: string, name: string) => void;
}) => {
  useEffect(() => {
    if (!media && !loading) {
      onLoad();
    }
  }, [media, loading, onLoad]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted animate-pulse">
        <RefreshCw size={12} className="animate-spin text-muted/60" />
        <span className="text-[10px]">Loading media...</span>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="text-red-400 text-[10px] py-1 flex items-center gap-1">
        <span>Failed to load media</span>
        <button onClick={onLoad} className="text-muted hover:text-text underline ml-1">Retry</button>
      </div>
    );
  }

  const isImage = media.mimetype.startsWith('image/');
  if (isImage) {
    const src = `data:${media.mimetype};base64,${media.data}`;
    return (
      <div className="mt-1 mb-1 max-w-full rounded-lg overflow-hidden border border-glass-border/10 cursor-zoom-in" onClick={() => onImageClick(src, media.filename || 'Image')}>
        <img src={src} alt={media.filename || 'WhatsApp Image'} className="max-w-full h-auto max-h-48 object-cover hover:scale-[1.02] transition-transform duration-200" />
        {msg.body && <p className="mt-1 text-xs text-text">{msg.body}</p>}
      </div>
    );
  }

  // It's a document/file
  const fileIcon = media.mimetype.includes('pdf') ? '📄' : '📁';
  const downloadFile = () => {
    const linkSource = `data:${media.mimetype};base64,${media.data}`;
    const downloadLink = document.createElement("a");
    downloadLink.href = linkSource;
    downloadLink.download = media.filename || 'downloaded-file';
    downloadLink.click();
  };

  return (
    <div className="mt-1 mb-1 flex flex-col gap-1.5 w-full">
      <button 
        onClick={downloadFile} 
        type="button"
        className="flex items-center gap-2 p-2 rounded-lg bg-bg2 hover:bg-bg3 border border-glass-border/20 text-left transition-colors group w-full"
      >
        <span className="text-lg shrink-0">{fileIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-text truncate group-hover:text-primary transition-colors">{media.filename || 'Attachment'}</p>
          <p className="text-[9px] text-muted uppercase font-mono">{media.mimetype.split('/')[1] || 'FILE'}</p>
        </div>
        <Download size={12} className="text-muted group-hover:text-text shrink-0" />
      </button>
      {msg.body && <p className="text-xs text-text mt-0.5">{msg.body}</p>}
    </div>
  );
};

const getTodayString = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const CRM = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!manualToDate) {
      setDateTo(getTodayString());
    }
  }, [manualToDate]);

  const handleDateFromChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateFrom('2020-01-01');
    } else {
      setDateFrom(val);
    }
  };

  const handleDateToChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setDateTo('2020-01-01');
    } else {
      setDateTo(val);
    }
  };


  // WhatsApp states
  const [waChats, setWaChats] = useState<any[]>([]);
  const [waMessages, setWaMessages] = useState<any[]>([]);
  const [activeWaChat, setActiveWaChat] = useState<any>(null);
  const [waInput, setWaInput] = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waStatus, setWaStatus] = useState({ isReady: false, qrUrl: null as string | null, message: '' });
  const [isOpeningWaWindow, setIsOpeningWaWindow] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastWaHeartbeat = useRef(0);

  // Input refs
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Emojis and Attachment states
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCat, setActiveEmojiCat] = useState<string>('Smileys');
  const [attachedFile, setAttachedFile] = useState<{ name: string; type: string; size: number; data: string } | null>(null);

  // Media download cache & loading states
  const [loadedMedia, setLoadedMedia] = useState<Record<string, { mimetype: string; data: string; filename?: string }>>({});
  const [loadingMedia, setLoadingMedia] = useState<Record<string, boolean>>({});

  // Lightbox state
  const [lightbox, setLightbox] = useState<{ isOpen: boolean; src: string; name: string }>({ isOpen: false, src: '', name: '' });
  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    toastEvent.trigger(msg, type, '/crm');
  };

  const fetchPatients = useCallback(async () => {
    try {
      const data = await api.getPatients({ limit: 20 });
      setPatients(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWaChats = useCallback(async () => {
    try {
      const data = await api.getWhatsappChats();
      setWaChats(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch WA chats', err);
    }
  }, []);

  const fetchWaStatus = useCallback(async () => {
    try {
      const data = await api.getWhatsappStatus();
      setWaStatus(prev => ({ ...prev, ...data }));
      if (data.isReady) {
        fetchWaChats();
      }
    } catch (err: any) {
      console.error("Failed to fetch WhatsApp Status", err);
      // Don't reset status on network errors – keep last known state
      setWaStatus(prev => ({ ...prev, message: 'Backend unreachable. Is the server running?' }));
    }
  }, [fetchWaChats]);

  const handleWaReconnect = async () => {
    try {
      setWaStatus({ isReady: false, qrUrl: null, message: 'Clearing old session and reinitializing...' });
      await api.reconnectWhatsapp();
      // Polling will pick up the new status/QR in a few seconds
    } catch (err) {
      console.error("Failed to reconnect WhatsApp", err);
      showNotif("Failed to clear session. Is server running?", "error");
    }
  };

  const handleOpenWaLoginWindow = async () => {
    setIsOpeningWaWindow(true);
    try {
      showNotif('Launching Chrome login window for WhatsApp...');
      await api.launchWhatsappLoginWindow();
    } catch (err: any) {
      console.error('Failed to open WhatsApp login window:', err);
      showNotif(err?.response?.data?.error || 'Failed to open Chrome login window. Ensure Chrome is installed.', 'error');
    } finally {
      setIsOpeningWaWindow(false);
    }
  };

  useDeferredEffect(() => { 
    fetchPatients(); 
    fetchWaStatus();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (!waStatus.isReady) {
          fetchWaStatus();
        } else {
          const now = Date.now();
          if (now - lastWaHeartbeat.current >= 30000) {
            lastWaHeartbeat.current = now;
            fetchWaStatus();
          }
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchPatients, fetchWaStatus, waStatus.isReady]);

  // Listen for real-time WhatsApp events pushed via SSE
  useEffect(() => {
    const handleWaEvent = (e: Event) => {
      const eventData = (e as CustomEvent).detail;
      if (!eventData) return;

      const { type, payload } = eventData;
      
      if (type === 'wa_new_message' && payload) {
        const { chat_id, message } = payload;
        
        // If this message belongs to the active chat thread, append it
        if (activeWaChat && activeWaChat.id === chat_id) {
          setWaMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === message.id)) return prev;
            const updated = [...prev, message];
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
            return updated;
          });
        }
        
        // Refresh chat list to show updated lastMessage, timestamp, unread counts
        fetchWaChats();
      } else if (type === 'wa_chats_updated') {
        fetchWaChats();
      }
    };

    window.addEventListener('whatsapp_event', handleWaEvent);
    return () => window.removeEventListener('whatsapp_event', handleWaEvent);
  }, [activeWaChat, fetchWaChats]);

  const loadWaMessages = async (chat: any) => {
    setActiveWaChat(chat);
    setWaLoading(true);
    setAttachedFile(null);
    setShowEmojiPicker(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const data = await api.getWhatsappMessages(chat.id);
      setWaMessages(Array.isArray(data) ? data : []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      console.error('Failed to fetch WA messages', err);
    } finally {
      setWaLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showNotif('File too large (max 10MB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setAttachedFile({
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
  };

  const clearAttachedFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    if (!input) {
      setWaInput(prev => prev + emoji);
      return;
    }
    const start = input.selectionStart ?? waInput.length;
    const end = input.selectionEnd ?? waInput.length;
    const text = waInput;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    setWaInput(before + emoji + after);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  const fetchMedia = async (msgId: string) => {
    if (!activeWaChat) return;
    setLoadingMedia(prev => ({ ...prev, [msgId]: true }));
    try {
      const media = await api.getWhatsappMessageMedia(activeWaChat.id, msgId);
      setLoadedMedia(prev => ({ ...prev, [msgId]: media }));
    } catch (err) {
      console.error('Failed to load media', err);
    } finally {
      setLoadingMedia(prev => ({ ...prev, [msgId]: false }));
    }
  };

  const sendWaMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!waInput.trim() && !attachedFile) || !activeWaChat) return;
    
    const msg = waInput;
    const file = attachedFile;
    
    setWaInput('');
    setAttachedFile(null);
    setShowEmojiPicker(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    try {
      // Append optimistically
      const tempId = Date.now();
      const newMsg: any = { 
        id: tempId, 
        body: msg, 
        fromMe: true, 
        timestamp: Date.now() / 1000,
        type: file ? 'media' : 'chat'
      };
      
      if (file) {
        newMsg.hasMedia = true;
        setLoadedMedia(prev => ({
          ...prev,
          [tempId]: {
            mimetype: file.type,
            data: file.data,
            filename: file.name
          }
        }));
      }
      
      setWaMessages(prev => [...prev, newMsg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      
      await api.sendWhatsappMessage(
        activeWaChat.id,
        msg,
        file ? { mimetype: file.type, data: file.data, filename: file.name } : undefined
      );
      
      // Wait 1.2s before refetching to allow the backend to sync the sent message
      setTimeout(async () => {
        try {
          const data = await api.getWhatsappMessages(activeWaChat.id);
          setWaMessages(Array.isArray(data) ? data : []);
        } catch (err) {
          console.error(err);
        }
      }, 1200);
    } catch (err) {
      showNotif('Failed to send WhatsApp message', 'error');
    }
  };

  const filtered = patients.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.phone || '').includes(searchQuery);
    
    let matchesDate = true;
    if (dateFrom || dateTo) {
      if (!(p as any).created_at) {
        matchesDate = false;
      } else {
        const itemDate = (p as any).created_at.substring(0, 10);
        const start = dateFrom || '0000-00-00';
        const end = dateTo || '9999-99-99';
        matchesDate = itemDate >= start && itemDate <= end;
      }
    }
    
    return matchesSearch && matchesDate;
  });

  // Memoize patient list to prevent typing lag
  const patientListElement = useMemo(() => {
    if (loading) {
      return <div className="p-8 text-center text-muted text-xs">Loading patients...</div>;
    }
    if (filtered.length === 0) {
      return (
        <div className="p-12 text-center text-muted text-xs">
          {searchQuery ? 'No patients match your search.' : 'No patients registered yet.'}
        </div>
      );
    }
    return filtered.map(p => (
      <div key={p.id}
        className={`p-3 hover:bg-bg3/50 transition-colors cursor-pointer flex items-center justify-between gap-3 ${selectedPatient?.id === p.id ? 'bg-primary/5' : ''}`}
        onClick={() => handleSelectPatient(p)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-xs text-text truncate">{p.name}</span>
            <span className="text-[9px] font-mono text-muted">#{p.id}</span>
          </div>
          <p className="text-[10px] font-mono text-muted truncate">{p.phone || '-'}</p>
          {(p.address || p.notes) && (
            <p className="text-[9px] text-muted truncate mt-0.5">
              {p.address && <span className="mr-2">{p.address}</span>}
              {p.notes && <span>({p.notes})</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => handlePatientWaClick(p.phone, p.name)}
            className="p-1.5 rounded hover:bg-green-500/20 text-green-500 transition-colors" title="Open WhatsApp Chat">
            <MessageCircle size={13} />
          </button>
          <button onClick={() => handleEdit(p)}
            className="p-1.5 rounded hover:bg-primary/20 text-primary transition-colors" title="Edit">
            <Edit size={13} />
          </button>
          <button onClick={() => handleDelete(p.id)}
            className="p-1.5 rounded hover:bg-red/20 text-red-400 transition-colors" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    ));
  }, [loading, filtered, selectedPatient]);

  // Memoize chats list to prevent typing lag
  const chatListElement = useMemo(() => {
    if (waChats.length === 0) {
      return <div className="p-8 text-center text-muted text-xs">No active chats. Send a message to start.</div>;
    }
    return waChats.map(chat => (
      <button
        key={chat.id}
        onClick={() => loadWaMessages(chat)}
        className={`w-full text-left p-3 hover:bg-bg3 transition-colors border-b border-glass-border/10 flex gap-3 items-center ${activeWaChat?.id === chat.id ? 'bg-primary/5 border-l-2 border-primary' : ''}`}
      >
        <div className="w-8 h-8 rounded-full bg-bg3 flex items-center justify-center shrink-0">
          <Users size={16} className="text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-0.5">
            <span className="font-semibold text-xs text-text truncate">{chat.name}</span>
            {chat.timestamp && (
              <span className="text-[9px] text-muted">
                {new Date(chat.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted truncate">{chat.lastMessage || 'No recent messages'}</p>
        </div>
        {chat.unreadCount > 0 && (
          <div className="bg-green text-bg text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
            {chat.unreadCount}
          </div>
        )}
      </button>
    ));
  }, [waChats, activeWaChat]);

  // Memoize interaction timeline
  const timelineElement = useMemo(() => {
    if (!selectedPatient) return null;
    return (
      <div className="bg-sky-500/5 border border-sky-500/20 p-4 rounded-2xl shrink-0 fade-in">
        <h3 className="font-bold text-xs flex items-center gap-2 mb-3 text-sky">
          <Clock size={14} /> Omnichannel Interaction History
        </h3>
        <div className="space-y-3 pl-2 border-l-2 border-sky/20">
          <div className="relative pl-4">
            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[#25D366] shadow-[0_0_8px_rgba(37,211,102,0.6)]"></div>
            <p className="text-[11px] font-semibold text-text">System sent WhatsApp Refill Reminder</p>
            <p className="text-[9px] text-muted">2 days ago • Automated</p>
          </div>
          <div className="relative pl-4">
            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-red shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
            <p className="text-[11px] font-semibold text-text">Customer emailed new prescription PDF</p>
            <p className="text-[9px] text-muted">1 week ago • Inbox</p>
          </div>
          <div className="relative pl-4">
            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-sky shadow-[0_0_8px_rgba(14,165,233,0.6)]"></div>
            <p className="text-[11px] font-semibold text-text">Completed Purchase (Invoice #1042)</p>
            <p className="text-[9px] text-muted">1 month ago • POS</p>
          </div>
        </div>
      </div>
    );
  }, [selectedPatient]);

  const handlePatientWaClick = (phone?: string, name?: string) => {
    if (!phone) return showNotif('No phone number available', 'error');
    // Sanitize phone
    const clean = phone.replace(/\D/g, '');
    const searchId = clean.length === 10 ? `91${clean}@c.us` : `${clean}@c.us`;
    const existing = Array.isArray(waChats) ? waChats.find(c => c.id === searchId) : null;
    if (existing) {
      loadWaMessages(existing);
    } else {
      // Create a temporary chat object so they can message this patient!
      const tempChat = {
        id: searchId,
        name: name || phone,
        unreadCount: 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastMessage: ''
      };
      setActiveWaChat(tempChat);
      setWaMessages([]);
    }
  };

  const handleSaveRef = useRef<any>(null);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + S: Save Patient Form
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveRef.current();
        return;
      }

      // Escape: Reset Form/Edit Mode, deselect patient, close emojis/lightbox
      if (e.key === 'Escape') {
        setEditingId(null);
        setForm(emptyForm);
        setSelectedPatient(null);
        setShowEmojiPicker(false);
        setLightbox({ isOpen: false, src: '', name: '' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) { showNotif('Name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editingId !== null) {
        await api.updatePatient(editingId, form);
        showNotif('Patient updated successfully');
      } else {
        await api.addPatient(form);
        showNotif('Patient saved successfully');
      }
      setForm(emptyForm);
      setEditingId(null);
      fetchPatients();
    } catch (err) {
      showNotif('Failed to save patient', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (p: Patient) => {
    setEditingId(p.id);
    setForm({ name: p.name, phone: p.phone || '', address: p.address || '', notes: p.notes || '' });
    setSelectedPatient(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this patient?')) return;
    try {
      await api.deletePatient(id);
      showNotif('Patient deleted');
      if (selectedPatient?.id === id) setSelectedPatient(null);
      fetchPatients();
    } catch { showNotif('Failed to delete', 'error'); }
  };

  const handleSelectPatient = async (p: Patient) => {
    setSelectedPatient(p);
    setHistoryLoading(true);
    setHistory([]);
    try {
      const data = await api.getPatientHistory(p.id);
      setHistory(Array.isArray(data) ? data : []);
    } catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  };

  return (
    <div className="h-full flex flex-col fade-in relative overflow-hidden">


      {/* 2-Column Split Layout (70/30 using grid grid-cols-10) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 gap-5 min-h-0 overflow-hidden">

        {/* ═══════ LEFT SIDE (70%): WhatsApp Interface ═══════ */}
        <div className="lg:col-span-7 bg-glass-bg border border-glass-border flex flex-col overflow-hidden min-h-0 rounded-2xl">
          {waStatus.isReady ? (
            /* Connected Dual-Pane Layout */
            <div className="flex-1 flex min-h-0 divide-x divide-glass-border/30">
              
              {/* Left Sub-pane: Chat List */}
              <div className="w-[280px] lg:w-[320px] flex flex-col min-h-0 bg-bg2/40 shrink-0">
                {/* Chats Header */}
                <div className="p-3 border-b border-glass-border bg-bg3 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <MessageCircle size={16} className="text-green" />
                    <span className="font-bold text-xs text-text">WhatsApp Chats</span>
                  </div>
                </div>

                {/* Chats List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {chatListElement}
                </div>
              </div>

              {/* Right Sub-pane: Message Thread */}
              <div className="flex-1 flex flex-col min-h-0 bg-bg2">
                {activeWaChat ? (
                  <>
                    {/* Header */}
                    <div className="p-3 border-b border-glass-border bg-bg3 flex items-center gap-3 shrink-0">
                      <div className="w-8 h-8 rounded-full bg-bg2 flex items-center justify-center">
                        <Users size={16} className="text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-xs text-text truncate">{activeWaChat.name}</h3>
                        <p className="text-[9px] text-muted truncate">{activeWaChat.id}</p>
                      </div>
                      <button onClick={() => setActiveWaChat(null)} className="p-1.5 hover:bg-bg2 rounded-full text-muted">
                        <X size={14} />
                      </button>
                    </div>

                    {/* Messages Scroll Panel */}
                    <div className="flex-1 flex flex-col-reverse overflow-y-auto p-4 gap-3 bg-bg2/30 custom-scrollbar">
                      {waLoading ? (
                        <div className="text-center text-muted text-xs py-4">Loading messages...</div>
                      ) : (
                        <>
                          <div ref={messagesEndRef} />
                          {[...waMessages].reverse().map((msg, idx) => (
                            <div key={msg.id || idx} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[75%] rounded-xl p-2.5 text-xs shadow-sm relative border ${msg.fromMe ? 'bg-primary/10 text-text border-primary/20 rounded-tr-none' : 'bg-bg3 text-text border-glass-border rounded-tl-none'}`}>
                                {msg.hasMedia ? (
                                  <WhatsAppMedia
                                    msg={msg}
                                    chatId={activeWaChat.id}
                                    media={loadedMedia[msg.id]}
                                    loading={loadingMedia[msg.id]}
                                    onLoad={() => fetchMedia(msg.id)}
                                    onImageClick={(src, name) => setLightbox({ isOpen: true, src, name })}
                                  />
                                ) : (
                                  <span className="whitespace-pre-wrap">{msg.body}</span>
                                )}
                                <div className="text-[8px] text-muted mt-1 text-right float-right ml-3 pt-0.5 select-none">
                                  {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Attachment Preview Strip */}
                    {attachedFile && (
                      <div className="px-4 py-2 border-t border-glass-border/30 bg-bg3/60 flex items-center justify-between gap-3 animate-fade-in shrink-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {attachedFile.type.startsWith('image/') ? (
                            <img 
                              src={`data:${attachedFile.type};base64,${attachedFile.data}`} 
                              alt="Preview" 
                              className="w-8 h-8 rounded object-cover border border-glass-border/20 shrink-0" 
                            />
                          ) : (
                            <span className="text-lg shrink-0">📄</span>
                          )}
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-text truncate">{attachedFile.name}</p>
                            <p className="text-[9px] text-muted">{(attachedFile.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                        <button 
                          type="button" 
                          onClick={clearAttachedFile}
                          className="p-1 hover:bg-bg2 rounded text-muted hover:text-red transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}

                    {/* Input Field Section */}
                    <div className="relative p-3 bg-bg3 border-t border-glass-border shrink-0">
                      {/* Emoji Picker Overlay */}
                      {showEmojiPicker && (
                        <div className="absolute bottom-16 left-3 z-[100] w-64 bg-glass-bg border border-glass-border rounded-2xl shadow-2xl backdrop-blur-2xl p-3 flex flex-col gap-2">
                          <div className="flex gap-1 border-b border-glass-border/30 pb-1.5 overflow-x-auto shrink-0 custom-scrollbar">
                            {Object.keys(EMOJI_CATEGORIES).map(cat => (
                              <button 
                                key={cat} 
                                type="button" 
                                onClick={() => setActiveEmojiCat(cat)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all shrink-0 ${activeEmojiCat === cat ? 'bg-primary text-white' : 'text-muted hover:text-text hover:bg-bg3'}`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-6 gap-1 h-32 overflow-y-auto custom-scrollbar p-0.5">
                            {EMOJI_CATEGORIES[activeEmojiCat].map(emoji => (
                              <button 
                                key={emoji} 
                                type="button" 
                                onClick={() => insertEmoji(emoji)} 
                                className="text-base p-1 hover:bg-bg3 rounded transition-colors text-center"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <form onSubmit={sendWaMessage} className="flex items-center gap-2">
                        {/* Emoji Toggle Button */}
                        <button 
                          type="button" 
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)} 
                          className={`p-2 rounded-full transition-colors shrink-0 ${showEmojiPicker ? 'text-green bg-green/10' : 'text-muted hover:text-text hover:bg-bg2'}`}
                          title="Choose Emoji"
                        >
                          <Smile size={16} />
                        </button>

                        {/* File Attachment Button */}
                        <button 
                          type="button" 
                          onClick={() => fileInputRef.current?.click()} 
                          className={`p-2 rounded-full transition-colors shrink-0 ${attachedFile ? 'text-primary bg-primary/10' : 'text-muted hover:text-text hover:bg-bg2'}`}
                          title="Attach File"
                        >
                          <Paperclip size={16} />
                        </button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileChange} 
                          className="hidden" 
                        />

                        {/* TextInput */}
                        <input
                          ref={inputRef}
                          type="text"
                          value={waInput}
                          onChange={e => setWaInput(e.target.value)}
                          placeholder="Type a message"
                          className="flex-1 bg-bg2 border border-glass-border rounded-lg px-4 py-2 text-xs text-text focus:outline-none placeholder-muted"
                        />

                        {/* Send Button */}
                        <button 
                          type="submit" 
                          disabled={!waInput.trim() && !attachedFile} 
                          className="p-2 rounded-full text-muted hover:text-green disabled:opacity-50 shrink-0 transition-colors"
                        >
                          <Send size={16} />
                        </button>
                      </form>
                    </div>
                  </>
                ) : (
                  /* Thread Placeholder */
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted">
                    <MessageCircle size={40} className="text-muted/20 mb-3 animate-pulse" />
                    <h3 className="font-bold text-xs text-text mb-1">No Chat Selected</h3>
                    <p className="text-[11px] max-w-[280px]">Select a patient or click on an active chat on the left to start sending messages.</p>
                  </div>
                )}
              </div>

            </div>
          ) : (
            /* Connection / QR scan panel */
            <div className="flex flex-col items-center justify-center h-full p-6 text-center w-full">
              <div className="w-44 h-44 mx-auto bg-white rounded-xl flex items-center justify-center p-3 shadow-inner mb-5">
                {waStatus.qrUrl ? (
                  <img src={waStatus.qrUrl} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                ) : (
                  <div className="animate-pulse flex flex-col items-center justify-center w-full h-full">
                    <div className="w-8 h-8 border-4 border-green/30 border-t-green rounded-full animate-spin mb-3"></div>
                    <span className="text-[10px] text-muted font-bold text-center">Waiting for QR...<br/>Check terminal</span>
                  </div>
                )}
              </div>
              <h3 className="text-text font-bold text-base mb-2">Connect WhatsApp</h3>
              <p className="text-muted text-[11px] max-w-[240px] leading-relaxed whitespace-pre-line mb-4">
                {waStatus.message || "1. Open WhatsApp on your phone\n2. Tap Menu → Linked Devices\n3. Tap Link a Device\n4. Point your phone at this screen"}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={handleOpenWaLoginWindow}
                  disabled={isOpeningWaWindow}
                  className="text-xs font-bold bg-green/20 text-green px-4 py-1.5 rounded-full hover:bg-green/30 transition-all disabled:opacity-50 flex items-center gap-1.5"
                  title="Open Chrome to scan QR code"
                >
                  <LogIn size={12} />
                  {isOpeningWaWindow ? 'Opening...' : 'Log In (Chrome Popup)'}
                </button>
                <button
                  onClick={fetchWaStatus}
                  className="text-xs font-bold bg-bg3 text-muted border border-glass-border px-4 py-1.5 rounded-full hover:bg-bg2 hover:text-text transition-all flex items-center gap-1"
                >
                  Refresh
                </button>
                <button
                  onClick={handleWaReconnect}
                  className="text-xs font-bold bg-red/10 text-red px-4 py-1.5 rounded-full hover:bg-red/20 transition-all flex items-center gap-1.5"
                  title="Clear session and force new QR"
                >
                  <LogOut size={12} />
                  Log Out WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══════ RIGHT SIDE (30%): Form + Patient Directory ═══════ */}
        <div className="lg:col-span-3 flex flex-col min-h-0 min-w-0 gap-4">

          {/* Registration / Edit Form */}
          <div className="bg-glass-bg border border-glass-border p-4 rounded-2xl shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2 text-sm text-text">
                <UserPlus size={16} className="text-primary" />
                {editingId !== null ? 'Edit Patient' : 'Register New Patient'}
              </h3>
              {selectedPatient && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-sky">{selectedPatient.name}</span>
                  <button onClick={() => handlePatientWaClick(selectedPatient.phone, selectedPatient.name)} className="flex items-center gap-1 bg-[#25D366]/20 text-[#25D366] px-2 py-0.5 rounded-full hover:bg-[#25D366]/30 transition-all font-bold">
                    <MessageCircle size={10} /> Send WA
                  </button>
                  <button onClick={() => showNotif('Email composer opened')} className="flex items-center gap-1 bg-red/20 text-red px-2 py-0.5 rounded-full hover:bg-red/30 transition-all font-bold">
                    <Mail size={10} /> Send Email
                  </button>
                  <button onClick={() => setSelectedPatient(null)} className="text-muted hover:text-text ml-2"><X size={12} /></button>
                </div>
              )}
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Name *</label>
                  <input
                    type="text"
                    className="premium-input w-full text-xs"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Phone</label>
                  <input
                    type="tel"
                    className="premium-input w-full text-xs"
                    placeholder="10-digit number"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    maxLength={10}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Address</label>
                  <input
                    type="text"
                    className="premium-input w-full text-xs"
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Notes</label>
                  <input
                    type="text"
                    className="premium-input w-full text-xs"
                    placeholder="e.g. Diabetes"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {editingId !== null && (
                  <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}
                    className="p-2 py-1 bg-bg3 border border-glass-border hover:bg-bg2 rounded text-muted text-xs">
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="premium-btn bg-primary text-white shadow-[0_4px_14px_rgba(14,165,233,0.3)] hover:bg-sky-500 font-bold text-xs px-4"
                >
                  {saving ? 'Saving...' : editingId !== null ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>

          {/* Unified Patient Timeline (Shows only when patient selected) */}
          {timelineElement}

          {/* Patient Directory List */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="p-3 border-b border-glass-border bg-bg3 flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-sky" />
                  <h3 className="font-bold text-sm text-text">Patient Directory</h3>
                </div>
                <div className="text-[10px] text-muted">
                  Count: <strong>{filtered.length}</strong>
                </div>
              </div>
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 text-muted" size={13} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search name or phone..."
                  className="premium-input pl-8 pr-3 py-1.5 text-xs w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5 text-[9px] text-muted">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <span>From:</span>
                    <input
                      type="date"
                      value={dateFrom}
                      min="2020-01-01"
                      max={getTodayString()}
                      onChange={e => handleDateFromChange(e.target.value)}
                      className="px-1 py-0.5 bg-bg2 border border-glass-border rounded text-[9px] text-text focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span>To:</span>
                    <input
                      type="date"
                      value={dateTo}
                      min="2020-01-01"
                      max={getTodayString()}
                      disabled={!manualToDate}
                      onChange={e => handleDateToChange(e.target.value)}
                      className="px-1 py-0.5 bg-bg2 border border-glass-border rounded text-[9px] text-text focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <label className="flex items-center gap-1 cursor-pointer select-none text-[8px]">
                    <input
                      type="checkbox"
                      checked={manualToDate}
                      onChange={e => setManualToDate(e.target.checked)}
                      className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg w-2.5 h-2.5"
                    />
                    <span>Edit To Date</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-bg2 divide-y divide-glass-border/30 custom-scrollbar">
              {patientListElement}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightbox.isOpen && (
        <div className="fixed inset-0 z-[999999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setLightbox({ isOpen: false, src: '', name: '' })}>
          <button 
            onClick={() => setLightbox({ isOpen: false, src: '', name: '' })}
            className="absolute top-4 right-4 p-2 bg-bg3 hover:bg-bg2 border border-glass-border rounded-full text-text transition-colors shadow-lg"
          >
            <X size={20} />
          </button>
          <div className="max-w-4xl max-h-[80vh] flex items-center justify-center animate-zoom-in" onClick={e => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl border border-glass-border/10" />
          </div>
          <p className="mt-4 text-xs font-bold text-text bg-bg3/60 px-3 py-1.5 rounded-full border border-glass-border/20 tracking-wide">{lightbox.name}</p>
        </div>
      )}
    </div>
  );
};

export default CRM;
