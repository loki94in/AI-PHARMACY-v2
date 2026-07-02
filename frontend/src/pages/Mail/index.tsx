import { useState, useEffect, useCallback, useRef } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Mail as MailIcon,
  RefreshCw,
  CheckCircle,
  Calendar,
  Paperclip,
  User,
  FileText,
  Loader,
  File,
  FileSpreadsheet,
  Eye,
  Trash2,
  CloudOff,
  CloudLightning,
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

interface EmailRecord {
  id?: number;
  uid?: number;
  from: string;
  subject: string;
  body: string;
  date?: string;
  attachments?: any[];
  distributorName?: string;
  isSeen?: boolean;
  isSaved?: boolean;
  hasAttachments?: boolean;
}

interface AttachmentFile {
  filename: string;
  size: number;
  contentType?: string;
  createdAt?: string;
  isSelected: boolean;
}

const FILE_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  txt: File,
};

const FILE_COLORS: Record<string, string> = {
  pdf: 'text-red',
  csv: 'text-green',
  xlsx: 'text-green',
  xls: 'text-green',
  txt: 'text-muted',
};

function getFileExt(filename: string) {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getEmailStatus(email: EmailRecord): 'new' | 'opened' | 'saved' {
  if (email.isSaved) return 'saved';
  if (email.isSeen) return 'opened';
  return 'new';
}

const STATUS_BADGE: Record<string, { label: string; badgeCls: string; iconCls: string }> = {
  new: {
    label: 'New',
    badgeCls: 'bg-green/10 border-green/30 text-green animate-pulse',
    iconCls: 'bg-green/10 border-green/30 text-green shadow-[0_0_8px_rgba(16,185,129,0.15)]',
  },
  opened: {
    label: 'Opened',
    badgeCls: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    iconCls: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  },
  saved: {
    label: 'Saved & Processed',
    badgeCls: 'bg-primary/15 border-primary/30 text-primary shadow-[0_0_8px_rgba(59,130,246,0.1)]',
    iconCls: 'bg-primary/15 border-primary/30 text-primary',
  },
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'N/A';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

// Module-level cache to persist data across page navigation (unmount/remount)
let cachedEmails: EmailRecord[] = [];
let cachedLastSyncedAt: Date | null = null;
let cachedSelectedEmail: EmailRecord | null = null;
let cachedAttachments: AttachmentFile[] = [];

const Mail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillState = location.state as {
    searchDistributor?: string;
    searchProduct?: string;
    orderId?: number;
  } | null;

  const [emails, setEmails] = useState<EmailRecord[]>(() => cachedEmails);
  const [loading, setLoading] = useState(() => cachedEmails.length === 0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => cachedLastSyncedAt);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(() => cachedSelectedEmail);
  const [attachments, setAttachments] = useState<AttachmentFile[]>(() => cachedAttachments);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const syncInProgress = useRef(false);

  // Asynchronously fetch attachment text preview for PDF, CSV, Excel, and TXT files
  useEffect(() => {
    const activeAtt = attachments.find(a => a.isSelected);
    if (!activeAtt) {
      setPreviewContent('');
      setLoadingPreview(false);
      return;
    }

    const ext = getFileExt(activeAtt.filename);
    const previewableTypes = ['pdf', 'csv', 'txt', 'xlsx', 'xls'];
    if (!previewableTypes.includes(ext)) {
      setPreviewContent('');
      setLoadingPreview(false);
      return;
    }

    setLoadingPreview(true);
    setPreviewContent('');

    api.getAttachmentPreview(activeAtt.filename)
      .then((res: any) => {
        if (res && res.success) {
          setPreviewContent(res.content || '');
        } else {
          setPreviewContent('Preview failed.');
        }
      })
      .catch((err: any) => {
        console.error('Failed to load attachment preview:', err);
        setPreviewContent('Failed to load attachment preview: ' + (err.response?.data?.error || err.message));
      })
      .finally(() => {
        setLoadingPreview(false);
      });
  }, [attachments]);
  

  const [searchTerm, setSearchTerm] = useState(() => {
    return prefillState?.searchDistributor || prefillState?.searchProduct || '';
  });

  const prefillSelectionDone = useRef(false);

  // Synchronize state changes to module-level cache
  useEffect(() => {
    cachedEmails = emails;
  }, [emails]);

  useEffect(() => {
    cachedSelectedEmail = selectedEmail;
  }, [selectedEmail]);

  useEffect(() => {
    cachedAttachments = attachments;
  }, [attachments]);

  useEffect(() => {
    cachedLastSyncedAt = lastSyncedAt;
  }, [lastSyncedAt]);

  // Listen for online/offline events
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Load inbox from local DB (instant, works offline)
  const loadLocalInbox = useCallback(() => {
    if (cachedEmails.length === 0) {
      setLoading(true);
    }
    api
      .getEmailInbox(50)
      .then((data: any) => {
        if (Array.isArray(data)) {
          setEmails(data);
          cachedEmails = data;
        }
      })
      .catch((err: any) => console.error('Error loading inbox:', err))
      .finally(() => setLoading(false));
  }, []);

  // Trigger a background IMAP delta sync
  const triggerSync = useCallback(async () => {
    if (syncInProgress.current || isOffline) return;
    syncInProgress.current = true;
    setSyncing(true);
    try {
      const res = await api.triggerEmailSync();
      if (res && res.synced > 0) {
        // New emails downloaded — refresh the inbox view from local DB
        const data = await api.getEmailInbox(50);
        if (Array.isArray(data)) setEmails(data);
        toastEvent.trigger(`Received ${res.synced} new distributor email(s).`, 'mail', '/mail');
      }
      setLastSyncedAt(new Date());
    } catch (err: any) {
      if (!isOffline) console.error('IMAP sync error:', err);
    } finally {
      setSyncing(false);
      syncInProgress.current = false;
    }
  }, [isOffline]);

  // Silent background refresh from local DB (no loading indicator)
  const silentRefreshLocal = useCallback(() => {
    api
      .getEmailInbox(50)
      .then((data: any) => {
        if (Array.isArray(data)) setEmails(data);
      })
      .catch(() => {});
  }, []);

  // On mount: load local DB instantly.
  // Only trigger IMAP sync if cache is cold (first visit or no cached data).
  // After first visit the 2-minute periodic sync keeps data fresh in the background.
  useEffect(() => {
    loadLocalInbox();
  }, [loadLocalInbox]);

  useDeferredEffect(() => {
    // Only do an immediate IMAP sync on first visit (cold cache).
    // On subsequent visits the page shows cached data instantly with no flicker.
    let syncDelay: ReturnType<typeof setTimeout> | undefined;
    if (cachedEmails.length === 0) {
      syncDelay = setTimeout(() => triggerSync(), 1500);
    }

    // Periodic background refresh: re-read local DB every 30s (silent, no loading indicator).
    const refreshInterval = setInterval(() => silentRefreshLocal(), 30000);

    // Periodic IMAP sync every 2 minutes.
    const syncInterval = setInterval(() => triggerSync(), 120000);

    return () => {
      if (syncDelay) clearTimeout(syncDelay);
      clearInterval(refreshInterval);
      clearInterval(syncInterval);
    };
  }, [triggerSync, silentRefreshLocal]);

  const handleManualRefresh = () => {
    loadLocalInbox();
    triggerSync();
  };

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to delete all cached email attachments? This cannot be undone.')) {
      return;
    }
    try {
      const res = await api.clearAttachmentsCache();
      toastEvent.trigger(res.message || 'Attachments cache cleared successfully.', 'success', '/mail');
      setSelectedEmail(null);
      setAttachments([]);
      setProcessResult(null);
    } catch (err: any) {
      toastEvent.trigger('Failed to clear cache: ' + (err.response?.data?.error || err.message), 'error', '/mail');
    }
  };

  const handleSelectEmail = (email: EmailRecord) => {
    setSelectedEmail(email);
    setAttachments([]);
    cachedAttachments = []; // Clear attachments cache when selecting a new email
    setProcessResult(null);
    if (!email.id) return;

    // Instantly mark as opened in local state (Amber)
    setEmails((prev) =>
      prev.map((e) => (e.id === email.id ? { ...e, isSeen: true } : e))
    );

    // Mark as seen on backend (local DB + IMAP best-effort)
    api.markEmailSeen(email.id).catch((err: any) => {
      console.error('Error marking email as seen:', err);
    });

    setLoadingAttachments(true);
    api
      .getEmailAttachmentsById(email.id)
      .then((data: any) => {
        if (Array.isArray(data)) {
          setAttachments(data.map((a: any) => ({ ...a, isSelected: false })));
        }
      })
      .catch((err: any) => console.error('Error fetching attachments:', err))
      .finally(() => setLoadingAttachments(false));
  };

  const filteredEmails = emails.filter(email => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      email.from.toLowerCase().includes(term) ||
      email.subject.toLowerCase().includes(term) ||
      (email.body && email.body.toLowerCase().includes(term)) ||
      (email.distributorName && email.distributorName.toLowerCase().includes(term))
    );
  });

  // Auto-select first matching email if prefilled search is active
  useEffect(() => {
    if (searchTerm && filteredEmails.length > 0 && !prefillSelectionDone.current && !selectedEmail) {
      prefillSelectionDone.current = true;
      handleSelectEmail(filteredEmails[0]);
    }
  }, [filteredEmails, searchTerm, selectedEmail]);

  const toggleAttachment = (filename: string) => {
    setAttachments((prev) =>
      prev.map((a) => ({
        ...a,
        isSelected: a.filename === filename ? !a.isSelected : false
      }))
    );
  };

  const clearAll = () => setAttachments((prev) => prev.map((a) => ({ ...a, isSelected: false })));

  const selectedCount = attachments.filter((a) => a.isSelected).length;

  const handleProcess = async () => {
    if (!selectedEmail || selectedCount === 0) return;
    setProcessing(true);
    setProcessResult(null);
    try {
      const selectedFiles = attachments.filter((a) => a.isSelected);
      const allItems: any[] = [];
      const results: any[] = [];
      
      let parsedDistributorName = '';
      let parsedInvoiceNo = '';
      let parsedInvoiceDate = '';
      let parsedTotalAmount = 0;
      let parsedGlobalCdPer = 0;

      for (const file of selectedFiles) {
        const res = await api.parseAttachment(file.filename, false);
        results.push({ filename: file.filename, ...res });
        if (res && res.success && Array.isArray(res.items)) {
          allItems.push(...res.items);
          if (res.distributor_name && !parsedDistributorName) parsedDistributorName = res.distributor_name;
          if (res.invoice_no && !parsedInvoiceNo) parsedInvoiceNo = res.invoice_no;
          if (res.invoice_date && !parsedInvoiceDate) parsedInvoiceDate = res.invoice_date;
          if (res.total_amount && !parsedTotalAmount) parsedTotalAmount = res.total_amount;
          if (res.global_cd_per && !parsedGlobalCdPer) parsedGlobalCdPer = res.global_cd_per;
        }
      }

      setProcessResult(results);

      if (allItems.length === 0) {
        toastEvent.trigger('No items could be parsed from the selected attachment(s).', 'error', '/mail');
        return;
      }

      // Mark email as saved (turns Grey) BEFORE navigating away
      if (selectedEmail.id) {
        api.markEmailSaved(selectedEmail.id).then(() => {
          // Update local state immediately to Grey
          setEmails((prev) =>
            prev.map((e) => (e.id === selectedEmail.id ? { ...e, isSaved: true, isSeen: true } : e))
          );
          setSelectedEmail((prev) => prev ? { ...prev, isSaved: true, isSeen: true } : null);
        }).catch(console.error);
      }

      const invoiceNoMatch = selectedEmail.subject.match(/INV-\d+-\d+/i) || selectedEmail.subject.match(/\b([A-Z0-9_\-\/]{4,15})\b/);

      navigate('/manual-purchase', {
        state: {
          prefilledPurchase: {
            distributorName: parsedDistributorName || selectedEmail.distributorName || '',
            invoiceNo: parsedInvoiceNo || (invoiceNoMatch ? invoiceNoMatch[0] : ''),
            date: parsedInvoiceDate || (selectedEmail.date ? new Date(selectedEmail.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
            totalAmount: parsedTotalAmount || 0,
            globalCdPer: parsedGlobalCdPer || 0,
            source_filename: selectedFiles[0]?.filename || '',
            source_file_headers: results[0]?.headers || [],
            mapping_config: results[0]?.mapping_config || {},
            items: allItems.map(item => ({
              medicine_name: item.name || '',
              qty: item.quantity || 0,
              free_qty: item.free_qty || 0,
              rate: item.rate || 0,
              mrp: item.mrp || 0,
              batch_no: item.batch_no || '',
              expiry_date: item.expiry_date || '',
              cgst_per: item.cgst_per || 0,
              sgst_per: item.sgst_per || 0,
              cd_per: item.cd_per || 0,
              cd_rs: item.cd_rs || 0,
            }))
          },
          emailSource: {
            email_uid: selectedEmail.id,  // used by Purchases page to mark email as saved
            from: selectedEmail.from,
            subject: selectedEmail.subject,
            date: selectedEmail.date,
            distributorName: parsedDistributorName || selectedEmail.distributorName || '',
            medicineNames: allItems.map(item => item.name || '').filter(Boolean),
            attachmentCount: selectedFiles.length,
          }
        }
      });
    } catch (err: any) {
      console.error('Error processing attachments:', err);
      toastEvent.trigger('Failed to process one or more files.', 'error', '/mail');
    } finally {
      setProcessing(false);
    }
  };

  // Relative time string
  const relTime = lastSyncedAt
    ? (() => {
        const secs = Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000);
        if (secs < 5) return 'just now';
        if (secs < 60) return `${secs}s ago`;
        return `${Math.floor(secs / 60)}m ago`;
      })()
    : null;

  return (
    <div className="h-full flex flex-col fade-in space-y-4 overflow-hidden pb-4">


      {/* Status Legend */}
      <div className="flex items-center gap-4 px-1 text-[10px] text-muted">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          New (unread)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Opened (not saved)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Saved &amp; Processed (bill created)
        </div>
        <div className="ml-auto text-muted font-mono">
          {emails.length} email{emails.length !== 1 ? 's' : ''} stored locally
        </div>
      </div>

      {/* Main Two-Panel Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 overflow-hidden">
        {/* LEFT: Email List */}
        <div className="lg:col-span-3 glass-panel flex flex-col overflow-hidden bg-white/5 border-glass-border relative">
          <div className="p-3 border-b border-glass-border bg-black/10 text-xs font-bold text-muted uppercase tracking-wider select-none flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Inbox ({filteredEmails.length !== emails.length ? `${filteredEmails.length}/${emails.length}` : emails.length})</span>
              {(loading || syncing) && emails.length > 0 && (
                <span className="text-[10px] text-primary font-bold uppercase tracking-widest flex items-center gap-1.5 animate-pulse ml-2">
                  <Loader size={10} className="animate-spin" />
                  {syncing ? 'Syncing...' : 'Loading...'}
                </span>
              )}
            </div>
            {(selectedEmail || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedEmail(null);
                  setAttachments([]);
                  setProcessResult(null);
                  setSearchTerm('');
                }}
                className="text-primary hover:text-blue-400 normal-case tracking-normal"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Search/Filter input field */}
          <div className="p-2 border-b border-glass-border bg-bg3/20 flex items-center gap-2 relative shrink-0">
            <input
              type="text"
              placeholder="Search distributor, subject, body..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-black/25 border border-glass-border rounded-lg px-3 py-1.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary/50"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-4 text-muted hover:text-text text-xs font-semibold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Prefill Banner when special order linking is active */}
          {prefillState && searchTerm === (prefillState.searchDistributor || prefillState.searchProduct) && (
            <div className="bg-primary/10 border-b border-glass-border p-2.5 text-xs text-sky flex items-center justify-between shrink-0 font-medium">
              <span> Prefilled filters active for Special Order Request.</span>
              <button
                onClick={() => setSearchTerm('')}
                className="underline text-[10px] hover:text-white"
              >
                Show All
              </button>
            </div>
          )}

          {/* Slim progress bar during sync/load */}
          <div className="relative">
            {(loading || syncing) && emails.length > 0 && (
              <div className="h-0.5 w-full bg-primary/20 overflow-hidden absolute top-0 left-0 z-50">
                <div className="h-full bg-primary animate-pulse w-full" style={{ animationDuration: '1s' }} />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-black/10 divide-y divide-glass-border/20">
            {loading && emails.length === 0 ? (
              <div className="p-12 text-center text-muted flex flex-col items-center gap-3">
                <Loader className="animate-spin text-primary" size={24} />
                <span className="text-xs uppercase font-semibold animate-pulse">Loading local inbox...</span>
              </div>
            ) : emails.length === 0 ? (
              <div className="p-16 text-center text-muted flex flex-col items-center gap-2 italic text-xs">
                <MailIcon size={28} className="opacity-50" />
                {isOffline
                  ? 'No emails stored locally. Connect to internet and refresh to sync.'
                  : 'No emails yet. Syncing from Gmail...'}
                {syncing && <Loader size={16} className="animate-spin text-primary mt-2" />}
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="p-16 text-center text-muted flex flex-col items-center gap-2 italic text-xs">
                <MailIcon size={28} className="opacity-50" />
                No emails found matching "{searchTerm}"
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-primary hover:text-blue-400 font-bold not-italic"
                >
                  Clear search query
                </button>
              </div>
            ) : (
              filteredEmails.map((email, idx) => {
                const status = getEmailStatus(email);
                const s = STATUS_BADGE[status];
                return (
                  <button
                    key={email.id || idx}
                    onClick={() => handleSelectEmail(email)}
                    className={`w-full text-left p-4 hover:bg-white/5 transition-all flex items-start gap-3 ${
                      selectedEmail?.id === email.id
                        ? 'bg-primary/5 border-l-2 border-primary'
                        : 'border-l-2 border-transparent'
                    }`}
                  >
                    <div className={`p-2 rounded-xl border flex-shrink-0 mt-0.5 transition-all ${s.iconCls}`}>
                      <MailIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-text truncate flex items-center gap-1" title={email.from}>
                          <User size={12} className="text-muted flex-shrink-0" /> 
                          {email.from}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-bold uppercase select-none ${s.badgeCls}`}>
                            {s.label}
                          </span>
                          {email.hasAttachments && (
                            <Paperclip size={10} className="text-muted flex-shrink-0" />
                          )}
                          <span className="text-[10px] text-muted font-mono flex items-center gap-1">
                            <Calendar size={10} />
                            {email.date ? formatDate(email.date) : 'Today'}
                          </span>
                        </div>
                      </div>
                      <h4 className="text-xs font-bold text-sky truncate">{email.subject}</h4>
                      <p className="text-[11px] text-muted truncate">
                        {email.body || '(No preview)'}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Floating Action Buttons */}
          <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2">
            {syncing && (
              <div className="flex items-center gap-1.5 text-[10px] text-primary font-semibold animate-pulse px-3 py-2 rounded-full bg-glass-bg/85 border border-glass-border/40 shadow-lg backdrop-blur-sm">
                <CloudLightning size={12} className="animate-bounce" />
                <span className="hidden sm:inline">Syncing...</span>
              </div>
            )}
            {!syncing && relTime && (
              <span className="text-[9px] text-muted font-mono px-3 py-2 rounded-full bg-glass-bg/85 border border-glass-border/40 shadow-lg backdrop-blur-sm hidden sm:inline">Synced {relTime}</span>
            )}

            {/* Connectivity indicator */}
            {isOffline ? (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-amber/10 border border-amber/30 text-[10px] text-amber font-bold select-none shadow-lg backdrop-blur-sm">
                <CloudOff size={12} />
                <span>OFFLINE</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-green/10 border border-green/30 text-[10px] text-green font-bold select-none shadow-lg backdrop-blur-sm">
                <span className="h-1.5 w-1.5 bg-green rounded-full animate-ping" />
                <span>ONLINE</span>
              </div>
            )}

            <button
              onClick={handleManualRefresh}
              className="p-2.5 rounded-full bg-bg2/90 hover:bg-bg3/95 border border-glass-border text-text transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 text-xs font-semibold shadow-lg backdrop-blur-sm"
              title="Refresh Inbox"
            >
              <RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={handleClearCache}
              className="p-2.5 rounded-full bg-red/10 hover:bg-red/20 border border-red/30 text-red hover:text-red-400 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 text-xs font-semibold shadow-lg backdrop-blur-sm"
              title="Clear Attachments Cache"
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Clear Cache</span>
            </button>
          </div>
        </div>

        {/* RIGHT: Email Details + Attachments */}
        <div className="lg:col-span-2 glass-panel flex flex-col bg-white/5 border-glass-border overflow-hidden">
          {selectedEmail ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Email Header */}
              <div className="p-4 border-b border-glass-border space-y-2 flex-shrink-0">
                <div className="flex justify-between items-start gap-2">
                  <h4 className="text-xs font-bold text-sky uppercase tracking-wide">Email Details</h4>
                  <button
                    onClick={() => { setSelectedEmail(null); setAttachments([]); setProcessResult(null); }}
                    className="text-[10px] font-bold text-muted hover:text-text hover:bg-white/5 px-2 py-0.5 rounded border border-glass-border/30"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="font-bold text-muted mr-1.5">From:</span>
                    <span className="font-semibold text-text">
                      {selectedEmail.from}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold text-muted mr-1.5">Subject:</span>
                    <span className="font-semibold text-text">{selectedEmail.subject}</span>
                  </div>
                  <div>
                    <span className="font-bold text-muted mr-1.5">Date:</span>
                    <span className="font-mono text-muted">
                      {selectedEmail.date ? formatDateTime(selectedEmail.date) : 'N/A'}
                    </span>
                  </div>
                  <div className="pt-1">
                    {(() => {
                      const s = STATUS_BADGE[getEmailStatus(selectedEmail)];
                      return (
                        <span className={`text-[9px] px-2 py-0.5 rounded-md border font-bold uppercase ${s.badgeCls}`}>
                          Status: {s.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {/* Email Body */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Message Content</h4>
                  <div className="bg-bg3/25 border border-glass-border/30 rounded-xl p-3.5 text-xs text-text whitespace-pre-wrap font-medium leading-relaxed max-h-48 overflow-y-auto custom-scrollbar select-text">
                    {selectedEmail.body ? selectedEmail.body.trim() : '(No message body)'}
                  </div>
                </div>

                {/* Attachments Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                      <Paperclip size={12} />
                      Attachments ({attachments.length})
                    </h4>
                    {attachments.length > 0 && attachments.some(a => a.isSelected) && (
                      <div className="flex gap-2">
                        <button onClick={clearAll} className="text-[10px] font-bold text-muted hover:text-text cursor-pointer">Clear Selection</button>
                      </div>
                    )}
                  </div>

                  {loadingAttachments ? (
                    <div className="p-8 text-center text-muted flex flex-col items-center gap-2">
                      <Loader className="animate-spin text-primary" size={20} />
                      <span className="text-xs">Loading files...</span>
                    </div>
                  ) : attachments.length === 0 ? (
                    <div className="p-8 text-center text-muted flex flex-col items-center gap-2 italic text-xs">
                      <FileText size={24} className="opacity-50" />
                      No attachments found for this email
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {attachments.map((att) => {
                        const ext = getFileExt(att.filename);
                        const Icon = FILE_ICONS[ext] || File;
                        const color = FILE_COLORS[ext] || 'text-muted';
                        return (
                          <div
                            key={att.filename}
                            onClick={() => toggleAttachment(att.filename)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer ${
                              att.isSelected
                                ? 'bg-primary/10 border-primary/30 shadow-[0_0_8px_rgba(59,130,246,0.1)]'
                                : 'bg-white/5 border-glass-border hover:bg-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                checked={att.isSelected}
                                onChange={() => toggleAttachment(att.filename)}
                                className="accent-primary w-4 h-4"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className={`p-2 rounded-lg bg-white/5 border border-glass-border flex-shrink-0 ${color}`}>
                                <Icon size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-text truncate">{att.filename}</div>
                                <div className="text-[10px] text-muted mt-0.5">
                                  {formatBytes(att.size)}
                                  {att.contentType && <> &middot; {att.contentType}</>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => window.open(`/uploads/${encodeURIComponent(att.filename)}`, '_blank')}
                                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-text border border-glass-border/60 transition-all cursor-pointer"
                                  title="View file"
                                >
                                  <Eye size={14} />
                                </button>
                                {att.isSelected && <CheckCircle size={16} className="text-primary flex-shrink-0" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Inline Attachment Preview */}
                {attachments.find(a => a.isSelected) && (
                  <div className="border border-glass-border/30 rounded-xl overflow-hidden bg-black/20 flex flex-col h-[400px]">
                    <div className="p-2.5 bg-bg3/30 border-b border-glass-border/30 flex justify-between items-center text-xs font-bold text-muted uppercase tracking-wider">
                      <span className="truncate max-w-[250px]">Preview: {attachments.find(a => a.isSelected)?.filename}</span>
                      <button
                        onClick={() => window.open(`/uploads/${encodeURIComponent(attachments.find(a => a.isSelected)!.filename)}`, '_blank')}
                        className="text-primary hover:underline cursor-pointer font-bold shrink-0 uppercase"
                      >
                        Open in New Tab
                      </button>
                    </div>
                    <div className="flex-1 bg-white/5 relative">
                      {(() => {
                        const selectedAtt = attachments.find(a => a.isSelected);
                        if (!selectedAtt) return null;
                        const ext = getFileExt(selectedAtt.filename);
                        const previewableTypes = ['pdf', 'csv', 'txt', 'xlsx', 'xls'];

                        if (loadingPreview) {
                          return (
                            <div className="h-full flex items-center justify-center text-xs text-muted flex-col gap-2 p-6 text-center uppercase">
                              <Loader className="animate-spin text-primary" size={24} />
                              <span>Parsing &amp; loading preview...</span>
                            </div>
                          );
                        }

                        if (previewableTypes.includes(ext)) {
                          return (
                            <pre className="w-full h-full p-4 overflow-auto text-xs font-mono text-text bg-bg2 whitespace-pre select-text uppercase">
                              {previewContent || 'No text content extracted or empty file.'}
                            </pre>
                          );
                        }

                        return (
                          <div className="h-full flex items-center justify-center text-xs text-muted flex-col gap-2 p-6 text-center uppercase">
                            <FileText size={32} className="opacity-40" />
                            <span>Preview not supported for this file type. Click "Open in New Tab" or process the file directly.</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Process Result */}
                {processResult && (
                  <div className="mt-3 p-3 rounded-xl bg-green/10 border border-green/20 text-xs space-y-1 uppercase">
                    <div className="font-bold text-green flex items-center gap-1">
                      <CheckCircle size={12} /> Processing Complete
                    </div>
                    {processResult.map((r: any, i: number) => (
                      <div key={i} className="text-green/80">
                        {r.filename}: {r.items?.length || 0} items parsed
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Process Button */}
              <div className="p-4 border-t border-glass-border flex-shrink-0 space-y-2">
                <div className="text-[11px] text-muted">
                  {selectedCount === 0
                    ? 'Select files above to proceed'
                    : `${selectedCount} file(s) selected`}
                </div>
                <button
                  onClick={handleProcess}
                  disabled={processing || selectedCount === 0}
                  className={`w-full premium-btn text-xs font-bold uppercase tracking-wider py-2.5 flex items-center justify-center gap-2 rounded-xl transition-all ${
                    processing || selectedCount === 0
                      ? 'bg-white/5 border border-glass-border text-muted cursor-not-allowed'
                      : 'bg-green text-text shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:bg-green/90'
                  }`}
                >
                  {processing ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet size={14} />
                      Process &amp; Create Purchase Bill
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col h-full justify-center items-center text-center space-y-4 py-8 px-4">
              <div className="p-4 rounded-full bg-white/5 text-muted border border-glass-border/40 animate-pulse">
                <MailIcon size={32} className="opacity-80" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-text">Select an Email</h4>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Mail;
