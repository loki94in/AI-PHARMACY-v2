import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { Sparkles, Users, UserPlus, Search, Trash2, Edit, X, Clock, ChevronRight, CheckCircle, MessageCircle, Send, RefreshCw, Mail, Smartphone, LogIn, LogOut, Paperclip, Smile, FileText, Download, Activity, Eye, EyeOff, Pill, AlertTriangle, XCircle, MessageSquare } from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
import AdminMatchPanel from '../../components/AdminMatchPanel';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useFetchMode } from '../../hooks/useFetchMode';
import { useQueryClient } from '@tanstack/react-query';
import { getTodayString } from '../../utils/date';
import { useSearchParams } from 'react-router-dom';
import Refills from '../Refills';
import AutomationCenter from '../AutomationCenter';

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
  onImageClick,
  onScan
}: { 
  msg: any; 
  chatId: string; 
  media?: { mimetype: string; data: string; filename?: string }; 
  loading?: boolean; 
  onLoad: () => void; 
  onImageClick: (src: string, name: string) => void;
  onScan?: () => void;
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
        <img src={src} alt={media.filename || 'WhatsApp Image'} loading="lazy" decoding="async" className="max-w-full h-auto max-h-48 object-cover hover:scale-[1.02] transition-transform duration-200" />
        {msg.body && <p className="mt-1 text-xs text-text">{msg.body}</p>}
        {onScan && (
          <div className="mt-2 flex justify-end" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={onScan}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-all font-bold text-[9px] uppercase tracking-wider border border-primary/20 hover:scale-[1.02] active:scale-[0.98]"
              title="Scan this image for medicines and create workflow"
            >
              <Sparkles size={10} className="animate-pulse" /> Create Workflow
            </button>
          </div>
        )}
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

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Module-level caching variables for state preservation across page navigation
let cachedWaChats: any[] = [];
let cachedWaMessages: any[] = [];
let cachedActiveWaChat: any = null;
let cachedWaStatus = { isReady: false, qrUrl: null as string | null, message: '' };
let cachedSelectedPatient: Patient | null = null;
let cachedHistory: any[] = [];
let cachedIgnoredPhones: Map<string, string> = new Map();

const CRM = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'crm';
  const queryClient = useQueryClient();

  const waStatusPollControl = useFetchMode('crm.waStatusPoll');
  const waSseControl = useFetchMode('crm.waSse');

  const { data: patients = [], isLoading: loading } = useApiQuery<Patient[]>(
    'patients',
    () => api.getPatients({ limit: 20 })
  );
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(() => cachedSelectedPatient);
  const [history, setHistory] = useState<any[]>(() => cachedHistory);
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
  const [waChats, setWaChats] = useState<any[]>(() => cachedWaChats);
  const [waMessages, setWaMessages] = useState<any[]>(() => cachedWaMessages);
  const [activeWaChat, setActiveWaChat] = useState<any>(() => cachedActiveWaChat);
  const [waInput, setWaInput] = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waStatus, setWaStatus] = useState(() => cachedWaStatus);

  const [ignoredPhones, setIgnoredPhones] = useState<Map<string, string>>(() => cachedIgnoredPhones);
  const [waChatSearch, setWaChatSearch] = useState('');

  // Sync state changes back to the module-level cache
  useEffect(() => {
    cachedWaChats = waChats;
  }, [waChats]);

  useEffect(() => {
    cachedWaMessages = waMessages;
  }, [waMessages]);

  useEffect(() => {
    cachedActiveWaChat = activeWaChat;
  }, [activeWaChat]);

  useEffect(() => {
    cachedWaStatus = waStatus;
  }, [waStatus]);

  useEffect(() => {
    cachedSelectedPatient = selectedPatient;
  }, [selectedPatient]);

  useEffect(() => {
    cachedHistory = history;
  }, [history]);

  useEffect(() => {
    cachedIgnoredPhones = ignoredPhones;
  }, [ignoredPhones]);

  // Automatically fetch patient history/timeline when selectedPatient changes
  useEffect(() => {
    if (!selectedPatient) {
      setHistory([]);
      return;
    }
    let active = true;
    const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
        const data = await api.getPatientHistory(selectedPatient.id);
        if (active) {
          setHistory(Array.isArray(data) ? data : []);
        }
      } catch {
        if (active) setHistory([]);
      } finally {
        if (active) setHistoryLoading(false);
      }
    };
    fetchHistory();
    return () => {
      active = false;
    };
  }, [selectedPatient]);

  // On mount, silently refresh the active chat's messages and selected patient's history in the background
  useEffect(() => {
    if (cachedActiveWaChat) {
      const refreshMessages = async () => {
        try {
          const data = await api.getWhatsappMessages(cachedActiveWaChat.id);
          setWaMessages(Array.isArray(data) ? data : []);
        } catch (err) {
          console.error('Failed to refresh WA messages in background', err);
        }
      };
      refreshMessages();
    }
    const patient = cachedSelectedPatient;
    if (patient) {
      const refreshHistory = async () => {
        try {
          const data = await api.getPatientHistory(patient.id);
          setHistory(Array.isArray(data) ? data : []);
        } catch { /* ignore */ }
      };
      refreshHistory();
    }
    fetchPendingReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [showIgnoreModal, setShowIgnoreModal] = useState(false);
  const [newIgnorePhone, setNewIgnorePhone] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [pendingReviews, setPendingReviews] = useState<any[]>([]);
  const [activeRightTab, setActiveRightTab] = useState<'directory' | 'approvals'>('directory');

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

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    toastEvent.trigger(msg, type, '/crm');
  };

  const handleManualScan = async (chatId: string, msgId: string) => {
    try {
      showNotif('Scanning image and extracting medicine info...');
      const res = await api.triggerManualScan(chatId, msgId);
      if (res.success) {
        showNotif('OCR Scan completed successfully');
      } else {
        showNotif('Failed to trigger scan', 'error');
      }
    } catch (err: any) {
      console.error('Manual scan failed:', err);
      showNotif(err?.response?.data?.error || 'Failed to scan image', 'error');
    }
  };

  const fetchWaChats = useCallback(async () => {
    try {
      const data = await api.getWhatsappChats();
      setWaChats(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch WA chats', err);
    }
  }, []);

  const fetchIgnoredPhones = useCallback(async () => {
    try {
      const data = await api.getIgnoredPhones();
      const map = new Map<string, string>(
        Array.isArray(data) ? data.map((r: any) => [r.phone, r.reason]) : []
      );
      setIgnoredPhones(map);
    } catch (err) {
      console.error('Failed to fetch ignored phones in CRM', err);
    }
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

  const toggleIgnore = useCallback(async (phone: string, currentIgnored: boolean) => {
    try {
      await api.toggleIgnore(phone, !currentIgnored);
      // Re-fetch from DB to get the accurate list
      await fetchIgnoredPhones();
      showNotif(currentIgnored ? `Scanning ${phone}` : `Ignored ${phone}`);

      // If we are ignoring the active chat, close it
      if (!currentIgnored && activeWaChat && activeWaChat.id === phone) {
        setActiveWaChat(null);
        setWaMessages([]);
      }
      
      // Refresh chat list to remove the ignored chat from the database view
      fetchWaChats();
    } catch (err) {
      console.error('Failed to toggle ignore in CRM', err);
      showNotif('Failed to toggle ignore state', 'error');
    }
  }, [fetchIgnoredPhones, fetchWaChats, activeWaChat]);

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



  useDeferredEffect(() => { 
    if (waStatusPollControl.shouldFetch) {
      fetchWaStatus();
      fetchIgnoredPhones();
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
    } else {
      fetchIgnoredPhones();
    }
  }, [fetchWaStatus, waStatus.isReady, waStatusPollControl.shouldFetch]);

  // Listen for real-time WhatsApp events pushed via SSE
  useEffect(() => {
    let evtSource: EventSource | null = null;
    if (waSseControl.shouldFetch) {
      evtSource = new EventSource('/api/events');

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'wa_new_message' && data.payload) {
            const { chat_id, message } = data.payload;
            
            if (activeWaChat && activeWaChat.id === chat_id) {
              setWaMessages(prev => {
                if (prev.some(m => m.id === message.id)) return prev;
                const updated = [...prev, message];
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                return updated;
              });
            }
            fetchWaChats();
          } else if (data.type === 'wa_chats_updated') {
            fetchWaChats();
          } else if (data.type === 'wa_medicine_match') {
            setSelectedMatch(data.payload);
            fetchPendingReviews();
          } else if (data.type === 'catalog_review_updated') {
            fetchPendingReviews();
          }
        } catch (err) {
          console.error('Failed to parse SSE event in CRM:', err);
        }
      };
    }

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
      } else if (type === 'wa_medicine_match') {
        setSelectedMatch(payload);
        fetchPendingReviews();
      } else if (type === 'catalog_review_updated') {
        fetchPendingReviews();
      }
    };

    window.addEventListener('whatsapp_event', handleWaEvent);
    return () => {
      if (evtSource) {
        evtSource.close();
      }
      window.removeEventListener('whatsapp_event', handleWaEvent);
    };
  }, [activeWaChat, fetchWaChats, waSseControl.shouldFetch, fetchPendingReviews]);

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

      // Auto-select corresponding patient if found in the database
      const resolved = chat.resolvedNumber || chat.id || '';
      const phone = resolved.replace(/@[a-z0-9\.]+$/, '');
      const last10 = phone.replace(/[^0-9]/g, '').slice(-10);
      if (last10.length >= 10) {
        try {
          const matches = await api.getPatients({ q: last10 });
          const matched = matches.find((p: any) => {
            const pPhone = (p.phone || '').replace(/[^0-9]/g, '');
            return pPhone.endsWith(last10);
          });
          if (matched) {
            setSelectedPatient(matched);
            return;
          }
        } catch (err) {
          console.error('Failed to auto-select patient in loadWaMessages:', err);
        }
      }
      setSelectedPatient(null);
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
        matchesDate = true;
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
            <MessageSquare size={13} />
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
    const s = waChatSearch.trim().toLowerCase();
    const filtered = s
      ? waChats.filter(c =>
          (c.name || '').toLowerCase().includes(s) ||
          (c.id || '').includes(s)
        )
      : waChats;
    if (filtered.length === 0) {
      return <div className="p-8 text-center text-muted text-xs">{waChats.length === 0 ? 'No active chats. Send a message to start.' : 'No chats match your search.'}</div>;
    }
    return filtered.map(chat => {
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

      return (
        <div
          key={chat.id}
          className={`w-full text-left p-3 hover:bg-bg3 transition-colors border-b border-glass-border/10 flex gap-3 items-center cursor-pointer ${
            activeWaChat?.id === chat.id ? 'bg-primary/5 border-l-2 border-primary' : ''
          } ${isIgnored ? 'opacity-50' : ''}`}
          onClick={() => {
            if (isIgnored) {
              showNotif('This chat is ignored. Uncheck the checkbox to scan and open it.', 'error');
              return;
            }
            loadWaMessages(chat);
          }}
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
          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isIgnored}
              onChange={() => toggleIgnore(chatId || phone, isIgnored)}
              className="w-3.5 h-3.5 rounded border-glass-border bg-bg3 text-primary focus:ring-0 cursor-pointer transition-colors"
              title={isIgnored ? 'Ignored (Uncheck to scan)' : 'Scanning (Check to ignore)'}
            />
            {chat.unreadCount > 0 && (
              <div className="bg-green text-bg text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                {chat.unreadCount}
              </div>
            )}
          </div>
        </div>
      );
    });
  }, [waChats, waChatSearch, activeWaChat, ignoredPhones, toggleIgnore]);

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
    const clean = phone.replace(/\D/g, '');
    const formattedPhone = clean.length === 10 ? `91${clean}` : clean;
    const chatId = `${formattedPhone}@c.us`;
    // Navigate to in-app WhatsApp chat
    const existingChat = waChats.find(c => c.id === chatId);
    if (existingChat) {
      loadWaMessages(existingChat);
    } else {
      // Create a temporary chat entry and open it
      const tempChat = { id: chatId, name: name || formattedPhone, unreadCount: 0, timestamp: Math.floor(Date.now() / 1000), isGroup: false, lastMessage: '', resolvedNumber: formattedPhone };
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
      queryClient.invalidateQueries({ queryKey: ['patients'] });
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
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    } catch { showNotif('Failed to delete', 'error'); }
  };

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
  };

  return (
    <div className="h-full flex flex-col fade-in relative overflow-hidden gap-4">
      {/* Page Tabs */}
      <div className="flex border border-glass-border/30 bg-bg2/60 backdrop-blur-md shrink-0 rounded-2xl overflow-hidden p-1.5 gap-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <button
          onClick={() => setSearchParams({ tab: 'crm' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] duration-150 ${
            currentTab === 'crm'
              ? 'bg-primary/10 border border-primary/25 text-primary shadow-[0_0_12px_rgba(34,197,94,0.12)]'
              : 'border border-transparent text-muted hover:text-text hover:bg-bg3/30'
          }`}
        >
          <Users size={14} />
          CRM / Patients
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'refills' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] duration-150 ${
            currentTab === 'refills'
              ? 'bg-primary/10 border border-primary/25 text-primary shadow-[0_0_12px_rgba(34,197,94,0.12)]'
              : 'border border-transparent text-muted hover:text-text hover:bg-bg3/30'
          }`}
        >
          <Clock size={14} />
          Patient Refills
        </button>
        <button
          onClick={() => setSearchParams({ tab: 'automation' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] duration-150 ${
            currentTab === 'automation'
              ? 'bg-primary/10 border border-primary/25 text-primary shadow-[0_0_12px_rgba(34,197,94,0.12)]'
              : 'border border-transparent text-muted hover:text-text hover:bg-bg3/30'
          }`}
        >
          <Activity size={14} />
          Automation Center
        </button>
      </div>

      {currentTab === 'refills' ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <Refills />
        </div>
      ) : currentTab === 'automation' ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <AutomationCenter />
        </div>
      ) : (
        <>
          {/* Redesigned 2-Column CRM Directory Layout */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 gap-5 min-h-0 overflow-hidden">

            {/* ═══════ LEFT COLUMN (60%): Patient Directory & Pending Approvals ═══════ */}
            <div className="lg:col-span-6 bg-bg2/40 border border-glass-border/40 backdrop-blur-md flex flex-col overflow-hidden min-h-0 rounded-2xl shadow-xl shadow-black/5">
              {/* Inner Tab Toggles */}
              <div className="flex bg-bg3/40 border-b border-glass-border/30 p-2 shrink-0 justify-between items-center gap-4">
                <div className="flex bg-bg3/60 rounded-xl p-0.5 border border-glass-border/20">
                  <button
                    type="button"
                    onClick={() => setActiveRightTab('directory')}
                    className={`flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      activeRightTab === 'directory'
                        ? 'bg-primary/10 border border-primary/20 text-primary shadow-[inset_0_0_12px_rgba(34,197,94,0.1)]'
                        : 'text-muted hover:text-text border border-transparent'
                    }`}
                  >
                    <Users size={12} />
                    Patient Directory
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveRightTab('approvals')}
                    className={`flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      activeRightTab === 'approvals'
                        ? 'bg-primary/10 border border-primary/20 text-primary shadow-[inset_0_0_12px_rgba(34,197,94,0.1)]'
                        : 'text-muted hover:text-text border border-transparent'
                    }`}
                  >
                    <Pill size={12} />
                    Approvals
                    {pendingReviews.length > 0 && (
                      <span className="bg-primary text-bg text-[8px] px-1.5 py-0.2 rounded-full font-bold ml-1 animate-pulse">
                        {pendingReviews.length}
                      </span>
                    )}
                  </button>
                </div>
                {activeRightTab === 'directory' && (
                  <div className="text-[10px] text-muted font-bold mr-2">
                    Total Registered: <span className="text-text font-mono bg-bg3/80 px-1.5 py-0.5 rounded">{filtered.length}</span>
                  </div>
                )}
              </div>

              {activeRightTab === 'directory' ? (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* Filters Panel */}
                  <div className="p-4 border-b border-glass-border/30 bg-bg3/20 flex flex-col gap-3 shrink-0">
                    <div className="relative w-full">
                      <Search className="absolute left-3 top-3 text-muted" size={13} />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search patient name or phone number..."
                        className="premium-input pl-9 pr-3 py-2 text-xs w-full rounded-xl border-glass-border/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-2 text-[10px] text-muted font-medium bg-bg2/40 border border-glass-border/30 rounded-xl p-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span>Created From:</span>
                          <input
                            type="date"
                            value={dateFrom}
                            min="2020-01-01"
                            max={getTodayString()}
                            onChange={e => handleDateFromChange(e.target.value)}
                            className="px-2 py-1 bg-bg border border-glass-border/50 rounded-lg text-[10px] text-text focus:outline-none focus:border-primary/40 transition-colors"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>Created To:</span>
                          <input
                            type="date"
                            value={dateTo}
                            min="2020-01-01"
                            max={getTodayString()}
                            disabled={!manualToDate}
                            onChange={e => handleDateToChange(e.target.value)}
                            className="px-2 py-1 bg-bg border border-glass-border/50 rounded-lg text-[10px] text-text focus:outline-none disabled:opacity-40 focus:border-primary/40 transition-colors"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end pr-1 pt-0.5">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[9px] hover:text-text transition-colors">
                          <input
                            type="checkbox"
                            checked={manualToDate}
                            onChange={e => setManualToDate(e.target.checked)}
                            className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg w-3 h-3 cursor-pointer"
                          />
                          <span>Edit To Date</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  {/* Patient List */}
                  <div className="flex-1 overflow-auto bg-bg2/10 divide-y divide-glass-border/10 custom-scrollbar p-2.5">
                    {patientListElement}
                  </div>
                </div>
              ) : (
                /* Pending Approvals List */
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {pendingReviews.length === 0 ? (
                      <div className="text-center text-muted text-xs py-16 flex flex-col items-center justify-center gap-2 font-medium">
                        <CheckCircle size={24} className="text-muted/30" />
                        No pending approvals found
                      </div>
                    ) : (
                      pendingReviews.map((review) => {
                        const data = review.original_row_data || {};
                        const topMatches = data.topMatches || [];

                        return (
                          <div key={review.id} className="bg-bg3/50 border border-glass-border/30 rounded-2xl p-4 space-y-3.5 hover:border-glass-border/50 hover:shadow-md transition-all duration-200">
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-text truncate leading-snug">{review.medicine_name}</h4>
                                <p className="text-[9px] text-muted truncate mt-1">
                                  Query: <span className="font-mono text-accent">"{review.search_query}"</span>
                                </p>
                                <p className="text-[9px] text-muted truncate mt-0.5">
                                  Customer: <span className="font-semibold text-text">{data.customerName || 'New'}</span> ({data.customerPhone?.replace('@c.us', '') || 'Unknown'})
                                </p>
                              </div>
                              <span className="text-[8px] bg-purple/10 text-purple border border-purple/20 px-2 py-0.5 rounded-full font-black uppercase select-none shrink-0 font-mono">
                                #{review.id}
                              </span>
                            </div>

                            {topMatches.length > 0 ? (
                              <div className="space-y-2">
                                <span className="text-[8px] font-black text-muted uppercase tracking-wider block">PharmaRack Matches</span>
                                {topMatches.slice(0, 3).map((match: any, mIdx: number) => (
                                  <div key={mIdx} className="flex justify-between items-center bg-bg/40 border border-glass-border/20 rounded-xl p-2.5 text-[10px] hover:border-primary/30 hover:bg-bg3/30 transition-all duration-150">
                                    <div className="min-w-0 pr-2">
                                      <span className="font-bold text-text truncate block">{match.name}</span>
                                      <span className="text-[8px] text-muted truncate block">{match.distributor} • {match.packaging}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-text font-bold font-mono">₹{match.mrp}</span>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            await api.approveCatalogReview(review.id, {
                                              name: match.name,
                                              packaging: match.packaging,
                                              manufacturer: match.manufacturer || '',
                                              mrp: match.mrp
                                            });
                                            showNotif('Approved medicine and added to database');
                                            fetchPendingReviews();
                                          } catch (err) {
                                            console.error('Approve failed:', err);
                                            showNotif('Failed to approve review', 'error');
                                          }
                                        }}
                                        className="px-2.5 py-1 bg-green hover:bg-emerald-600 text-white font-extrabold rounded-lg text-[9px] uppercase tracking-wider transition-all hover:scale-105 active:scale-95 shadow-sm"
                                      >
                                        Approve
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[10px] text-muted italic bg-bg/25 border border-glass-border/10 p-2.5 rounded-xl text-center">
                                No matches returned from PharmaRack.
                              </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2 border-t border-glass-border/20">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.rejectCatalogReview(review.id);
                                    showNotif('Rejected and removed from queue');
                                    fetchPendingReviews();
                                  } catch (err) {
                                    console.error('Reject failed:', err);
                                    showNotif('Failed to reject review', 'error');
                                  }
                                }}
                                className="px-3 py-1 hover:bg-red/10 border border-transparent hover:border-red/20 text-muted hover:text-red font-bold rounded-lg text-[10px] transition-colors"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ═══════ RIGHT COLUMN (40%): WhatsApp Launcher & Register Patient Form ═══════ */}
            <div className="lg:col-span-4 flex flex-col min-h-0 min-w-0 gap-4 overflow-y-auto pr-1 custom-scrollbar">
              {/* ═══ In-App WhatsApp Panel ═══ */}
              <div className="bg-bg2/60 border border-glass-border rounded-2xl backdrop-blur-md relative overflow-hidden shadow-lg shadow-black/5 flex flex-col" style={{ minHeight: '420px', maxHeight: '65vh' }}>
                <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none"></div>

                {/* Header */}
                <div className="flex items-center justify-between gap-3 p-3.5 border-b border-glass-border/30 shrink-0 bg-bg3/20">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-500">
                      <MessageSquare size={16} />
                    </div>
                    <div>
                      <h3 className="font-bold text-[11px] text-text uppercase tracking-wider">WhatsApp</h3>
                      <p className="text-[9px] text-muted font-bold">
                        {waStatus.isReady
                          ? <span className="text-green-500">● Connected</span>
                          : waStatus.qrUrl
                            ? 'Scan QR to connect'
                            : (waStatus.message || 'Connecting...')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {activeWaChat && (
                      <button
                        onClick={() => { setActiveWaChat(null); setWaMessages([]); }}
                        className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-colors" title="Back to chat list"
                      >
                        <ChevronRight size={14} className="rotate-180" />
                      </button>
                    )}
                    {waStatus.isReady && (
                      <button onClick={() => setShowIgnoreModal(true)} className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-colors" title="Manage ignore list">
                        <EyeOff size={13} />
                      </button>
                    )}
                    <button onClick={handleWaReconnect} className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-colors" title="Reconnect">
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>

                {/* Body — switches between QR / Chat List / Chat Thread */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

                  {/* ── State 1 & 2: Not Ready (QR or Initializing) ── */}
                  {!waStatus.isReady && (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 text-center">
                      {waStatus.qrUrl ? (
                        <>
                          <div className="p-3 bg-white rounded-2xl shadow-lg border border-glass-border/20">
                            <img src={waStatus.qrUrl} alt="WhatsApp QR Code" className="w-48 h-48 object-contain" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-text">Scan with WhatsApp</p>
                            <p className="text-[10px] text-muted leading-relaxed max-w-[220px]">Open WhatsApp on your phone → Settings → Linked Devices → Scan this QR code</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 rounded-full border-2 border-green-500/30 border-t-green-500 animate-spin"></div>
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-text">Initializing WhatsApp</p>
                            <p className="text-[10px] text-muted max-w-[220px]">{waStatus.message || 'Waiting for QR code from server...'}</p>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── State 3: Connected ── */}
                  {waStatus.isReady && !activeWaChat && (
                    /* ── Chat List ── */
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="p-2.5 border-b border-glass-border/20 shrink-0">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2 text-muted" size={12} />
                          <input
                            type="text"
                            value={waChatSearch}
                            onChange={e => setWaChatSearch(e.target.value)}
                            placeholder="Search chats..."
                            className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-bg3/50 border border-glass-border/30 rounded-xl text-text placeholder-muted focus:outline-none focus:border-primary/40 transition-colors"
                          />
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-glass-border/10">
                        {chatListElement}
                      </div>
                    </div>
                  )}

                  {waStatus.isReady && activeWaChat && (
                    /* ── Active Chat Thread ── */
                    <div className="flex-1 flex flex-col min-h-0">
                      {/* Chat header */}
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-glass-border/20 bg-bg3/15 shrink-0">
                        <div className="w-7 h-7 rounded-full bg-bg3 flex items-center justify-center shrink-0">
                          <Users size={13} className="text-muted" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-bold text-text truncate">{activeWaChat.name}</p>
                          <p className="text-[9px] text-muted font-mono truncate">{(activeWaChat.id || '').replace('@c.us', '')}</p>
                        </div>
                      </div>

                      {/* Messages */}
                      <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar bg-bg/30">
                        {waLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <RefreshCw size={16} className="animate-spin text-muted" />
                          </div>
                        ) : waMessages.length === 0 ? (
                          <div className="text-center text-muted text-[10px] py-12">No messages yet. Send one below.</div>
                        ) : (
                          waMessages.map((msg, idx) => {
                            const prevMsg = waMessages[idx - 1];
                            const showDateDivider = !prevMsg || formatDividerDate(msg.timestamp) !== formatDividerDate(prevMsg.timestamp);
                            return (
                              <React.Fragment key={msg.id || idx}>
                                {showDateDivider && (
                                  <div className="flex justify-center py-2">
                                    <span className="text-[8px] font-bold text-muted bg-bg3/60 px-3 py-1 rounded-full border border-glass-border/20 uppercase tracking-wider">
                                      {formatDividerDate(msg.timestamp)}
                                    </span>
                                  </div>
                                )}
                                <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[11px] leading-relaxed shadow-sm ${
                                    msg.fromMe
                                      ? 'bg-green-500/15 border border-green-500/20 text-text rounded-br-md'
                                      : 'bg-bg3/60 border border-glass-border/25 text-text rounded-bl-md'
                                  }`}>
                                    {msg.hasMedia && (
                                      <WhatsAppMedia
                                        msg={msg}
                                        chatId={activeWaChat.id}
                                        media={loadedMedia[msg.id]}
                                        loading={loadingMedia[msg.id]}
                                        onLoad={() => fetchMedia(msg.id)}
                                        onImageClick={(src, name) => setLightbox({ isOpen: true, src, name })}
                                        onScan={!msg.fromMe ? () => handleManualScan(activeWaChat.id, msg.id) : undefined}
                                      />
                                    )}
                                    {!msg.hasMedia && msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
                                    <p className={`text-[8px] mt-1 ${msg.fromMe ? 'text-green-500/60 text-right' : 'text-muted'}`}>
                                      {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                </div>
                              </React.Fragment>
                            );
                          })
                        )}
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Emoji Picker */}
                      {showEmojiPicker && (
                        <div className="border-t border-glass-border/20 bg-bg2/80 p-2 shrink-0">
                          <div className="flex gap-1 mb-1.5 flex-wrap">
                            {Object.keys(EMOJI_CATEGORIES).map(cat => (
                              <button key={cat} type="button" onClick={() => setActiveEmojiCat(cat)}
                                className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-colors ${
                                  activeEmojiCat === cat ? 'bg-primary/15 text-primary border border-primary/20' : 'text-muted hover:text-text hover:bg-bg3'
                                }`}>
                                {cat}
                              </button>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                            {(EMOJI_CATEGORIES[activeEmojiCat] || []).map(emoji => (
                              <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}
                                className="text-base hover:scale-125 active:scale-95 transition-transform p-0.5 rounded hover:bg-bg3">
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Attached file preview */}
                      {attachedFile && (
                        <div className="px-3 py-1.5 border-t border-glass-border/20 bg-bg2/60 flex items-center gap-2 shrink-0">
                          <FileText size={12} className="text-primary shrink-0" />
                          <span className="text-[10px] text-text truncate flex-1 font-medium">{attachedFile.name}</span>
                          <span className="text-[8px] text-muted font-mono">{(attachedFile.size / 1024).toFixed(0)}KB</span>
                          <button type="button" onClick={clearAttachedFile} className="text-muted hover:text-red-400 transition-colors">
                            <X size={12} />
                          </button>
                        </div>
                      )}

                      {/* Input bar */}
                      <form onSubmit={sendWaMessage} className="flex items-center gap-1.5 p-2.5 border-t border-glass-border/30 bg-bg3/20 shrink-0">
                        <button type="button" onClick={() => setShowEmojiPicker(p => !p)}
                          className={`p-1.5 rounded-lg transition-colors ${showEmojiPicker ? 'bg-primary/15 text-primary' : 'text-muted hover:text-text hover:bg-bg3'}`} title="Emoji">
                          <Smile size={14} />
                        </button>
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                          className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors" title="Attach file">
                          <Paperclip size={14} />
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,.pdf,.doc,.docx,.xlsx,.csv" />
                        <input
                          ref={inputRef}
                          type="text"
                          value={waInput}
                          onChange={e => setWaInput(e.target.value)}
                          placeholder="Type a message..."
                          className="flex-1 bg-bg/50 border border-glass-border/30 rounded-xl px-3 py-1.5 text-[11px] text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-green-500/30 focus:border-green-500/40 transition-all"
                        />
                        <button type="submit" disabled={!waInput.trim() && !attachedFile}
                          className="p-1.5 rounded-xl bg-green-500/15 text-green-500 hover:bg-green-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95" title="Send">
                          <Send size={14} />
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </div>

              {/* Registration / Edit Form */}
              <div className="bg-bg2/60 border border-glass-border p-4.5 rounded-2xl shrink-0 backdrop-blur-md">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="font-bold flex items-center gap-2 text-xs text-text uppercase tracking-wider">
                    <UserPlus size={15} className="text-primary animate-pulse-slow" />
                    {editingId !== null ? 'Edit Patient' : 'Register Patient'}
                  </h3>
                  {selectedPatient && (
                    <div className="flex items-center gap-1.5 text-[10px] bg-bg3/65 border border-glass-border/30 rounded-xl p-1 px-2">
                      <span className="font-bold text-sky truncate max-w-[80px]">{selectedPatient.name}</span>
                      <button onClick={() => handlePatientWaClick(selectedPatient.phone, selectedPatient.name)} className="p-0.5 hover:scale-105 hover:text-green text-[#25D366] transition-colors" title="Send WhatsApp">
                        <MessageSquare size={11} />
                      </button>
                      <button onClick={() => showNotif('Email composer opened')} className="p-0.5 hover:scale-105 hover:text-red text-red transition-colors" title="Send Email">
                        <Mail size={11} />
                      </button>
                      <button onClick={() => setSelectedPatient(null)} className="text-muted hover:text-text"><X size={11} /></button>
                    </div>
                  )}
                </div>
                <form onSubmit={handleSave} className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted uppercase tracking-wider">Name *</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted uppercase tracking-wider">Phone</label>
                      <input
                        type="tel"
                        className="premium-input w-full text-xs rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        placeholder="10-digit number"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        maxLength={10}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted uppercase tracking-wider">Address</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        value={form.address}
                        onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-muted uppercase tracking-wider">Notes</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        placeholder="e.g. Diabetes"
                        value={form.notes}
                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    {editingId !== null && (
                      <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}
                        className="px-3 py-1.5 bg-bg3/65 border border-glass-border/40 hover:bg-bg2 rounded-lg text-muted text-xs transition-colors">
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={saving}
                      className="premium-btn bg-primary hover:bg-green/90 text-bg shadow-[0_4px_12px_rgba(34,197,94,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all font-bold text-xs px-5 py-1.5 rounded-lg"
                    >
                      {saving ? 'Saving...' : editingId !== null ? 'Update' : 'Save'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Unified Patient Timeline (Shows only when patient selected) */}
              {timelineElement}
            </div>
          </div>
        </>
      )}

      {/* Lightbox Modal */}
      {lightbox.isOpen && (
        <div className="fixed inset-0 z-global-modal bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setLightbox({ isOpen: false, src: '', name: '' })}>
          <button 
            onClick={() => setLightbox({ isOpen: false, src: '', name: '' })}
            className="absolute top-4 right-4 p-2.5 bg-bg3 hover:bg-bg2 border border-glass-border rounded-full text-text transition-colors shadow-lg hover:scale-105 active:scale-95"
          >
            <X size={20} />
          </button>
          <div className="max-w-4xl max-h-[80vh] flex items-center justify-center animate-zoom-in" onClick={e => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-glass-border/20" />
          </div>
          <p className="mt-4 text-xs font-bold text-text bg-bg3/80 px-4 py-2 rounded-full border border-glass-border/30 tracking-wide shadow-md backdrop-blur-md">{lightbox.name}</p>
        </div>
      )}

      {/* Ignore List Manager Modal */}
      {showIgnoreModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-bg2/95 border border-glass-border/60 rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] overflow-hidden backdrop-blur-xl animate-zoom-in">
            {/* Header */}
            <div className="p-4 border-b border-glass-border/40 bg-bg3/30 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-primary animate-pulse" />
                <h3 className="font-bold text-xs text-text uppercase tracking-wider">Manage Ignore List</h3>
              </div>
              <button 
                onClick={() => {
                  setShowIgnoreModal(false);
                  setNewIgnorePhone('');
                }}
                className="text-muted hover:text-text hover:bg-bg3 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add Ignore Form */}
            <div className="p-4 border-b border-glass-border/30 bg-bg2/40 shrink-0 space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-wider block mb-1">
                Ignore New Number or Group ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or group ID"
                  value={newIgnorePhone}
                  onChange={(e) => setNewIgnorePhone(e.target.value)}
                  className="flex-1 bg-bg3 border border-glass-border rounded-xl px-3 py-1.5 text-xs text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddIgnore()}
                />
                <button
                  type="button"
                  onClick={handleAddIgnore}
                  className="bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold px-4 py-1.5 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Ignore
                </button>
              </div>
              <p className="text-[9px] text-muted leading-relaxed">
                Tip: 10-digit phone numbers will be automatically formatted (e.g. adding 91 prefix and @c.us suffix).
              </p>
            </div>

            {/* List of ignored numbers */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar bg-bg/10">
              <span className="text-[10px] font-black text-muted uppercase tracking-wider block mb-1">
                Currently Ignored ({ignoredPhones.size})
              </span>
              {Array.from(ignoredPhones.entries()).map(([phone, status]) => {
                const isExplicitUnignored = status === 'unignored';
                const isGroup = phone.endsWith('@g.us') || phone.includes('-');
                
                return (
                  <div 
                    key={phone} 
                    className="flex justify-between items-center bg-bg3/40 border border-glass-border/20 rounded-2xl p-3 hover:bg-bg3/60 hover:border-glass-border/30 transition-all"
                  >
                    <div className="min-w-0 pr-3">
                      <p className="text-xs font-bold text-text truncate">{phone}</p>
                      <p className="text-[8px] text-muted font-mono uppercase mt-0.5">
                        {isGroup ? 'Group Chat' : 'Individual'} • {isExplicitUnignored ? 'Scanning Allowed' : 'Muted'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleIgnore(phone, !isExplicitUnignored)}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-red/10 border border-red/20 text-red-400 hover:bg-red/20 hover:scale-105 active:scale-95 transition-all uppercase tracking-wider text-[9px] shrink-0"
                      title={isExplicitUnignored ? 'Mute' : 'Allow Scanning'}
                    >
                      {isExplicitUnignored ? 'Mute' : 'Unignore'}
                    </button>
                  </div>
                );
              })}

              {ignoredPhones.size === 0 && (
                <div className="text-center py-12 text-muted text-xs font-medium">
                  Ignore list is empty. All active chats will be scanned.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedMatch && (
        <div className="absolute top-0 right-0 h-full w-[400px] bg-bg2/95 border-l border-glass-border/60 z-30 shadow-2xl p-5 flex flex-col gap-4 animate-slide-in backdrop-blur-xl">
          <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
            <AdminMatchPanel
              match={selectedMatch}
              onClose={() => setSelectedMatch(null)}
              onSuccess={(msg) => showNotif(msg)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CRM;
