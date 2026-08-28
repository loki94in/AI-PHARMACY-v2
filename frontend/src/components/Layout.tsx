import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  PackageSearch,
  ShoppingCart,
  Receipt,
  Users,
  Settings as SettingsIcon,
  Activity,
  Brain,
  LogOut,
  Database,
  RotateCcw,
  ClipboardList,
  Plus,
  Check,
  AlertTriangle,
  Bell,
  BellRing,
  X,
  Sun,
  Moon,
  Trash2,
  ExternalLink,
  Info,
  ChevronRight,
  Mail as MailIcon,
  Smartphone,
  ClipboardPlus,
  RefreshCw,
  Building2,
  Clock,
  Edit,
  Menu,
  Truck,
  Package,
  Keyboard,
  FileText,
  Loader2,
  ChevronDown,
  BrainCircuit,
  MessageCircle,
  MessageSquareText,
} from 'lucide-react';
import { shortcutEvent, SHORTCUT_DIRECTORY } from '../services/keyboardShortcuts';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Activity as ActivityIcon,
  ShieldCheck as ShieldCheckIcon,
  Clock as ClockIcon,
  AlertTriangle as AlertIcon,
  MessageSquare as MessageSquareIcon,
  Send as SendIcon
} from 'lucide-react';


import { toastEvent, quickOrderEvent, liveCartAddEvent, refillEvent, whatsappQueueEvent, messageSendEvent, specialOrdersEvent, automationHubEvent } from '../services/events';
import type { ToastEventDetail } from '../services/events';
import { QuickOrderModal } from './QuickOrderModal';
import { LiveCartAddModal } from './LiveCartAddModal';
import { WhatsAppQueuePopover } from './WhatsAppQueuePopover';
import AutomationHubPopover from './AutomationHubPopover';
import { StagedReviewModal } from './StagedReviewModal';
import { MobileConnectionModal } from './MobileConnectionModal';
import { ConnectedDevicesFooterBar } from './ConnectedDevicesFooterBar';
import { api, apiClient, isCompactInventoryCacheReady, setCompactInventoryCache } from '../services/api';
import type { SpecialOrder, Refill, AutomationNotification } from '../services/api';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { useApiQuery } from '../hooks/useApiQuery';
import { pageImports } from '../lib/pageImports';
import BackupCenterModal from './BackupCenterModal';
import { useFetchMode } from '../hooks/useFetchMode';
import { useGlobalSseInvalidation } from '../hooks/useGlobalSseInvalidation';

export interface AppNotification {
  id: number | string;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
  distributor?: string;
  qty?: string | number;
}

// Defer non-critical startup work until the browser is idle (falls back to a 2s
// timeout where requestIdleCallback isn't available, e.g. Safari), so it doesn't
// compete with first paint / LCP. Returns a cancel function for effect cleanup.

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
export interface AppNotification {
  id: number | string;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
  distributor?: string;
  qty?: string | number;
}

interface LocalActionLogRow {
  id: number;
  action_type?: string | null;
  description?: string | null;
  created_at?: string;
}

interface LocalApiErrorShape {
  response?: { status?: number; data?: { error?: string } };
  message?: string;
}

// ──────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────
// memo: chrome is isolated from navigation re-renders — Sidebar subscribes to
// the router itself so the active highlight updates without Layout re-renders.
const Sidebar = memo(({
  stagedSalesCount = 0,
  stagedPurchasesCount = 0,
  onOpenReview,
  mobileOpen = false,
  onClose,
}: {
  stagedSalesCount?: number;
  stagedPurchasesCount?: number;
  onOpenReview?: () => void;
  mobileOpen?: boolean;
  onClose?: () => void;
}) => {
  const queryClient = useQueryClient();
  const routeLoc = useLocation();
  const hoverPrefetchControl = useFetchMode('layout.hoverPrefetch');
  const menuItems = [
    { path: '/pos', label: 'Sales / POS', icon: <ShoppingCart size={18} /> },
    { path: '/sells', label: 'Sell', icon: <Receipt size={18} /> },
    { path: '/inventory', label: 'Inventory', icon: <PackageSearch size={18} /> },
    { path: '/purchase-history', label: 'Purchase History', icon: <ClipboardList size={18} /> },
    { path: '/purchases', label: 'Purchases', icon: <Receipt size={18} /> },
    { path: '/mail', label: 'Distributor Mail', icon: <Activity size={18} /> },
    { path: '/reports', label: 'Reports', icon: <LayoutDashboard size={18} /> },
    { path: '/pharmarack-cart', label: 'Pharmarack Cart', icon: <ShoppingCart size={18} /> },
    { path: '/investigation', label: 'Investigation Center', icon: <PackageSearch size={18} /> },
    { path: '/ai-engineering', label: 'Pharma Intelligence', icon: <BrainCircuit size={18} /> },
    { path: '/learning', label: 'AI Learning', icon: <Brain size={18} /> },
    { path: '/dispatch', label: 'Dispatch', icon: <Truck size={18} /> },
    { path: '/crm', label: 'CRM & Messages', icon: <Users size={18} /> },
    { path: '/returns', label: 'Supplier Returns', icon: <RotateCcw size={18} /> },
    { path: '/database', label: 'Master Database', icon: <Database size={18} /> },
    { path: '/phone-sales', label: 'Phone Sales', icon: <Smartphone size={18} /> },
    { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { path: '/migration', label: 'Data Migration', icon: <Database size={18} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
    { path: '/audit', label: 'Audit Center', icon: <ShieldCheckIcon size={18} /> },
  ];

  return (
    <>
      {/* Mobile/tablet backdrop — click to dismiss */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[8999] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        className={`
          fixed inset-y-0 left-0 z-drawer w-72 max-w-[85vw]
          lg:static lg:z-auto lg:w-64 lg:max-w-none
          bg-glass-bg border-r border-glass-border backdrop-blur-xl flex flex-col h-full
          transition-transform duration-300 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
        `}
      >
        <div className="p-5 border-b border-glass-border flex flex-col gap-1 bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3 w-full relative">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky/20 to-sky/5 border border-sky/30 shadow-[0_0_15px_rgba(14,165,233,0.2)] shrink-0 transition-all duration-300">
              <svg className="w-6 h-6 text-sky drop-shadow-[0_0_6px_rgba(14,165,233,0.6)]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4V20M4 12H20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                <path d="M12 8.5V15.5M8.5 12H15.5" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-base font-black tracking-wider bg-gradient-to-r from-text to-sky bg-clip-text text-transparent leading-none">
                AI PHARMACY
              </h1>
              <p className="text-[9px] text-muted tracking-widest uppercase font-bold mt-1.5 leading-none">OS Version 2.0</p>
            </div>
            <div className="shrink-0 pl-2 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green"></span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close navigation menu"
                className="lg:hidden p-1.5 -mr-1.5 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Sync Review Indicator */}
        {(stagedSalesCount > 0 || stagedPurchasesCount > 0) && (
          <button
            onClick={onOpenReview}
            className="mx-4 my-2.5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-left hover:bg-amber-500/20 transition-all duration-300 animate-pulse cursor-pointer shrink-0"
          >
            <div className="flex-1 min-w-0 pr-1">
              <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Sync Reviews Pending</div>
              <div className="text-[9px] text-muted truncate mt-0.5">
                {stagedSalesCount > 0 ? `${stagedSalesCount} sales ` : ''}
                {stagedSalesCount > 0 && stagedPurchasesCount > 0 ? '& ' : ''}
                {stagedPurchasesCount > 0 ? `${stagedPurchasesCount} purchases` : ''}
              </div>
            </div>
            <ChevronRight size={14} className="text-amber-500 shrink-0" />
          </button>
        )}

        <div className="py-4 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="px-5 mb-2 text-[10px] font-bold tracking-[0.15em] uppercase text-muted/70">Main Menu</div>
          <nav className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = (() => {
                const [basePath, queryStr] = item.path.split('?');
                if (routeLoc.pathname !== basePath) return false;
                const targetTab = queryStr ? new URLSearchParams(queryStr).get('tab') : null;
                const currentTab = new URLSearchParams(routeLoc.search).get('tab');
                if (targetTab) {
                  return currentTab === targetTab;
                } else {
                  if (basePath === '/reports') return true;
                  if (basePath === '/database') return !currentTab || currentTab === 'products';
                  if (basePath === '/learning') return !currentTab || currentTab === 'clinical';
                  if (basePath === '/returns') return !currentTab || currentTab === 'returns';
                  if (basePath === '/pharmarack-cart') return !currentTab || currentTab === 'cart';
                  return true;
                }
              })();

              // Staged sync count badges
              let badge = null;
              if (item.path.startsWith('/sells') && stagedSalesCount > 0) {
                badge = (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[9px] font-black text-white px-1 border border-black/40 animate-pulse">
                    {stagedSalesCount}
                  </span>
                );
              } else if (item.path.startsWith('/purchases') && stagedPurchasesCount > 0) {
                badge = (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-accent text-[9px] font-black text-black px-1 border border-black/40 animate-pulse">
                    {stagedPurchasesCount}
                  </span>
                );
              }

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onMouseEnter={() => {
                    const basePath = item.path.split('?')[0];
                    pageImports[basePath]?.();

                    if (!hoverPrefetchControl.shouldFetch) return;

                    // Prefetch API data for primary queries on hover (improved page switch response time)
                    try {
                      if (basePath === '/dashboard') {
                        queryClient.prefetchQuery({
                          queryKey: ['dashboard'],
                          queryFn: () => api.getDashboard(),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/pos') {
                        queryClient.prefetchQuery({
                          queryKey: ['pos-common-combinations'],
                          queryFn: () => api.getDoctors(),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/mail') {
                        queryClient.prefetchQuery({
                          queryKey: ['email-inbox'],
                          queryFn: () => api.getEmailInbox(50),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/pharmarack-cart') {
                        queryClient.prefetchQuery({
                          queryKey: ['pharmarack-cart'],
                          queryFn: () => api.getPharmarackCart(),
                          staleTime: 5 * 60_000,
                        });
                      }
                    } catch (err) {
                      console.warn('Prefetch error:', err);
                    }
                  }}
                  onClick={onClose}
                  className={`
                  flex items-center gap-3 px-5 py-2.5 mx-2 rounded-lg text-sm font-medium uppercase transition-all duration-200
                  ${isActive
                      ? 'text-white bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary shadow-[inset_0_0_20px_rgba(59,130,246,0.1)]'
                      : 'text-muted hover:text-white hover:bg-white/5 hover:translate-x-1 border-l-2 border-transparent'}
                `}
                >
                  <span className={`${isActive ? 'text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' : ''}`}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Bottom Footer: Log Out */}
        <div className="p-3 mx-2 border-t border-glass-border/60 shrink-0">
          <button
            onClick={() => {
              try {
                localStorage.removeItem('user_session');
                sessionStorage.clear();
              } catch (_) {}
              toastEvent.trigger('Logged out of AI PHARMACY OS', 'info');
              setTimeout(() => {
                window.location.reload();
              }, 300);
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-semibold text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
            title="Log Out of System"
          >
            <LogOut size={16} />
            <span>Log Out</span>
          </button>
        </div>

      </div>
    </>
  );
});

// ──────────────────────────────────────────────
// Flash Toast — small pop at top-center
// ──────────────────────────────────────────────
const FlashToast = ({
  toast,
  onDismiss,
  onOpenReview,
  onOpenAutomationHub,
}: {
  toast: (ToastEventDetail & { id: number }) | null;
  onDismiss: () => void;
  onOpenReview: () => void;
  onOpenAutomationHub?: () => void;
}) => {
  if (!toast) return null;

  const cfg = {
    success: { bg: 'bg-bg2 border-emerald-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Check size={15} className="shrink-0 text-emerald-400" /> },
    error: { bg: 'bg-bg2 border-red-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <AlertTriangle size={15} className="shrink-0 text-red-400" /> },
    info: { bg: 'bg-bg2 border-border text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Info size={15} className="shrink-0 text-muted" /> },
    mail: { bg: 'bg-bg2 border-indigo-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <MailIcon size={15} className="shrink-0 text-indigo-400" /> },
    automation: { bg: 'bg-bg2 border-purple-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Activity size={15} className="shrink-0 text-purple-400" /> },
  }[toast.type] || { bg: 'bg-bg2 border-border text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Info size={15} className="shrink-0 text-muted" /> };

  const isStagedSync = toast.message.toLowerCase().includes('sync') || toast.message.toLowerCase().includes('staged');
  const isWaFailure = toast.type === 'error' && (toast.message.toLowerCase().includes('whatsapp') || toast.message.toLowerCase().includes('automation'));

  return (
    <div
      key={toast.id}
      onClick={() => {
        if (isWaFailure && onOpenAutomationHub) {
          onOpenAutomationHub();
          onDismiss();
        }
      }}
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-toast
        flex items-center gap-2.5 px-4 py-2.5 rounded-2xl
        border ${cfg.bg}
        animate-soft-toast opacity-100
        min-w-[260px] max-w-[450px]
        ${isWaFailure ? 'cursor-pointer hover:border-red-400/80 transition-colors' : ''}
      `}
    >
      {cfg.icon}
      <span className="text-sm font-semibold flex-1 leading-snug">
        {toast.message}
        {isWaFailure && (
          <span className="block text-[10px] text-sky-400 font-bold uppercase tracking-wider mt-0.5">
            Click to view in Automation Hub →
          </span>
        )}
      </span>
      {isStagedSync && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenReview();
            onDismiss();
          }}
          className="ml-2 bg-primary hover:bg-primary/80 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors shrink-0"
        >
          Proceed
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="ml-1.5 opacity-50 hover:opacity-100 transition-opacity shrink-0"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
};

// ──────────────────────────────────────────────
// Notification Panel
// ──────────────────────────────────────────────
const NotificationPanel = ({
  notifications,
  onClearAll,
  onClearOne,
  onMarkRead,
  onClose,
}: {
  notifications: AppNotification[];
  onClearAll: () => void;
  onClearOne: (id: number | string) => void;
  onMarkRead: (id: number | string) => void;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'alerts'>('all');
  const [actionLogs, setActionLogs] = useState<LocalActionLogRow[]>([]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const typeConfig = (type: string) => {
    if (type === 'success') return { badgeBg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', icon: <Check size={13} />, label: 'Success' };
    if (type === 'error') return { badgeBg: 'bg-rose-500/10 border-rose-500/20 text-rose-400', icon: <AlertTriangle size={13} />, label: 'Error' };
    if (type === 'mail') return { badgeBg: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400', icon: <MailIcon size={13} />, label: 'Mail' };
    if (type === 'automation') return { badgeBg: 'bg-purple-500/10 border-purple-500/20 text-purple-400', icon: <Activity size={13} />, label: 'Automation' };
    return { badgeBg: 'bg-sky-500/10 border-sky-500/20 text-sky-400', icon: <Info size={13} />, label: 'Info' };
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiClient.get('/notifications/action-logs?limit=150');
      if (res.data?.success && Array.isArray(res.data?.logs)) {
        setActionLogs(res.data.logs);
      }
    } catch (_) { }
  }, []);

  useEffect(() => {
    fetchLogs();
    // P1 "events, not timers": refresh the log list only when a new activity
    // is actually logged server-side (SSE push) — no 5s polling.
    window.addEventListener('sse-activity-logged', fetchLogs);
    return () => window.removeEventListener('sse-activity-logged', fetchLogs);
  }, [fetchLogs]);

  // Combine real-time toasts and persistent DB action_logs into unified Activity feed
  const combinedActivities = useMemo(() => {
    const toastItems: AppNotification[] = notifications.map(n => ({
      ...n,
      time: n.time instanceof Date ? n.time : new Date(n.time)
    }));

    const logItems: AppNotification[] = actionLogs.map(l => {
      let type: AppNotification['type'] = 'info';
      const actionType = String(l.action_type || '').toUpperCase();
      if (actionType.includes('FAIL') || actionType.includes('ERROR')) type = 'error';
      else if (actionType.includes('SALE') || actionType.includes('SUCCESS') || actionType.includes('ADD') || actionType.includes('SAVE')) type = 'success';
      else if (actionType.includes('AUTOMATION') || actionType.includes('WHATSAPP')) type = 'automation';
      else if (actionType.includes('MAIL')) type = 'mail';

      return {
        id: `log-${l.id}`,
        message: l.description || 'System Activity Logged',
        type,
        time: new Date(l.created_at || Date.now()),
        read: true,
      };
    });

    const merged = [...toastItems];
    const existingMessages = new Set(toastItems.map(t => t.message));
    logItems.forEach(item => {
      if (!existingMessages.has(item.message)) {
        merged.push(item);
      }
    });

    return merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [notifications, actionLogs]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const alertCount = combinedActivities.filter(n => n.type === 'error' || n.type === 'automation').length;

  const filteredNotifications = combinedActivities.filter(n => {
    if (activeFilter === 'unread') return !n.read;
    if (activeFilter === 'alerts') return n.type === 'error' || n.type === 'automation';
    return true;
  });

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-3 w-[420px] max-w-[calc(100vw-1.5rem)] z-dropdown flex flex-col rounded-3xl overflow-hidden bg-bg2 border border-border shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 opacity-100"
      style={{
        boxShadow: '0 25px 65px rgba(0,0,0,0.5), 0 0 35px rgba(0, 0, 0, 0.2)',
      }}
    >
      {/* Header Bar */}
      <div className="p-4 border-b border-border bg-bg flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm relative">
              <BellRing size={17} className="animate-pulse" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-400 border-2 border-bg2 animate-ping" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-text tracking-tight">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[10px] font-extrabold tracking-wide shadow-sm shadow-sky-500/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    <span>{unreadCount} unread</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted font-medium">Real-time store events & system status</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                whatsappQueueEvent.triggerOpen();
                onClose();
              }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition-all px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 cursor-pointer shadow-sm"
              title="Open WhatsApp Queue Controller"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <MessageSquareIcon size={12} />
              <span>Queue</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigate('/settings');
                onClose();
              }}
              className="p-1.5 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              title="Notification Settings"
            >
              <SettingsIcon size={15} />
            </button>
            {combinedActivities.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  setActionLogs([]);
                  await onClearAll();
                  toastEvent.trigger('All notifications & activity alerts wiped out', 'info');
                }}
                className="p-1.5 rounded-xl text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                title="Clear All Notifications & Activity Alerts"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Filter Segmented Control Bar */}
        <div className="flex items-center justify-between bg-bg3/60 p-1 rounded-2xl border border-border/50">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeFilter === 'all'
                  ? 'bg-bg text-text shadow-sm border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                }`}
            >
              All ({combinedActivities.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unread')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeFilter === 'unread'
                  ? 'bg-bg text-sky-400 shadow-sm border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                }`}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-extrabold font-mono leading-none border border-sky-500/30">
                  {unreadCount}
                </span>
              )}
            </button>
            {alertCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter('alerts')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeFilter === 'alerts'
                    ? 'bg-bg text-purple-400 shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                Alerts ({alertCount})
              </button>
            )}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => notifications.forEach(n => { if (!n.read) onMarkRead(n.id); })}
              className="text-[11px] font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer px-2 py-1 rounded-xl hover:bg-sky-500/10"
              title="Mark all notifications as read"
            >
              <Check size={12} />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification Cards List Container */}
      <div className="max-h-[400px] min-h-[180px] overflow-y-auto custom-scrollbar p-3 space-y-2">
        {filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-14 h-14 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3 shadow-inner">
              <Bell size={24} className="text-primary opacity-80" />
            </div>
            <h4 className="text-text text-sm font-bold">
              {activeFilter === 'unread' ? 'No unread notifications' : activeFilter === 'alerts' ? 'No system alerts' : 'All caught up!'}
            </h4>
            <p className="text-muted text-xs mt-1 max-w-[240px] leading-relaxed">
              {activeFilter === 'all'
                ? 'You have reviewed all recent updates and operational alerts.'
                : 'No pending items matching this view.'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif) => {
            const cfg = typeConfig(notif.type);
            return (
              <div
                key={notif.id}
                onClick={() => { if (!notif.read) onMarkRead(notif.id); }}
                className={`
                  group rounded-2xl p-3.5 border transition-all duration-200 cursor-pointer relative overflow-hidden flex flex-col gap-2
                  ${!notif.read
                    ? 'bg-sky-500/[0.04] border-sky-500/30 shadow-sm hover:border-sky-500/50'
                    : 'bg-bg/40 border-border/60 hover:bg-bg3/60 hover:border-border'}
                `}
              >
                {/* Vertical Indicator Strip for Unread Items */}
                {!notif.read && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-sky-400 to-indigo-500 rounded-l-2xl" />
                )}

                {/* Top Row: Type Pill + Time + Unread Dot */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase tracking-wider ${cfg.badgeBg}`}>
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </span>
                    <span className="text-[10px] text-muted font-mono font-medium">{formatTime(notif.time)}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {!notif.read && (
                      <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                    )}
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onMarkRead(notif.id);
                      }}
                      className={`p-1 rounded-lg transition-all ${notif.read
                          ? 'text-muted/40 hover:text-sky-400 hover:bg-sky-500/10'
                          : 'text-sky-400 hover:bg-sky-500/20'
                        }`}
                      title={notif.read ? "Mark as unread" : "Mark as read"}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={async e => {
                        e.stopPropagation();
                        if (typeof notif.id === 'string' && notif.id.startsWith('log-')) {
                          const numId = parseInt(notif.id.replace('log-', ''), 10);
                          if (!isNaN(numId)) {
                            setActionLogs(prev => prev.filter(l => l.id !== numId));
                          }
                        }
                        onClearOne(notif.id);
                      }}
                      className="p-1 rounded-lg text-muted/40 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                      title="Remove notification"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* Middle Content */}
                <p className={`text-xs leading-relaxed ${!notif.read ? 'text-text font-semibold' : 'text-muted font-medium'}`}>
                  {notif.message}
                </p>

                {/* Metadata Tags & Action Row */}
                <div className="flex items-center justify-between pt-1 border-t border-border/30 mt-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {notif.distributor && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold">
                        <Building2 size={10} />
                        {notif.distributor}
                      </span>
                    )}
                    {notif.qty !== undefined && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        Qty: {notif.qty}
                      </span>
                    )}
                  </div>

                  {(notif.link || notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation') && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        if (!notif.read) onMarkRead(notif.id);
                        if (notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation' || !notif.link) {
                          whatsappQueueEvent.triggerOpen();
                        } else {
                          navigate(notif.link!);
                        }
                        onClose();
                      }}
                      className={`inline-flex items-center gap-1 text-[11px] font-bold transition-all px-2.5 py-1 rounded-xl cursor-pointer ${notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation'
                          ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25'
                          : 'text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25'
                        }`}
                    >
                      {notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation' ? (
                        <>
                          <MessageSquareIcon size={11} />
                          <span>View Queue</span>
                        </>
                      ) : (
                        <>
                          <ExternalLink size={11} />
                          <span>Open</span>
                        </>
                      )}
                      <ChevronRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Summary */}
      {combinedActivities.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border bg-bg/40 flex items-center justify-between text-xs text-muted font-medium">
          <span>{combinedActivities.length} total item{combinedActivities.length !== 1 ? 's' : ''}</span>
          <span className="text-[10px] font-mono text-muted/70">Live Activity Feed</span>
        </div>
      )}
    </div>
  );
};

const DeviceIcon = ({ os, size = 16, className = "" }: { os: string; size?: number; className?: string }) => {
  const normalizedOs = os.toLowerCase();
  if (normalizedOs.includes('ios') || normalizedOs.includes('apple') || normalizedOs.includes('mac') || normalizedOs.includes('iphone') || normalizedOs.includes('ipad')) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.12.09 2.27-.56 2.95-1.39z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <path d="M17.5 8c.46 0 .89.11 1.28.31l1.58-1.58c.2-.2.51-.2.71 0s.2.51 0 .71l-1.63 1.63C19.78 9.77 20 10.86 20 12v3H4v-3c0-1.14.22-2.23.63-3.12L3 7.25c-.2-.2-.2-.51 0-.71s.51-.2.71 0l1.58 1.58C5.68 8.11 6.11 8 6.5 8h11M7 11.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1m10 0c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1M16 16v4.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V16H11v4.5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5V16H4.5C3.67 16 3 15.33 3 14.5V14h18v.5c0 .83-.67 1.5-1.5 1.5H16z" />
    </svg>
  );
};

// ──────────────────────────────────────────────
// Live Header Clock
// ──────────────────────────────────────────────
const LiveHeaderClock = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-glass-border bg-glass-bg text-text shadow-sm hover:border-primary/30 transition-all cursor-default select-none shrink-0"
      title={`Live System Clock (${now.toLocaleString()})`}
    >
      <Clock size={13} className="text-sky-400 animate-pulse shrink-0" />
      <div className="flex items-center gap-1.5 font-mono text-xs">
        <span className="font-bold text-text tracking-wide">{timeStr}</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Topbar
// ──────────────────────────────────────────────
const Topbar = memo(({
  theme,
  setTheme,
  notifications,
  hasUnread,
  onNewNotification,
  onClearAll,
  onClearOne,
  onMarkRead,
  onOpenStagedReview,
  onOpenConnectModal,
  onOpenWaQueue,
  onOpenAutomationHub,
  automationHubHeadline = 'idle',
  onMenuClick,
  compactCacheLoaded = false,
}: {
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  notifications: AppNotification[];
  hasUnread: boolean;
  onNewNotification: (n: ToastEventDetail) => void;
  onClearAll: () => void;
  onClearOne: (id: number | string) => void;
  onMarkRead: (id: number | string) => void;
  onOpenStagedReview: () => void;
  onOpenConnectModal: () => void;
  onOpenWaQueue?: () => void;
  onOpenAutomationHub?: () => void;
  automationHubHeadline?: 'sending' | 'failed' | 'idle';
  onMenuClick?: () => void;
  compactCacheLoaded?: boolean;
}) => {
  const navigate = useNavigate();
  const [showPanel, setShowPanel] = useState(false);
  const [flashToast, setFlashToast] = useState<(ToastEventDetail & { id: number }) | null>(null);
  const [catalogJob, setCatalogJob] = useState<{
    id: number;
    status: string;
    progress: number;
    total_count?: number;
    processed_count?: number;
  } | null>(null);
  const [enrichmentRunning, setEnrichmentRunning] = useState(false);

  useEffect(() => {
    const fetchActiveJob = async () => {
      try {
        const { data } = await apiClient.get('/jobs');
        if (Array.isArray(data)) {
          const activeJob = data.find(j => ['processing', 'pending', 'pending_analysis', 'processing_analysis'].includes(j.status));
          if (activeJob) {
            setCatalogJob({
              id: activeJob.id,
              status: activeJob.status,
              progress: activeJob.progress || 0,
              total_count: activeJob.total_count,
              processed_count: activeJob.processed_count
            });
          } else {
            setCatalogJob(null);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch active catalog job in Topbar:', err);
      }
    };
    fetchActiveJob();

    if (!compactCacheLoaded) return;

    // Background enrichment permanently stopped by user
    setEnrichmentRunning(false);
  }, [compactCacheLoaded]);

  const [backupStatus, setBackupStatus] = useState<{ active: boolean; label: string }>({ active: false, label: '' });
  const [ocrStatus, setOcrStatus] = useState<{ active: boolean; label?: string; progress?: number; reviewNeeded?: boolean }>({ active: false });
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const hubHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHubMouseEnter = () => {
    if (hubHoverTimerRef.current) {
      clearTimeout(hubHoverTimerRef.current);
      hubHoverTimerRef.current = null;
    }
    setIsCarouselHovered(true);
    setIsHoverExpanded(true);
  };

  const handleHubMouseLeave = () => {
    if (hubHoverTimerRef.current) {
      clearTimeout(hubHoverTimerRef.current);
    }
    hubHoverTimerRef.current = setTimeout(() => {
      setIsCarouselHovered(false);
      setIsHoverExpanded(false);
      hubHoverTimerRef.current = null;
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (hubHoverTimerRef.current) {
        clearTimeout(hubHoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleBackupStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ active?: boolean; label?: string }>).detail;
      if (detail) {
        setBackupStatus({ active: !!detail.active, label: detail.label || 'Database Backup in progress...' });
      }
    };
    const handleOcrStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ active?: boolean; label?: string; progress?: number; reviewNeeded?: boolean }>).detail;
      if (detail) {
        setOcrStatus({
          active: !!detail.active,
          label: detail.label || 'Scanning Distributor Invoice...',
          progress: detail.progress !== undefined ? detail.progress : 65,
          reviewNeeded: !!detail.reviewNeeded
        });
      }
    };
    window.addEventListener('backup-status-changed', handleBackupStatus);
    window.addEventListener('ocr-status-changed', handleOcrStatus);
    return () => {
      window.removeEventListener('backup-status-changed', handleBackupStatus);
      window.removeEventListener('ocr-status-changed', handleOcrStatus);
    };
  }, []);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [connectedDevices, setConnectedDevices] = useState<{ token: string; device_name: string; os: string; is_online: number; last_seen: string; offline_seconds?: number }[]>([]);
  const [showDevicesPopover, setShowDevicesPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [renamingToken, setRenamingToken] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/notifications/devices');
      if (data && Array.isArray(data.devices)) {
        setConnectedDevices(data.devices);
      }
    } catch (err) {
      console.warn('Failed to fetch connected devices:', err);
    }
  }, []);

  const handleRenameDevice = useCallback(async (token: string, name: string) => {
    if (!name.trim()) return;
    try {
      await apiClient.patch(`/notifications/devices/${token}/rename`, { name: name.trim() });
      setConnectedDevices(prev => prev.map(d => d.token === token ? { ...d, device_name: name.trim() } : d));
    } catch (err) {
      console.warn('Failed to rename device:', err);
    } finally {
      setRenamingToken(null);
      setRenameValue('');
    }
  }, []);

  const [servicesStatus, setServicesStatus] = useState<{
    pharmarack: { connected: boolean; isRefreshing: boolean; lastError: string | null };
    whatsapp: { connected: boolean; initializing: boolean; isSyncing: boolean; pendingQueueCount: number; sleeping?: boolean };
    gaters?: { automation: boolean; whatsapp: boolean; telegram: boolean; email: boolean };
  } | null>(null);
  const servicesStatusRef = useRef(servicesStatus);
  servicesStatusRef.current = servicesStatus;

  const [waQueueDetail, setWaQueueDetail] = useState<{
    isProcessing: boolean;
    isPaused?: boolean;
    activeTargetName?: string | null;
    counts: { pending: number; sending: number; sent: number; failed_offline: number; failed_perm: number };
  } | null>(null);

  const [isQueueActive, setIsQueueActive] = useState<boolean>(false);

  const notifiedFailedQueueIdsRef = useRef<Set<number>>(new Set());

  const [lastQueueCompletedAt, setLastQueueCompletedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!lastQueueCompletedAt) return;
    const elapsed = Date.now() - lastQueueCompletedAt;
    const remaining = Math.max(0, 5000 - elapsed);
    const timer = setTimeout(() => setLastQueueCompletedAt(null), remaining);
    return () => clearTimeout(timer);
  }, [lastQueueCompletedAt]);

  const fetchServicesStatus = useCallback(async () => {
    try {
      const { api } = await import('../services/api.js');
      const res = await api.getServicesStatus();
      if (res && res.success && res.services) {
        servicesStatusRef.current = res.services;
        setServicesStatus(res.services);
      }
    } catch (err) {
      console.warn('[Layout] Failed to fetch services status:', err);
    }
  }, []);

  const fetchWhatsAppQueueStatus = useCallback(async () => {
    try {
      const curServices = servicesStatusRef.current;
      if (curServices && (!curServices.whatsapp?.connected || curServices.whatsapp?.isSyncing === false && !curServices.whatsapp?.connected)) {
        return;
      }
      const { api } = await import('../services/api.js');
      const qData = await api.getWhatsAppQueueStatus();
      if (qData) {
        setWaQueueDetail({
          isProcessing: qData.isProcessing,
          isPaused: qData.isPaused,
          activeTargetName: qData.activeTargetName,
          counts: qData.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 }
        });
        const pending = qData.counts?.pending || 0;
        const sending = qData.counts?.sending || 0;
        const active = pending > 0 || sending > 0 || !!qData.isProcessing;
        setIsQueueActive(active);

        if (Array.isArray(qData.recentItems)) {
          qData.recentItems.forEach((item) => {
            // Freshness guard: only surface failures from the last 15 minutes so
            // persisted historical rows don't re-toast on every new UI session.
            const isRecent = !item.created_at || (Date.now() - Number(item.created_at)) < 15 * 60 * 1000;
            if ((item.status === 'failed_perm' || (item.status === 'failed_offline' && item.retry_count >= 3)) && isRecent && !notifiedFailedQueueIdsRef.current.has(item.id)) {
              notifiedFailedQueueIdsRef.current.add(item.id);
              const target = item.target_name || (item.number ? `+${item.number}` : 'Recipient');
              toastEvent.trigger(`❌ WhatsApp message to ${target} failed: ${item.error_message || 'Permanent send failure'}`, 'error');
            }
          });
        }
      }
    } catch (err) {
      console.warn('[Layout] Failed to fetch whatsapp queue status:', err);
    }
  }, []);

  // Services status: fetch on mount, on focus, and on SSE push events.
  // No interval — P1 "events, not timers" (API_OPTIMIZATION plan Phase 3).
  useEffect(() => {
    if (!compactCacheLoaded) return;
    fetchServicesStatus();
    fetchWhatsAppQueueStatus();

    const handleRefreshStatus = () => {
      fetchServicesStatus();
      fetchWhatsAppQueueStatus();
    };

    window.addEventListener('focus', handleRefreshStatus);
    window.addEventListener('refresh-pharmarack-cart', handleRefreshStatus);
    window.addEventListener('pharmarack-auth-changed', handleRefreshStatus);
    window.addEventListener('sse-wa-status-changed', handleRefreshStatus);
    window.addEventListener('sse-pharmarack-refreshed', fetchServicesStatus);

    return () => {
      window.removeEventListener('focus', handleRefreshStatus);
      window.removeEventListener('refresh-pharmarack-cart', handleRefreshStatus);
      window.removeEventListener('pharmarack-auth-changed', handleRefreshStatus);
      window.removeEventListener('sse-wa-status-changed', handleRefreshStatus);
      window.removeEventListener('sse-pharmarack-refreshed', fetchServicesStatus);
    };
  }, [fetchServicesStatus, fetchWhatsAppQueueStatus, compactCacheLoaded]);

  // WhatsApp queue status: event-driven. Poll ONLY while the queue is actively
  // sending (3s) AND the window is visible; hidden windows pause polling and
  // refresh once on return-to-visible plus via queue events / focus / SSE.
  useEffect(() => {
    if (!compactCacheLoaded) return;
    fetchWhatsAppQueueStatus();
    const qInterval = isQueueActive && document.visibilityState === 'visible'
      ? setInterval(fetchWhatsAppQueueStatus, 3000)
      : null;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isQueueActive) fetchWhatsAppQueueStatus();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const unsubOpen = whatsappQueueEvent.subscribeOpen(() => {
      onOpenWaQueue?.();
      fetchWhatsAppQueueStatus();
    });

    const unsubUpdated = whatsappQueueEvent.subscribeUpdated(() => {
      fetchWhatsAppQueueStatus();
    });

    const handleSseQueue = () => {
      fetchWhatsAppQueueStatus();
      fetchServicesStatus();
    };
    window.addEventListener('sse-wa-queue-updated', handleSseQueue);

    return () => {
      if (qInterval) clearInterval(qInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubOpen();
      unsubUpdated();
      window.removeEventListener('sse-wa-queue-updated', handleSseQueue);
    };
  }, [compactCacheLoaded, isQueueActive, fetchWhatsAppQueueStatus, fetchServicesStatus, onOpenWaQueue]);

  // Active Manual/Automated Message Send 10-second Progress state
  const [activeMsgProgress, setActiveMsgProgress] = useState<{
    id: string;
    recipient: string;
    progress: number;
    secondsLeft: number;
    completed: boolean;
  } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined = undefined;
    const unsubSend = messageSendEvent.subscribeSendProgress((detail) => {
      const durationSec = detail.durationSec || 10;
      const totalSteps = durationSec * 10; // 100ms ticks
      let currentStep = 0;

      if (timer) clearInterval(timer);

      setActiveMsgProgress({
        id: detail.id || `msg-${Date.now()}`,
        recipient: detail.recipient,
        progress: 0,
        secondsLeft: durationSec,
        completed: false,
      });

      timer = setInterval(() => {
        currentStep++;
        const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
        const secsLeft = Math.max(0, Math.ceil(durationSec - (currentStep / 10)));

        if (currentStep >= totalSteps) {
          clearInterval(timer);
          setActiveMsgProgress(prev => prev ? { ...prev, progress: 100, secondsLeft: 0, completed: true } : null);
          setTimeout(() => {
            setActiveMsgProgress(null);
          }, 3000);
        } else {
          setActiveMsgProgress(prev => prev ? { ...prev, progress: percent, secondsLeft: secsLeft } : null);
        }
      }, 100);
    });

    return () => {
      if (timer) clearInterval(timer);
      unsubSend();
    };
  }, []);

  // Upcoming Automations (5-Minute Prior Notification) State & Polling
  const [upcomingTriggers, setUpcomingTriggers] = useState<Array<{
    id: string;
    name: string;
    category: string;
    secondsUntilRun: number;
    nextRunIso: string;
    isSnoozed: boolean;
    description: string;
  }>>([]);

  const fetchUpcomingTriggers = useCallback(async () => {
    try {
      const res = await api.getUpcomingTriggers(5);
      if (res?.success && Array.isArray(res.upcoming)) {
        setUpcomingTriggers(res.upcoming.filter(t => !t.isSnoozed && t.secondsUntilRun > 0));
      }
    } catch (_) { }
  }, []);

  // Upcoming triggers: fetch on mount / focus / relevant SSE events; the local
  // countdown ticks are UI-only (no network). When a countdown expires we
  // re-fetch once to pick up the next run time — no fixed interval.
  useEffect(() => {
    fetchUpcomingTriggers();

    const handleSseTriggers = () => fetchUpcomingTriggers();
    window.addEventListener('focus', fetchUpcomingTriggers);
    window.addEventListener('refresh-special-orders', handleSseTriggers);
    window.addEventListener('app-refills-updated', handleSseTriggers);
    window.addEventListener('sse-dispatch-updated', handleSseTriggers);
    return () => {
      window.removeEventListener('focus', fetchUpcomingTriggers);
      window.removeEventListener('refresh-special-orders', handleSseTriggers);
      window.removeEventListener('app-refills-updated', handleSseTriggers);
      window.removeEventListener('sse-dispatch-updated', handleSseTriggers);
    };
  }, [fetchUpcomingTriggers]);

  const triggersRefetchLockRef = useRef(0);

  useEffect(() => {
    if (upcomingTriggers.length === 0) return;
    const tick = setInterval(() => {
      // Hidden window: pause countdown churn and the throttled network refetch;
      // the visibilitychange handler resyncs from the server on return.
      if (document.visibilityState !== 'visible') return;
      setUpcomingTriggers(prev =>
        prev.map(t => ({ ...t, secondsUntilRun: Math.max(0, t.secondsUntilRun - 1) }))
          .filter(t => t.secondsUntilRun > 0)
      );
      // A countdown just expired → a trigger likely ran server-side. Refresh
      // the upcoming list at most once per minute.
      if (upcomingTriggers.some(t => t.secondsUntilRun <= 1)) {
        const now = Date.now();
        if (now - triggersRefetchLockRef.current > 60000) {
          triggersRefetchLockRef.current = now;
          fetchUpcomingTriggers();
        }
      }
    }, 1000);
    const handleTriggerVisibility = () => {
      // Resync countdowns from the server on return-to-visible (same 60s lock).
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - triggersRefetchLockRef.current > 60000) {
        triggersRefetchLockRef.current = now;
        fetchUpcomingTriggers();
      }
    };
    document.addEventListener('visibilitychange', handleTriggerVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', handleTriggerVisibility);
    };
  }, [upcomingTriggers.length, upcomingTriggers, fetchUpcomingTriggers]);

  // Consolidate Active Header Notification Carousel Items
  const isWaActive = (waQueueDetail?.counts?.pending || 0) > 0 || (waQueueDetail?.counts?.sending || 0) > 0 || waQueueDetail?.isProcessing;
  const isWaRecentlyDone = !isWaActive && (waQueueDetail?.counts?.sent || 0) > 0 && lastQueueCompletedAt !== null;

  const activeHeaderItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'whatsapp' | 'backup' | 'catalog' | 'notification';
      title: string;
      subtitle?: string;
      progress?: number;
      badge?: string;
      color: 'emerald' | 'purple' | 'sky' | 'amber';
      action?: () => void;
      actionLabel?: string;
      icon: React.ReactNode;
    }> = [];

    // 0. Active Manual/Automated Message Send (Highest Priority 10s Animation)
    if (activeMsgProgress) {
      items.push({
        id: activeMsgProgress.id,
        type: 'whatsapp',
        title: activeMsgProgress.completed ? `✓ Message Delivered to ${activeMsgProgress.recipient}` : `Sending Message to ${activeMsgProgress.recipient}`,
        subtitle: activeMsgProgress.completed ? '✓ Delivery confirmed (100% Complete)' : `▶ Dispatching: ${activeMsgProgress.progress}% loaded • ${activeMsgProgress.secondsLeft}s countdown remaining`,
        progress: activeMsgProgress.progress,
        badge: activeMsgProgress.completed ? '100% Done' : `${activeMsgProgress.progress}% (${activeMsgProgress.secondsLeft}s)`,
        color: 'emerald',
        icon: <SendIcon size={12} className="text-emerald-400 animate-pulse shrink-0" />
      });
    }

    // 1. WhatsApp Queue Progress
    const waTotal = (waQueueDetail?.counts?.sent || 0) + (waQueueDetail?.counts?.pending || 0) + (waQueueDetail?.counts?.sending || 0);
    const waSent = waQueueDetail?.counts?.sent || 0;
    const waPercent = waTotal > 0 ? Math.round((waSent / waTotal) * 100) : 100;

    if (isWaActive || isWaRecentlyDone) {
      items.push({
        id: 'wa-queue',
        type: 'whatsapp',
        title: waQueueDetail?.isPaused
          ? `⏰ Scheduled: WhatsApp ${waQueueDetail?.counts?.pending || waTotal} Messages Ready`
          : isWaRecentlyDone ? 'WhatsApp: All Sent' : `WhatsApp: ${waSent}/${waTotal} Sent (${waPercent}%)`,
        subtitle: waQueueDetail?.isPaused
          ? '⏸ Waiting for Play button to send'
          : waQueueDetail?.activeTargetName ? `▶ ${waQueueDetail.activeTargetName}` : undefined,
        progress: waPercent,
        badge: isWaRecentlyDone ? 'Done' : waQueueDetail?.isPaused ? 'Waiting Play' : 'Sending',
        color: waQueueDetail?.isPaused ? 'amber' : 'emerald',
        action: waQueueDetail?.isPaused
          ? async () => {
            try {
              await apiClient.post('/whatsapp/queue/toggle-pause');
              window.dispatchEvent(new CustomEvent('cache-invalidate'));
            } catch (err) {
              console.error('Failed to unpause queue:', err);
            }
          }
          : onOpenWaQueue,
        actionLabel: waQueueDetail?.isPaused ? '▶ SEND NOW' : 'View Queue',
        icon: waQueueDetail?.isPaused ? <ClockIcon size={12} className="text-amber-400 animate-pulse shrink-0" /> : <MessageSquareIcon size={12} className="text-emerald-400 animate-pulse shrink-0" />
      });
    }

    // 2. Database Backup Progress
    if (backupStatus.active) {
      items.push({
        id: 'backup',
        type: 'backup',
        title: 'Database Backup Running',
        subtitle: backupStatus.label || 'Creating compressed database backup...',
        progress: 100,
        badge: 'Backing Up',
        color: 'purple',
        icon: <Database size={12} className="text-purple-400 animate-spin shrink-0" />
      });
    }

    // 3. Catalog Sync Progress
    if (catalogJob && catalogJob.status === 'processing') {
      items.push({
        id: 'catalog',
        type: 'catalog',
        title: `Catalog Syncing (${catalogJob.progress || 0}%)`,
        subtitle: 'Updating inventory reference catalog...',
        progress: catalogJob.progress || 0,
        badge: 'Syncing',
        color: 'sky',
        icon: <RefreshCw size={12} className="text-sky-400 animate-spin shrink-0" />
      });
    }

    // 4. Invoice OCR Scanning Progress
    if (ocrStatus.active) {
      items.push({
        id: 'ocr-scan',
        type: 'notification',
        title: `📄 Invoice OCR: ${ocrStatus.label || 'Scanning'} (${ocrStatus.progress || 0}%)`,
        subtitle: 'Parsing invoice lines & GST tax fields...',
        progress: ocrStatus.progress || 0,
        badge: 'Scanning',
        color: 'sky',
        action: () => navigate('/learning?tab=ocr'),
        actionLabel: 'Review',
        icon: <FileText size={12} className="text-sky-400 animate-pulse shrink-0" />
      });
    }


    return items;
  }, [activeMsgProgress, waQueueDetail, isWaActive, isWaRecentlyDone, backupStatus, catalogJob, ocrStatus, onOpenWaQueue, navigate]);


  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);
  const [isManualCarouselPaused, setIsManualCarouselPaused] = useState(false);

  // Auto-rotate ticker every 4 seconds unless hovered or manually paused
  useEffect(() => {
    if (activeHeaderItems.length <= 1 || isCarouselHovered || isManualCarouselPaused) return;
    const timer = setInterval(() => {
      setCarouselIndex(prev => (prev + 1) % activeHeaderItems.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [activeHeaderItems.length, isCarouselHovered, isManualCarouselPaused]);

  const activeIndex = carouselIndex >= activeHeaderItems.length ? 0 : carouselIndex;
  const currentHeaderItem = activeHeaderItems[activeIndex];

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // 1-time startup check for Pharmarack cart sync status after initial window.
  // Two windows: 46s (original) plus a 110s re-check giving the backend boot cart
  // warm-up time to resolve the coordinator after a slow headless session refresh.
  useEffect(() => {
    let toasted = false;
    const checkSyncStatus = async () => {
      try {
        const syncStatus = await api.getStartupSyncStatus();
        if (syncStatus.timedOut && !syncStatus.cartLoaded && !toasted) {
          toasted = true;
          toastEvent.trigger(
            '⚠️ Pharmarack cart sync pending — Session may need refresh from Learning page.',
            'info'
          );
        }
      } catch (_) {}
    };
    const timer1 = setTimeout(checkSyncStatus, 46000);
    const timer2 = setTimeout(checkSyncStatus, 110000);

    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowDevicesPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Global App-Wide Keyboard Shortcuts System (Ctrl+S, Escape, Ctrl+/, ?)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag);

      // 1. Intercept Ctrl + S or Cmd + S globally
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        shortcutEvent.triggerSave();
        return;
      }

      // 2. Intercept Escape globally
      if (e.key === 'Escape') {
        if (showShortcutHelp) {
          setShowShortcutHelp(false);
          return;
        }
        setShowPanel(false);
        setShowDevicesPopover(false);
        shortcutEvent.triggerCloseModal();
        return;
      }

      // 3. Intercept Ctrl + / or ? to toggle Keyboard Shortcuts Cheat Sheet
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }
      if (e.key === '?' && !isInputFocused) {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    const unsubscribeHelp = shortcutEvent.subscribeToggleHelp(() => {
      setShowShortcutHelp(prev => !prev);
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      unsubscribeHelp();
    };
  }, [showShortcutHelp]);

  // Flash toast only for errors — success/info/mail/automation log silently to Activity panel only
  useEffect(() => {
    return toastEvent.subscribe((detail) => {
      onNewNotification(detail);
      // ponytail: only errors surface as flash popups; everything else is panel-only
      if (detail.type !== 'error') return;
      const id = Date.now();
      setFlashToast({ ...detail, id });
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashToast(null), 4200);
    });
  }, [onNewNotification]);

  const onlineDevicesCount = connectedDevices.filter(d => d.is_online === 1).length;

  return (
    <>
      <FlashToast
        toast={flashToast}
        onDismiss={() => setFlashToast(null)}
        onOpenReview={onOpenStagedReview}
        onOpenAutomationHub={onOpenAutomationHub}
      />

      <header className="h-14 bg-glass-bg border-b border-glass-border backdrop-blur-xl flex items-center justify-between px-3 sm:px-6 relative z-sticky-header shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="lg:hidden shrink-0 p-1.5 -ml-1 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Menu size={20} />
          </button>
          <LiveHeaderClock />
          {catalogJob && (
            <div className="flex items-center gap-2.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-xl text-primary animate-pulse">
              <RefreshCw size={12} className="animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Catalog: {catalogJob.status === 'pending_analysis' ? 'Analyzing' : catalogJob.status === 'processing_analysis' ? 'Processing analysis' : 'Ingesting'} ({Math.round(catalogJob.progress)}%)
              </span>
            </div>
          )}
          {enrichmentRunning && (
            <div className="flex items-center gap-2 px-3 py-1 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-400">
              <RefreshCw size={12} className="animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Enriching compositions...</span>
            </div>
          )}
        </div>

        {/* CENTER SECTION: Auto-Hides in Idle state */}
        <div
          className="flex-1 flex justify-center items-center px-2 sm:px-4 max-w-[460px] mx-auto min-w-0 h-full relative"
        >
          {activeHeaderItems.length > 0 && currentHeaderItem && (
            <div className="w-full flex flex-col justify-center gap-0.5 h-full relative cursor-pointer group/progress origin-center transition-all duration-300 animate-in fade-in zoom-in-95">
              {/* Default Minimized Sleek Inline Header Row */}
              <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {currentHeaderItem.icon}
                  <span className="truncate text-text font-bold text-xs tracking-tight">
                    {currentHeaderItem.title}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {currentHeaderItem && currentHeaderItem.action && (
                    <button
                      type="button"
                      onClick={currentHeaderItem.action}
                      className="text-[10px] font-bold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer uppercase tracking-wider pl-1"
                    >
                      {currentHeaderItem.actionLabel || 'View'}
                    </button>
                  )}
                </div>
              </div>

              {/* Direct Inline Line Filling Progress Bar Track inside header bar */}
              {currentHeaderItem && currentHeaderItem.progress !== undefined && (
                <div className="w-full h-1 bg-bg border-t border-glass-border/40 rounded-full overflow-hidden relative shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-500 relative bg-gradient-to-r ${currentHeaderItem.color === 'purple'
                        ? 'from-purple-500 via-indigo-500 to-sky-400'
                        : currentHeaderItem.color === 'sky'
                          ? 'from-sky-500 via-blue-500 to-cyan-400'
                          : currentHeaderItem.color === 'amber'
                            ? 'from-amber-500 to-orange-400'
                            : 'from-emerald-500 via-teal-400 to-emerald-400'
                      }`}
                    style={{ width: `${Math.min(100, Math.max(0, currentHeaderItem.progress))}%` }}
                  >
                    <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/80 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile Connection / Devices Status (Auto-hides when no devices connected) */}
          {(connectedDevices.length > 0 || onlineDevicesCount > 0) && (
            <div className="relative" ref={popoverRef}>
              <button
                onClick={() => setShowDevicesPopover(prev => !prev)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer text-xs font-semibold uppercase tracking-wider
                  ${onlineDevicesCount > 0
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-white/5'}
                `}
                title="Connected Mobile Devices"
              >
                <Smartphone size={14} className={onlineDevicesCount > 0 ? "animate-pulse" : ""} />
                <span>{onlineDevicesCount > 0 ? `${onlineDevicesCount} Online` : 'Offline'}</span>
              </button>

              {showDevicesPopover && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-glass-bg border border-glass-border backdrop-blur-2xl rounded-2xl shadow-2xl p-4 z-dropdown">
                  <div className="flex items-center justify-between pb-3 border-b border-glass-border mb-3">
                    <span className="text-xs font-bold uppercase text-text/80 tracking-wide">Sync Devices</span>
                    <button
                      onClick={() => { setShowDevicesPopover(false); onOpenConnectModal(); }}
                      className="flex items-center gap-1 text-[10px] font-black uppercase text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <Plus size={12} />
                      Add Device
                    </button>
                  </div>

                  {connectedDevices.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted/60">
                      No devices registered. Click "Add Device" to pair a mobile phone.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
                      {connectedDevices.map(device => (
                        <div key={device.token} className="flex items-start justify-between p-2 rounded-xl bg-white/[0.02] border border-glass-border hover:bg-white/[0.04] transition-all">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <div className={`mt-0.5 p-1 rounded-lg ${device.is_online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-black/20 text-muted'}`}>
                              <DeviceIcon os={device.os} size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {renamingToken === device.token ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    className="w-full bg-black/40 border border-primary/40 rounded px-1.5 py-0.5 text-xs text-text focus:outline-none"
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleRenameDevice(device.token, renameValue);
                                      if (e.key === 'Escape') setRenamingToken(null);
                                    }}
                                  />
                                  <button onClick={() => handleRenameDevice(device.token, renameValue)} className="text-emerald-400 hover:text-emerald-300">
                                    <Check size={12} />
                                  </button>
                                  <button onClick={() => setRenamingToken(null)} className="text-red-400 hover:text-red-300">
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group/name">
                                  <span className="text-xs font-semibold text-text truncate max-w-[120px]">{device.device_name}</span>
                                  <button
                                    onClick={() => { setRenamingToken(device.token); setRenameValue(device.device_name); }}
                                    className="opacity-0 group-hover/name:opacity-100 text-[10px] text-muted hover:text-text transition-opacity"
                                  >
                                    <Edit size={10} />
                                  </button>
                                </div>
                              )}
                              <div className="text-[9px] text-muted uppercase font-bold tracking-wider mt-0.5">{device.os}</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${device.is_online ? 'bg-emerald-400 animate-pulse' : 'bg-muted/30'}`} />
                            <span className="text-[8px] text-muted font-mono whitespace-nowrap">
                              {device.is_online ? 'ONLINE' : (device.offline_seconds && device.offline_seconds > 86400) ? 'OFFLINE' : 'RECENT'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pharmarack Live Cart Connection Status */}
          <Link
            to="/pharmarack-cart"
            className={`
              hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-glass-border hover:bg-bg3/60 transition-all cursor-pointer text-xs font-semibold uppercase tracking-wider
              ${servicesStatus?.pharmarack?.isRefreshing
                ? 'text-amber-400'
                : servicesStatus?.pharmarack?.connected
                  ? 'text-emerald-400'
                  : 'text-rose-400'}
            `}
            title={servicesStatus?.pharmarack?.connected ? "Pharmarack Live Cart Online" : "Pharmarack Session Expired - Click to Re-authenticate"}
          >
            <ShoppingCart size={13} className={servicesStatus?.pharmarack?.isRefreshing ? "animate-spin" : ""} />
            <span>
              {servicesStatus?.pharmarack?.isRefreshing
                ? 'Refreshing'
                : servicesStatus?.pharmarack?.connected
                  ? 'Live Cart'
                  : 'Re-auth'}
            </span>
          </Link>


          {/* Quick Order Shortcut Button */}
          <button
            onClick={() => quickOrderEvent.triggerOpen()}
            onMouseEnter={() => api.warmupPharmarackSession()}
            className="p-2 rounded-xl transition-all duration-200 flex items-center justify-center border border-glass-border bg-glass-bg text-muted hover:text-text hover:bg-bg3/60 cursor-pointer relative"
            title="Quick Special Request (Alt+O)"
            aria-label="Quick special request"
          >
            <ClipboardPlus size={18} />
          </button>

          {/* Live Cart Shortcut Button */}
          <button
            onClick={() => liveCartAddEvent.triggerOpen()}
            onMouseEnter={() => api.warmupPharmarackSession()}
            className="p-2 rounded-xl transition-all duration-200 flex items-center justify-center border border-glass-border bg-glass-bg text-muted hover:text-text hover:bg-bg3/60 cursor-pointer relative"
            title="Live Cart Add (Alt+L)"
            aria-label="Live cart"
          >
            <ShoppingCart size={18} />
          </button>

          {/* WhatsApp Automation Hub */}
          <button
            onClick={onOpenAutomationHub}
            className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border cursor-pointer group ${
              automationHubHeadline === 'failed'
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                : automationHubHeadline === 'sending'
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                  : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-bg3/60'
            }`}
            aria-label="WhatsApp Automation Hub"
            title="WhatsApp Automation Hub"
          >
            <MessageSquareText size={18} className="group-hover:scale-110 transition-transform" />
            {automationHubHeadline !== 'idle' && (
              <span className={`absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${
                automationHubHeadline === 'failed' ? 'bg-rose-500' : 'bg-sky-500 animate-pulse'
              }`} />
            )}
          </button>

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => setShowPanel(prev => !prev)}
              className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border cursor-pointer group ${showPanel
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 shadow-sm'
                  : hasUnread
                    ? 'bg-glass-bg border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/50'
                    : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-bg3/60'
                }`}
              aria-label="Notifications"
              title="Notifications"
            >
              <div className="relative flex items-center justify-center">
                {hasUnread ? (
                  <BellRing size={18} className="animate-pulse text-sky-400 group-hover:scale-110 transition-transform" />
                ) : (
                  <Bell size={18} className="group-hover:scale-110 transition-transform" />
                )}
              </div>
              {hasUnread && (
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white text-[10px] font-black shadow-md shadow-sky-500/30 ring-2 ring-bg border border-sky-300/40">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-40"></span>
                  <span className="relative z-10">{notifications.filter(n => !n.read).length > 99 ? '99+' : notifications.filter(n => !n.read).length}</span>
                </span>
              )}
            </button>

            {showPanel && (
              <NotificationPanel
                notifications={notifications}
                onClearAll={onClearAll}
                onClearOne={onClearOne}
                onMarkRead={onMarkRead}
                onClose={() => setShowPanel(false)}
              />
            )}
          </div>

          <KeyboardShortcutsModal
            isOpen={showShortcutHelp}
            onClose={() => setShowShortcutHelp(false)}
          />

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            className="p-2 rounded-xl transition-all duration-200 flex items-center justify-center border border-glass-border bg-glass-bg text-muted hover:text-text hover:bg-bg3/60 cursor-pointer"
            aria-label="Toggle theme"
            title={theme === 'light' ? 'Switch to Night Mode' : 'Switch to Day Mode'}
          >
            {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
    </>
  );
});

// ──────────────────────────────────────────────
// Quick Assist Sidebar
// ──────────────────────────────────────────────
const QuickAssistSidebar = memo(({
  expanded,
  setExpanded,
  refills,
  notifications,
  specialOrders = [],
  onActionComplete,
}: {
  expanded: boolean;
  setExpanded: (val: boolean) => void;
  refills: Refill[];
  notifications: AutomationNotification[];
  specialOrders?: SpecialOrder[];
  onActionComplete: () => void;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [processingOrderIds, setProcessingOrderIds] = useState<Set<number>>(new Set());
  const [optimisticHiddenOrderIds, setOptimisticHiddenOrderIds] = useState<Set<number>>(new Set());

  // Expand / collapse state for grouped patients (collapsed by default)
  const [expandedRefillKeys, setExpandedRefillKeys] = useState<Set<string>>(new Set());
  const [expandedSpecialOrderKeys, setExpandedSpecialOrderKeys] = useState<Set<string>>(new Set());

  const toggleRefillKey = (key: string) => {
    setExpandedRefillKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSpecialOrderKey = (key: string) => {
    setExpandedSpecialOrderKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useOnClickOutside(sidebarRef, () => {
    if (expanded) {
      setExpanded(false);
    }
  });

  const handleAcknowledgeAll = async (items: Array<{ id: number; hold_for_stock: number }>) => {
    try {
      const holdItems = items.filter(i => i.hold_for_stock === 1);
      await Promise.all(holdItems.map(i => api.acknowledgeRefill(i.id).catch(() => {})));
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to acknowledge all refills:', e);
    }
  };

  const handleSendRefillGroup = async (group: { patient_name: string; patient_phone: string; medicines: Array<{ id: number; medicine_name: string; quantity_needed: number }> }) => {
    try {
      messageSendEvent.triggerSendProgress(group.patient_name || 'Patient', 'Dispatching WhatsApp refill reminder...', 10);
      if (group.patient_phone) {
        await api.sendGroupedRefill({
          patient_name: group.patient_name,
          patient_phone: group.patient_phone,
          medicines: group.medicines
        });
        toastEvent.trigger(`Consolidated refill reminder sent to ${group.patient_name}!`, 'success');
        whatsappQueueEvent.triggerUpdated();
      } else {
        await Promise.all(group.medicines.map(m => api.sendRefillNow(m.id).catch(() => {})));
        toastEvent.trigger(`Refill reminder sent to ${group.patient_name}!`, 'success');
        whatsappQueueEvent.triggerUpdated();
      }
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e: unknown) {
      const apiErr = e as LocalApiErrorShape;
      console.error('Failed to send refill group reminder:', e);
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to send refill reminder', 'error');
    }
  };


  const handleUpdateGroupStatus = async (
    group: { requester: string; phone?: string; items: Array<{ id: number; product: string; qty: number; notification_count?: number }> },
    newStatus: string,
    opts?: { navigateToPos?: boolean; resend?: boolean }
  ) => {
    const itemIds = group.items.map(i => i.id);

    setProcessingOrderIds(prev => {
      const next = new Set(prev);
      itemIds.forEach(id => next.add(id));
      return next;
    });

    if (newStatus === 'Completed' || newStatus === 'Cancelled') {
      setOptimisticHiddenOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.add(id));
        return next;
      });
    }

    try {
      const results = await Promise.all(group.items.map(i => apiClient.post(`/orders/${i.id}/status`, { status: newStatus, resend: opts?.resend })));
      const queuedCount = results.filter(r => r?.data?.whatsapp_queued).length;
      if (newStatus === 'Completed' || newStatus === 'Fulfilled') {
        toastEvent.trigger(`Marked ${group.items.length} request(s) for "${group.requester}" as Completed!`, 'success');
        if (opts?.navigateToPos) {
          const sourceOrders = (Array.isArray(specialOrders) ? specialOrders : []).filter((s) => itemIds.includes(s.id));
          const totalAdvance = sourceOrders.reduce((sum: number, s) => sum + (Number(s.advance_payment) || 0), 0);
          toastEvent.trigger(`Opening POS to bill "${group.requester}"...`, 'info', '/pos');
          navigate('/pos', {
            state: {
              prefill: {
                patientName: group.requester,
                patientPhone: group.phone || '',
                specialOrderId: group.items[0]?.id,
                advancePayment: totalAdvance,
                medicines: group.items.map(i => ({ medicineName: i.product, quantity_needed: i.qty }))
              }
            }
          });
        }
      } else if (newStatus === 'Ready') {
        if (queuedCount > 0) {
          messageSendEvent.triggerSendProgress(group.requester || group.phone || 'Customer', `Arrival alert for ${group.items[0]?.product || 'Order'}`, 10);
        }
        toastEvent.trigger(queuedCount > 0
          ? (opts?.resend
              ? `Arrival reminder WhatsApp re-queued for "${group.requester}"!`
              : `Marked ready & arrival WhatsApp queued for ${queuedCount} customer(s)!`)
          : `Marked all requests for "${group.requester}" as Ready!`, 'success');
      } else if (newStatus === 'Cancelled') {
        toastEvent.trigger(`Marked all requests for "${group.requester}" as Cancelled!`, 'success');
      } else {
        toastEvent.trigger(`Marked all requests for "${group.requester}" as ${newStatus}!`, 'success');
      }
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      specialOrdersEvent.triggerUpdated();
      window.dispatchEvent(new CustomEvent('refresh-special-orders'));
      onActionComplete();
    } catch (err: unknown) {
      console.error(`Failed to update group status to ${newStatus}:`, err);
      toastEvent.trigger('Failed to update request status', 'error');
      setOptimisticHiddenOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    } finally {
      setProcessingOrderIds(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const [sendingNotifKeys, setSendingNotifKeys] = useState<Set<string>>(new Set());

  const handleSendStagedNotificationGroup = async (group: {
    key: string;
    recipient_name: string;
    recipient_phone: string;
    consolidatedMessage: string;
    messages: Array<{ id: number; message: string; type?: string; reference_id?: string }>;
  }) => {
    if (sendingNotifKeys.has(group.key)) return;
    setSendingNotifKeys(prev => new Set(prev).add(group.key));

    try {
      if (group.recipient_phone) {
        await api.enqueueSingleWhatsApp({
          number: group.recipient_phone,
          message: group.consolidatedMessage,
          type: 'refill_collection',
          targetName: group.recipient_name
        });
        whatsappQueueEvent.triggerUpdated();
      }

      // Mark staged notifications as sent manually
      await Promise.all(
        group.messages.map(m =>
          api.manualNotification(m.id).catch(() => {})
        )
      );

      // Also update referenced patient_refills status
      for (const m of group.messages) {
        if (m.reference_id) {
          const ids = String(m.reference_id).split(',').map(s => Number(s.trim())).filter(Boolean);
          for (const refId of ids) {
            try {
              await apiClient.post(`/refills/${refId}/status`, { status: 'notified' });
            } catch (_) {}
          }
        }
      }

      toastEvent.trigger(`Consolidated WhatsApp message sent to ${group.recipient_name}!`, 'success');
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (err: unknown) {
      console.error('Failed to send staged message group:', err);
      toastEvent.trigger('Failed to send WhatsApp message', 'error');
    } finally {
      setSendingNotifKeys(prev => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

  const [optimisticDismissedIds, setOptimisticDismissedIds] = useState<Set<number>>(new Set());
  const [optimisticHiddenRefillIds, setOptimisticHiddenRefillIds] = useState<Set<number>>(new Set());

  const handleDismissStagedNotificationGroup = async (group: {
    key: string;
    messages: Array<{ id: number; reference_id?: string }>;
  }) => {
    const ids = group.messages.map(m => m.id);
    setOptimisticDismissedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    try {
      await Promise.all(
        ids.map(id =>
          api.cancelNotification(id).catch(() => {})
        )
      );

      // Await referenced patient_refills status updates so background sync does not re-stage them
      const refIdPromises: Promise<unknown>[] = [];
      for (const m of group.messages) {
        if (m.reference_id) {
          const refIds = String(m.reference_id).split(',').map(s => Number(s.trim())).filter(Boolean);
          for (const refId of refIds) {
            refIdPromises.push(apiClient.post(`/refills/${refId}/status`, { status: 'notified' }).catch(() => {}));
          }
        }
      }
      if (refIdPromises.length > 0) {
        await Promise.all(refIdPromises);
      }

      toastEvent.trigger('Staged message dismissed', 'info');
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (err) {
      console.error('Failed to dismiss staged notification:', err);
    }
  };

  const handleCompleteRefillGroup = async (group: { patient_name: string; patient_phone?: string; medicines: Array<{ id: number }> }) => {
    const ids = group.medicines.map(m => m.id);
    setOptimisticHiddenRefillIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    try {
      const phone = (group.patient_phone || '').trim();
      const res = await apiClient.post(`/refills/patient/${encodeURIComponent(phone || 'patient')}/fulfill-all`, {
        patient_phone: phone,
        refill_ids: ids,
        fulfilled_via: 'quick_assist'
      });

      if (res?.data?.success) {
        toastEvent.trigger(`Marked refills for ${group.patient_name} as Completed!`, 'success');
        queryClient.invalidateQueries({ queryKey: ['refills'] });
        refillEvent.triggerRefresh();
        onActionComplete();
      } else {
        throw new Error(res?.data?.error || 'Failed to complete refills');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiErrorShape;
      console.error('Failed to complete refills:', err);
      const errMsg = apiErr?.response?.data?.error || apiErr?.message || 'Failed to complete refills';
      toastEvent.trigger(errMsg, 'error');
      setOptimisticHiddenRefillIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  // Filter actionable refills: active, non-completed, and due within today + upcoming 7 calendar days (diffDays <= 7)
  const actionableRefills = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    return (Array.isArray(refills) ? refills : []).filter(r => {
      if (
        r.is_active !== 1 ||
        !r.next_refill_date ||
        r.status === 'completed' ||
        r.status === 'fulfilled' ||
        r.status === 'canceled' ||
        optimisticHiddenRefillIds.has(r.id)
      ) {
        return false;
      }
      const d = new Date(r.next_refill_date);
      if (isNaN(d.getTime())) return false;
      const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dueStart - todayStart) / 86400000);
      return diffDays <= 7;
    });
  }, [refills, optimisticHiddenRefillIds]);

  const groupedActionableRefills = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    const list: Array<{
      key: string;
      patient_name: string;
      patient_phone: string;
      next_refill_date: string;
      diffDays: number;
      timingCategory: 'Overdue' | 'Today' | 'Tomorrow' | 'Within 7 Days';
      hasHoldStock: boolean;
      reminder_status: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
      reminder_sent_at?: string | null;
      medicines: Array<{
        id: number;
        medicine_name: string;
        quantity_needed: number;
        refill_interval_days: number;
        hold_for_stock: number;
        next_refill_date: string;
        diffDays: number;
        reminder_status: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
        reminder_sent_at?: string | null;
      }>;
    }> = [];

    const map = new Map<string, (typeof list)[0]>();

    for (const r of actionableRefills) {
      const key = (r.patient_phone || r.patient_name || String(r.id)).trim();
      const d = new Date(r.next_refill_date);
      const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dueStart - todayStart) / 86400000);

      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          patient_name: r.patient_name || 'Patient',
          patient_phone: r.patient_phone || '',
          next_refill_date: r.next_refill_date,
          diffDays,
          timingCategory: diffDays < 0 ? 'Overdue' : diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : 'Within 7 Days',
          hasHoldStock: false,
          reminder_status: 'NOT_SENT',
          reminder_sent_at: null,
          medicines: [],
        };
        map.set(key, existing);
        list.push(existing);
      }
      if (r.hold_for_stock === 1) existing.hasHoldStock = true;
      if (r.next_refill_date && (!existing.next_refill_date || new Date(r.next_refill_date) < new Date(existing.next_refill_date))) {
        existing.next_refill_date = r.next_refill_date;
        existing.diffDays = diffDays;
        existing.timingCategory = diffDays < 0 ? 'Overdue' : diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : 'Within 7 Days';
      }
      const medReminderStatus: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' = r.reminder_status || (r.status === 'notified' ? 'SENT' : 'NOT_SENT');
      existing.medicines.push({
        id: r.id,
        medicine_name: r.medicine_name || 'Medicine',
        quantity_needed: Number(r.quantity_needed || 3),
        refill_interval_days: r.refill_interval_days || 30,
        hold_for_stock: r.hold_for_stock || 0,
        next_refill_date: r.next_refill_date,
        diffDays,
        reminder_status: medReminderStatus,
        reminder_sent_at: r.reminder_sent_at || null,
      });
    }

    // Compute aggregate patient group reminder status & latest sent timestamp
    for (const group of list) {
      if (group.medicines.length > 0) {
        if (group.medicines.every(m => m.reminder_status === 'SENT')) {
          group.reminder_status = 'SENT';
          const sentDates = group.medicines.map(m => m.reminder_sent_at).filter(Boolean);
          group.reminder_sent_at = sentDates.length > 0 ? (sentDates as string[]).sort().reverse()[0] : null;
        } else if (group.medicines.some(m => m.reminder_status === 'SENDING')) {
          group.reminder_status = 'SENDING';
        } else if (group.medicines.some(m => m.reminder_status === 'QUEUED')) {
          group.reminder_status = 'QUEUED';
        } else if (group.medicines.some(m => m.reminder_status === 'FAILED')) {
          group.reminder_status = 'FAILED';
        } else {
          group.reminder_status = 'NOT_SENT';
        }
      }
    }

    // Sort by diffDays ascending (most urgent first)
    list.sort((a, b) => a.diffDays - b.diffDays);
    return list;
  }, [actionableRefills]);

  const formatReminderSentAt = (sentAtStr?: string | null) => {
    if (!sentAtStr) return '';
    try {
      const d = new Date(sentAtStr);
      if (isNaN(d.getTime())) return sentAtStr;
      return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return sentAtStr;
    }
  };

  // Group active special orders by requester
  const activeSpecialOrders = useMemo(() => {
    return Array.isArray(specialOrders)
      ? specialOrders.filter(s => s.status !== 'Completed' && s.status !== 'Fulfilled' && s.status !== 'Cancelled' && !optimisticHiddenOrderIds.has(s.id))
      : [];
  }, [specialOrders, optimisticHiddenOrderIds]);

  const groupedSpecialOrders = useMemo(() => {
    const list: Array<{
      key: string;
      requester: string;
      phone: string;
      overallStatus: string;
      items: Array<{
        id: number;
        product: string;
        qty: number;
        status: string;
        priority: string;
        notification_count?: number;
      }>;
    }> = [];

    const map = new Map<string, (typeof list)[0]>();

    for (const order of activeSpecialOrders) {
      const key = (order.phone || order.requester || String(order.id)).trim();
      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          requester: order.requester || 'Customer',
          phone: order.phone || '',
          overallStatus: order.status || 'Pending',
          items: [],
        };
        map.set(key, existing);
        list.push(existing);
      }
      existing.items.push({
        id: order.id,
        product: order.product || 'Item',
        qty: Number(order.qty || 1),
        status: order.status || 'Pending',
        priority: order.priority || 'Normal',
        notification_count: Number((order as any).notification_count || 0),
      });
    }

    for (const g of list) {
      if (g.items.some(i => i.status === 'Pending')) g.overallStatus = 'Pending';
      else if (g.items.some(i => i.status === 'Ordered')) g.overallStatus = 'Ordered';
      else if (g.items.some(i => i.status === 'Ready')) g.overallStatus = 'Ready';
      else g.overallStatus = 'Other';
    }

    return list;
  }, [activeSpecialOrders]);

  const groupedNotifications = useMemo(() => {
    if (!Array.isArray(notifications)) return [];
    const map = new Map<string, {
      key: string;
      recipient_name: string;
      recipient_phone: string;
      messages: Array<{ id: number; message: string; type?: string; reference_id?: string }>;
      consolidatedMessage: string;
    }>();

    const normalizePhone = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);

    // 7-Day Rule: Collect normalized patient phones & lowercased names for actionable refills (due within 7 days) and active special requests
    const active7DayPhoneSet = new Set<string>();
    const active7DayNameSet = new Set<string>();

    for (const r of groupedActionableRefills) {
      const normP = normalizePhone(r.patient_phone);
      if (normP) active7DayPhoneSet.add(normP);
      if (r.patient_name) active7DayNameSet.add(r.patient_name.trim().toLowerCase());
    }
    for (const s of groupedSpecialOrders) {
      const normP = normalizePhone(s.phone);
      if (normP) active7DayPhoneSet.add(normP);
      if (s.requester) active7DayNameSet.add(s.requester.trim().toLowerCase());
    }

    for (const notif of notifications) {
      if (optimisticDismissedIds.has(notif.id)) continue;

      const notifPhoneNorm = normalizePhone(notif.recipient_phone);
      const notifNameNorm = (notif.recipient_name || '').trim().toLowerCase();

      // Enforce strict upcoming 7-day rule: ONLY display staged messages for patients with active 7-day refills or special requests
      const has7DayMatch = (notifPhoneNorm && active7DayPhoneSet.has(notifPhoneNorm)) || (notifNameNorm && active7DayNameSet.has(notifNameNorm));
      if (!has7DayMatch) {
        continue;
      }

      const key = (notif.recipient_phone || notif.recipient_name || String(notif.id)).trim();
      let existing = map.get(key);
      if (!existing) {
        existing = {
          key,
          recipient_name: notif.recipient_name || 'Customer',
          recipient_phone: notif.recipient_phone || '',
          messages: [],
          consolidatedMessage: notif.message || ''
        };
        map.set(key, existing);
      }
      existing.messages.push({
        id: notif.id,
        message: notif.message,
        type: notif.type,
        reference_id: notif.reference_id
      });
      if (notif.message && notif.message.length >= existing.consolidatedMessage.length) {
        existing.consolidatedMessage = notif.message;
      }
    }

    return Array.from(map.values());
  }, [notifications, optimisticDismissedIds, groupedActionableRefills, groupedSpecialOrders]);

  if (!expanded) {
    const activeRefillsCount = groupedActionableRefills.length;
    const activeSpecialOrdersCount = groupedSpecialOrders.length;
    const stagedNotificationsCount = groupedNotifications.length;

    return (
      <div
        onClick={() => setExpanded(true)}
        className="w-10 h-full min-h-0 overflow-hidden bg-bg2/90 border-l border-border flex flex-col items-center py-4 gap-4 hover:bg-bg3 hover:text-text transition-all duration-200 cursor-pointer shrink-0 z-20 select-none shadow-sm"
        title="Expand Quick Assist"
      >
        <ChevronLeftIcon size={16} className="text-muted mt-1" />

        {/* 3 Distinct Category Count Badges at TOP */}
        <div className="flex flex-col gap-1.5 items-center mt-1">
          {/* 1. Refills Due Soon (Purple) */}
          {activeRefillsCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 text-[9px] font-black border border-purple-500/30 shadow-sm"
              title={`Refills Due Soon: ${activeRefillsCount} patient(s)`}
            >
              {activeRefillsCount}
            </div>
          )}

          {/* 2. Quick Special Requests (Amber) */}
          {activeSpecialOrdersCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[9px] font-black border border-amber-500/30 shadow-sm animate-pulse"
              title={`Quick Special Requests: ${activeSpecialOrdersCount} customer(s)`}
            >
              {activeSpecialOrdersCount}
            </div>
          )}

          {/* 3. Staged Messages / Notifications (Emerald) */}
          {stagedNotificationsCount > 0 && (
            <div
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[9px] font-black border border-emerald-500/30 shadow-sm"
              title={`Staged Messages: ${stagedNotificationsCount}`}
            >
              {stagedNotificationsCount}
            </div>
          )}
        </div>

        <div
          style={{ writingMode: 'vertical-rl' }}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase text-muted tracking-widest my-auto"
        >
          <ActivityIcon size={12} className="rotate-90 shrink-0 text-purple-500" />
          <span>Quick Assist</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={sidebarRef} className="w-80 max-w-[85vw] bg-bg border-l border-border shadow-2xl flex flex-col h-full min-h-0 overflow-hidden shrink-0 z-20 transition-all duration-300">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-bg2/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-purple-500 shrink-0" />
          <span className="text-sm font-bold text-text uppercase tracking-wider truncate">Quick Assist</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer shrink-0"
          title="Collapse"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      {/* Main content scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin bg-bg">
        {/* Actionable Refills (Due within 7 Calendar Days) */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            <div className="flex items-center gap-1.5">
              <BellRing size={13} className="text-purple-500" />
              <span>Refills Due Soon ({groupedActionableRefills.length})</span>
            </div>
            <button
              onClick={() => navigate('/crm?tab=refills')}
              className="text-[9px] font-black text-sky-600 dark:text-sky-400 hover:underline uppercase tracking-widest cursor-pointer"
            >
              Manage
            </button>
          </div>
          {groupedActionableRefills.length === 0 ? (
            <p className="text-xs text-muted/60 italic pl-2 py-1">No refills due within 7 days</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedActionableRefills.map(group => {
                const isExpanded = expandedRefillKeys.has(group.key);
                const timingBadge = group.timingCategory === 'Overdue' ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/25 text-[9px] font-mono font-bold">
                    Overdue ({Math.abs(group.diffDays)}d)
                  </span>
                ) : group.timingCategory === 'Today' ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 text-[9px] font-mono font-bold">
                    Today
                  </span>
                ) : group.timingCategory === 'Tomorrow' ? (
                  <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/25 text-[9px] font-mono font-bold">
                    Tomorrow
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/25 text-[9px] font-mono font-bold">
                    In {group.diffDays}d
                  </span>
                );

                return (
                  <div key={group.key} className="p-3 rounded-xl bg-bg2 border border-border flex flex-col gap-2 shadow-xs min-w-0 overflow-hidden transition-all hover:border-purple-500/30">
                    {/* Patient Header (Click to toggle expansion / fold & unfold) */}
                    <div
                      onClick={() => toggleRefillKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="font-semibold text-xs text-text truncate">{group.patient_name}</span>
                          <span className="px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 text-[9px] font-bold shrink-0 border border-purple-500/20">
                            {group.medicines.length} med{group.medicines.length > 1 ? 's' : ''}
                          </span>
                          {timingBadge}
                        </div>
                        {group.patient_phone && (
                          <span className="text-[10px] text-muted truncate font-mono">{group.patient_phone}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {group.hasHoldStock && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[8px] font-bold uppercase tracking-wider animate-pulse shrink-0">
                            Hold Stock
                          </span>
                        )}
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-purple-500' : ''}`} />
                      </div>
                    </div>

                    {/* Unfolded Medicine Names: shows only medicine names (1 if one, multiple if multiple) */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                        {group.medicines.map((med) => (
                          <div
                            key={med.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg3/80 border border-border text-[11px] min-w-0"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <Package size={11} className="text-purple-500 shrink-0" />
                              <span className="font-medium text-text truncate">{med.medicine_name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/20 text-[10px] font-mono font-bold">
                                Qty: {med.quantity_needed}
                              </span>
                              <span className="text-[9px] text-muted">{med.refill_interval_days}d</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Patient Card Actions & Reminder Status Footer */}
                    <div className="flex items-center gap-2 justify-between min-w-0 pt-1 border-t border-border">
                      <div className="flex items-center gap-1 text-[9px] text-muted font-medium truncate">
                        <ClockIcon size={10} className="shrink-0" />
                        <span className="truncate">
                          Due: {group.next_refill_date ? new Date(group.next_refill_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {group.hasHoldStock && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcknowledgeAll(group.medicines);
                            }}
                            className="py-1 px-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black tracking-wide uppercase transition-colors shadow-sm cursor-pointer shrink-0"
                            title="Mark all held items as checked / resolved"
                          >
                            Ack
                          </button>
                        )}
                        {group.reminder_status === 'SENT' ? (
                          <div
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold shrink-0"
                            title={`Reminder sent on ${formatReminderSentAt(group.reminder_sent_at)}`}
                          >
                            <Check size={10} className="text-emerald-500" />
                            <span>Sent ✓</span>
                          </div>
                        ) : group.reminder_status === 'QUEUED' ? (
                          <div
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[9px] font-bold shrink-0"
                            title="Reminder queued in WhatsApp dispatch queue"
                          >
                            <ClockIcon size={10} className="text-amber-500" />
                            <span>Queued ⏳</span>
                          </div>
                        ) : group.reminder_status === 'SENDING' ? (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-400 text-[9px] font-bold shrink-0">
                            <Loader2 size={10} className="animate-spin text-sky-500" />
                            <span>Sending 📡</span>
                          </div>
                        ) : group.reminder_status === 'FAILED' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendRefillGroup(group);
                            }}
                            className="py-0.5 px-2 rounded bg-red-500/15 hover:bg-red-500/25 text-red-600 dark:text-red-400 border border-red-500/30 text-[9px] font-bold uppercase transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                            title="Reminder failed to send — click to retry"
                          >
                            <AlertIcon size={10} />
                            <span>Retry</span>
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendRefillGroup(group);
                            }}
                            className="py-0.5 px-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-[9px] font-bold uppercase transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                            title={`Send WhatsApp reminder to ${group.patient_name}`}
                          >
                            <SendIcon size={10} />
                            <span>Send</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCompleteRefillGroup(group);
                          }}
                          className="py-0.5 px-2 rounded bg-bg3 hover:bg-emerald-600 hover:text-white text-muted border border-border text-[9px] font-bold uppercase transition-colors flex items-center gap-1 cursor-pointer"
                          title={`Mark all refills for ${group.patient_name} as Completed`}
                        >
                          <Check size={10} />
                          <span>Complete All</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Special Requests */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-1.5">
              <Package size={14} className="text-amber-500" />
              <span>Quick Special Requests ({groupedSpecialOrders.length})</span>
            </div>
            <button
              onClick={() => navigate('/crm?tab=special_orders')}
              className="text-[9px] font-black text-amber-600 dark:text-amber-400 hover:underline uppercase tracking-widest cursor-pointer"
            >
              View All
            </button>
          </div>
          {groupedSpecialOrders.length === 0 ? (
            <p className="text-xs text-muted/60 italic pl-2 py-1">No active special requests</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedSpecialOrders.map(group => {
                const isExpanded = expandedSpecialOrderKeys.has(group.key);
                const isProcessing = group.items.some(i => processingOrderIds.has(i.id));

                return (
                  <div
                    key={group.key}
                    className={`p-3 rounded-xl border flex flex-col gap-2 transition-all min-w-0 overflow-hidden shadow-xs ${
                      group.overallStatus === 'Ready'
                        ? 'bg-sky-500/[0.06] border-sky-500/30'
                        : group.overallStatus === 'Ordered'
                        ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                        : 'bg-amber-500/[0.06] border-amber-500/30'
                    }`}
                  >
                    {/* Header (Click to toggle expansion / fold & unfold) */}
                    <div
                      onClick={() => toggleSpecialOrderKey(group.key)}
                      className="flex items-start justify-between gap-1.5 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-xs text-text truncate" title={group.items[0]?.product || 'Special Medicine'}>
                            {group.items[0]?.product || 'Special Medicine'}
                          </span>
                          {group.items.length > 1 ? (
                            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold shrink-0 border border-amber-500/20">
                              +{group.items.length - 1} more
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-mono font-bold shrink-0 border border-amber-500/20">
                              Qty: {group.items[0]?.qty || 1}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted truncate">
                          <span className="truncate">{group.requester}</span>
                          {group.phone && <span>• {group.phone}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(() => {
                          const maxCount = Math.max(0, ...group.items.map(i => Number(i.notification_count || 0)));
                          return (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                                group.overallStatus === 'Ready'
                                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30'
                                  : group.overallStatus === 'Ordered'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                              }`}
                            >
                              {group.overallStatus === 'Ready' && maxCount > 0
                                ? `Ready (Sent ${maxCount}x)`
                                : group.overallStatus}
                            </span>
                          );
                        })()}
                        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-amber-500' : ''}`} />
                      </div>
                    </div>

                    {/* Unfolded Medicine Names: shows only medicine names (1 if one, multiple if multiple) */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg2 border border-border text-[11px] min-w-0"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <Package size={11} className="text-amber-500 shrink-0" />
                              <span className="font-medium text-text truncate">{item.product}</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/20 text-[10px] font-mono font-bold shrink-0">
                              Qty: {item.qty}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons Footer */}
                    <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-border min-w-0">
                      {group.overallStatus === 'Ready' ? (
                        <>
                          {(() => {
                            const maxCount = Math.max(0, ...group.items.map(i => Number(i.notification_count || 0)));
                            return (
                              <button
                                disabled={isProcessing}
                                onClick={() => handleUpdateGroupStatus(group, 'Ready', { resend: true })}
                                className="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                                title="Re-send arrival reminder WhatsApp notification to customer"
                              >
                                {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <MessageCircle size={11} />}
                                Resend Ready {maxCount > 0 ? `• ${maxCount}` : ''}
                              </button>
                            );
                          })()}
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                            className="flex-1 py-1 px-2 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                            title="Mark all requests as Completed, remove from Quick Assist and open POS pre-filled for this customer"
                          >
                            {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Complete
                          </button>
                        </>
                      ) : group.overallStatus === 'Ordered' ? (
                        <>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Ready')}
                            className="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                            title="Mark all requests as Ready and queue the arrival WhatsApp to each customer"
                          >
                            {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Mark Ready
                          </button>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                            className="flex-1 py-1 px-2 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                            title="Mark all requests as Completed and open POS pre-filled for this customer"
                          >
                            {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Complete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Ordered')}
                            className="flex-1 py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                            title="Mark all requests as Ordered"
                          >
                            {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Mark Ordered
                          </button>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleUpdateGroupStatus(group, 'Completed', { navigateToPos: true })}
                            className="flex-1 py-1 px-2 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer whitespace-nowrap min-w-0"
                            title="Mark all requests as Completed and open POS pre-filled for this customer"
                          >
                            {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Complete
                          </button>
                        </>
                      )}
                      <button
                        disabled={isProcessing}
                        onClick={() => handleUpdateGroupStatus(group, 'Cancelled')}
                        className="py-1 px-2 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                        title="Cancel all requests for this customer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Staged Messages */}
        <div>
          <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            <MessageSquareIcon size={14} className="text-purple-500" />
            <span>Staged Messages ({groupedNotifications.length})</span>
          </div>
          {groupedNotifications.length === 0 ? (
            <p className="text-xs text-muted/60 pl-2">No staged messages</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groupedNotifications.map(group => {
                const isSending = sendingNotifKeys.has(group.key);
                return (
                  <div key={group.key} className="p-3 rounded-xl bg-purple-500/[0.05] border border-purple-500/25 flex flex-col gap-2 min-w-0 overflow-hidden shadow-xs">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="font-semibold text-text truncate">{group.recipient_name}</span>
                        {group.messages.length > 1 && (
                          <span className="px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 text-[9px] font-bold shrink-0 border border-purple-500/20">
                            {group.messages.length} meds
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold font-mono truncate shrink-0 max-w-[110px]">{group.recipient_phone}</span>
                    </div>

                    <p className="text-[11px] text-text/85 leading-snug italic bg-bg2 p-2.5 rounded-lg border border-border break-words font-medium">
                      "{group.consolidatedMessage}"
                    </p>

                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border">
                      <button
                        type="button"
                        onClick={() => handleDismissStagedNotificationGroup(group)}
                        className="py-1 px-2.5 rounded bg-bg3 hover:bg-bg border border-border text-muted hover:text-text text-[9px] font-bold uppercase transition-colors cursor-pointer flex items-center gap-1"
                        title="Dismiss staged message without sending"
                      >
                        <X size={10} /> Dismiss
                      </button>

                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => handleSendStagedNotificationGroup(group)}
                        className="py-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[9px] font-black tracking-wide uppercase transition-colors shadow-sm cursor-pointer flex items-center gap-1 shrink-0"
                        title="Send consolidated WhatsApp message to customer"
                      >
                        {isSending ? (
                          <>
                            <Loader2 size={10} className="animate-spin" /> Sending...
                          </>
                        ) : (
                          <>
                            <SendIcon size={10} /> Send WhatsApp
                          </>
                        )}
          </button>
                     </div>
                   </div>
                 );
               })}
             </div>
           )}
         </div>
       </div>
     </div>
   );
 });

// Module-level cache for staged counts to prevent redundant database fetches on page switches (G4)
let cachedStagedSalesCount: number | null = null;
let cachedStagedPurchasesCount: number | null = null;
let lastStagedCountsFetchTime = 0;

// Stable empty-array identities — memoized QuickAssistSidebar props must not
// churn (new [] each render) while the queries are still resolving.
const NO_SPECIAL_ORDERS: SpecialOrder[] = [];
const NO_REFILLS: Refill[] = [];

// ──────────────────────────────────────────────
// Layout (holds notification state globally)
// ──────────────────────────────────────────────
export const Layout = ({
  children,
  theme,
  setTheme,
}: {
  children: React.ReactNode;
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
}) => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const isFitPage = ['/pos', '/inventory', '/database', '/returns', '/purchases', '/manual-purchase', '/sells', '/purchase-history', '/crm', '/reports', '/settings', '/pharmarack-cart', '/investigation', '/phone-sales', '/migration'].includes(location.pathname);

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const stored = localStorage.getItem('app_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        return (parsed as AppNotification[]).map((n) => ({ ...n, time: new Date(n.time) }));
      }
    } catch (e) {
      console.warn('Failed to load notifications from localStorage:', e);
    }
    return [];
  });
  const [hasUnread, setHasUnread] = useState(() => {
    try {
      const stored = localStorage.getItem('app_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        return (parsed as AppNotification[]).some((n) => !n.read);
      }
    } catch { }
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('app_notifications', JSON.stringify(notifications));
    } catch (e) {
      console.warn('Failed to save notifications to localStorage:', e);
    }
  }, [notifications]);

  const [showStagedReview, setShowStagedReview] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showWaQueuePopover, setShowWaQueuePopover] = useState(false);
  const [pendingStagedSalesCount, setPendingStagedSalesCount] = useState(0);
  const [pendingStagedPurchasesCount, setPendingStagedPurchasesCount] = useState(0);
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [showLiveCartAdd, setShowLiveCartAdd] = useState(false);
  const [liveCartAddSearch, setLiveCartAddSearch] = useState<string | undefined>(undefined);
  const [liveCartAddQty, setLiveCartAddQty] = useState<number | undefined>(undefined);
  const [liveCartAddSourceOrderId, setLiveCartAddSourceOrderId] = useState<number | undefined>(undefined);
  const [liveCartAddSourceRefillId, setLiveCartAddSourceRefillId] = useState<number | undefined>(undefined);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    return whatsappQueueEvent.subscribeOpen(() => {
      setShowWaQueuePopover(true);
    });
  }, []);

  const [showAutomationHub, setShowAutomationHub] = useState(false);
  const [automationHubHeadline, setAutomationHubHeadline] = useState<'sending' | 'failed' | 'idle'>('idle');

  useEffect(() => {
    const unsubscribeOpen = automationHubEvent.subscribeOpen(() => setShowAutomationHub(true));
    return unsubscribeOpen;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pollHeadline = async () => {
      try {
        const summary = await api.getAutomationHubSummary();
        if (!cancelled) setAutomationHubHeadline(summary.headline);
      } catch (_) {
        // Non-fatal — badge just stays at its last known state
      }
    };
    pollHeadline();
    const unsubscribeUpdated = automationHubEvent.subscribeUpdated(pollHeadline);
    const unsubscribeQueueUpdated = whatsappQueueEvent.subscribeUpdated(pollHeadline);
    return () => {
      cancelled = true;
      unsubscribeUpdated();
      unsubscribeQueueUpdated();
    };
  }, []);

  const handleAutomationHubClose = () => {
    setShowAutomationHub(false);
    setAutomationHubHeadline('idle');
  };

  const [stagedNotifications, setStagedNotifications] = useState<AutomationNotification[]>([]);
  const [compactCacheLoaded, setCompactCacheLoaded] = useState(() => isCompactInventoryCacheReady());
  const [isSystemReady, setIsSystemReady] = useState(true);

  useEffect(() => {
    let mounted = true;
    const checkReadiness = async () => {
      try {
        const res = await apiClient.get('/health/ready');
        if (mounted) {
          setIsSystemReady(res.data?.ready !== false);
        }
      } catch (err: unknown) {
        if (mounted && (err as LocalApiErrorShape)?.response?.status === 503) {
          setIsSystemReady(false);
        }
      }
    };
    checkReadiness();
    return () => { mounted = false; };
  }, []);

  // Priority 0 on cold boot: compact inventory cache before other startup polls
  useEffect(() => {
    if (compactCacheLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await api.getCompactInventory();
        if (!cancelled) {
          console.log('[Layout] Compact inventory cache loaded.');
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[Layout] Failed to load compact inventory:', err);
          if (!isCompactInventoryCacheReady()) {
            setCompactInventoryCache([]);
          }
        }
      } finally {
        // ALWAYS mark cache loaded so POS search bar unlocks even if 401 or DB empty
        if (!cancelled) setCompactCacheLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [compactCacheLoaded]);

  const { data: specialOrdersList = NO_SPECIAL_ORDERS, refetch: refetchSpecialOrders } = useApiQuery<SpecialOrder[]>(
    'orders',
    async () => {
      const data = await api.getOrders();
      return Array.isArray(data) ? data : [];
    },
    { staleTime: 30000, enabled: compactCacheLoaded }
  );

  const { data: refillsList = NO_REFILLS, refetch: refetchRefills } = useApiQuery<Refill[]>(
    'refills',
    async () => {
      const data = await api.getRefills();
      return Array.isArray(data) ? data : [];
    },
    { staleTime: 30000, enabled: compactCacheLoaded }
  );

  // P1 "events, not timers": ONE global SSE listener replaces all periodic
  // background polling (API_OPTIMIZATION_IMPLEMENTATION_PLAN.md Phase 3).
  useGlobalSseInvalidation(compactCacheLoaded);

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      refetchSpecialOrders();
    };
    window.addEventListener('refresh-special-orders', handleRefresh);
    window.addEventListener('app-special-orders-updated', handleRefresh);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
      window.removeEventListener('app-special-orders-updated', handleRefresh);
    };
  }, [queryClient, refetchSpecialOrders]);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('quick_assist_sidebar_expanded') ?? localStorage.getItem('refill_sidebar_expanded');
      return stored !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('quick_assist_sidebar_expanded', String(isSidebarExpanded));
    } catch { }
  }, [isSidebarExpanded]);

  const fetchStagedNotifications = useCallback(async () => {
    try {
      const notifications = await api.getAutomationNotifications({ status: 'staged' });
      setStagedNotifications(Array.isArray(notifications) ? notifications : []);
    } catch (err) {
      console.warn('Failed to load staged notifications in layout:', err);
    }
  }, []);

  useEffect(() => {
    if (!compactCacheLoaded) return;
    fetchStagedNotifications();
    // focus + visibilitychange + app-purchases-updated can all fire within the
    // same tab-switch — one leading-edge throttled refresh instead of 2-3
    // identical fetch bursts (same pattern as useGlobalSseInvalidation dedupe)
    let lastRefreshAt = 0;
    const refreshAll = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 3000) return;
      lastRefreshAt = now;
      fetchStagedNotifications();
      refetchSpecialOrders();
      refetchRefills();
    };
    const unsubRefill = refillEvent.subscribeRefresh(refreshAll);

    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshAll);
    window.addEventListener('app-purchases-updated', refreshAll);

    return () => {
      unsubRefill();
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshAll);
      window.removeEventListener('app-purchases-updated', refreshAll);
    };
  }, [compactCacheLoaded, fetchStagedNotifications, refetchSpecialOrders, refetchRefills]);

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isBackupStartupMode, setIsBackupStartupMode] = useState(false);

  useEffect(() => {
    if (!compactCacheLoaded) return;

    const checkBackupStatus = async () => {
      try {
        const { data } = await apiClient.get('/utilities/backup/status');
        if (data.success && data.showRestorePopup) {
          setIsBackupStartupMode(true);
          setShowBackupModal(true);
        }
      } catch (err) {
        console.warn('Failed to check startup restore status:', err);
      }
    };
    checkBackupStatus();

    window.openBackupCenter = () => {
      setIsBackupStartupMode(false);
      setShowBackupModal(true);
    };

    return () => {
      delete window.openBackupCenter;
    };
  }, [compactCacheLoaded]);

  const fetchStagedCounts = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cachedStagedSalesCount !== null && cachedStagedPurchasesCount !== null && (now - lastStagedCountsFetchTime < 30000)) {
      setPendingStagedSalesCount(cachedStagedSalesCount);
      setPendingStagedPurchasesCount(cachedStagedPurchasesCount);
      return;
    }

    try {
      const [sales, purchases] = await Promise.all([
        api.getStagedSales(),
        api.getStagedPurchases(),
      ]);
      cachedStagedSalesCount = sales.length;
      cachedStagedPurchasesCount = purchases.length;
      lastStagedCountsFetchTime = now;
      setPendingStagedSalesCount(sales.length);
      setPendingStagedPurchasesCount(purchases.length);
    } catch (err) {
      console.warn('Failed to load staged counts:', err);
    }
  }, []);

  useEffect(() => {
    fetchStagedCounts();
    window.refreshStagedCounts = fetchStagedCounts;
    return () => {
      delete window.refreshStagedCounts;
    };
  }, [fetchStagedCounts]);

  // Subscribe to global open events for modals (G2)
  useEffect(() => {
    const unsubscribeQuickOrder = quickOrderEvent.subscribeOpen(() => setShowQuickOrder(true));
    const unsubscribeLiveCartAdd = liveCartAddEvent.subscribeOpen((detail) => {
      setLiveCartAddSearch(detail?.search);
      setLiveCartAddQty(detail?.qty);
      setLiveCartAddSourceOrderId(detail?.sourceOrderId);
      setLiveCartAddSourceRefillId(detail?.sourceRefillId);
      setShowLiveCartAdd(true);
    });
    return () => {
      unsubscribeQuickOrder();
      unsubscribeLiveCartAdd();
    };
  }, []);

  // Listen to global keyboard shortcuts for modals (G2)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isQuickOrderKey =
        (e.altKey && (e.key === 'o' || e.key === 'O')) ||
        (e.altKey && (e.key === 'n' || e.key === 'N')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'o' || e.key === 'O'));

      if (isQuickOrderKey) {
        e.preventDefault();
        setShowQuickOrder(prev => !prev);
      }

      const isLiveCartKey =
        (e.altKey && (e.key === 'l' || e.key === 'L')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'l' || e.key === 'L'));

      if (isLiveCartKey) {
        e.preventDefault();
        setShowLiveCartAdd(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Global Arrow Key Navigation (Shift columns / Move focus, do not change numbers)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT' && target.tagName !== 'TEXTAREA') return;

      if (e.defaultPrevented) return;

      if (target instanceof HTMLInputElement && target.type === 'number') {
        e.preventDefault();
      }

      const focusableSelector = 'input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
      const elements = Array.from(document.querySelectorAll(focusableSelector)) as HTMLElement[];
      const index = elements.indexOf(target);

      if (index > -1) {
        e.preventDefault();

        let nextEl: HTMLElement | undefined;
        if (e.key === 'ArrowDown') {
          nextEl = elements[index + 1];
        } else if (e.key === 'ArrowUp') {
          nextEl = elements[index - 1];
        }

        if (nextEl) {
          nextEl.focus();
          if (nextEl instanceof HTMLInputElement && nextEl.type !== 'checkbox' && nextEl.type !== 'radio') {
            nextEl.select();
          }
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleNewNotification = useCallback((detail: ToastEventDetail) => {
    const newNotif: AppNotification = {
      id: Date.now(),
      message: detail.message,
      type: detail.type,
      time: new Date(),
      read: false,
      link: detail.link,
      distributor: detail.distributor,
      qty: detail.qty,
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
    setHasUnread(true);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const title = `AI Pharmacy - ${detail.type.toUpperCase()}`;
        const options = {
          body: detail.message,
          icon: '/favicon.ico',
          tag: 'ai-pharmacy-notification',
        };
        new window.Notification(title, options);
      } catch (err) {
        console.warn('Failed to fire native Notification:', err);
      }
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    setNotifications([]);
    setHasUnread(false);
    try {
      localStorage.removeItem('app_notifications');
    } catch (_) {}
    try {
      await api.clearActionLogs();
    } catch (err) {
      console.warn('Failed to clear action logs from DB:', err);
    }
  }, []);

  const handleClearOne = useCallback(async (id: number | string) => {
    const idStr = String(id);
    if (idStr.startsWith('log-')) {
      const numId = parseInt(idStr.replace('log-', ''), 10);
      if (!isNaN(numId)) {
        try {
          await api.deleteActionLog(numId);
        } catch (err) {
          console.warn('Failed to delete action log from DB:', err);
        }
      }
    }
    setNotifications(prev => {
      const updated = prev.filter(n => String(n.id) !== idStr);
      if (updated.length === 0 || updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  const handleMarkRead = useCallback((id: number | string) => {
    setNotifications(prev => {
      const updated = prev.map(n => String(n.id) === String(id) ? { ...n, read: !n.read } : n);
      if (updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  // Stable chrome callbacks — memoized Sidebar/Topbar/QuickAssist bail out on
  // navigation re-renders only if every prop keeps its identity.
  const openStagedReview = useCallback(() => setShowStagedReview(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openConnectModal = useCallback(() => setShowConnectModal(true), []);
  const openWaQueuePopover = useCallback(() => setShowWaQueuePopover(true), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const handleQuickAssistActionComplete = useCallback(() => {
    fetchStagedNotifications();
    refetchSpecialOrders();
    refetchRefills();
  }, [fetchStagedNotifications, refetchSpecialOrders, refetchRefills]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text selection:bg-primary/30">
      <Sidebar
        stagedSalesCount={pendingStagedSalesCount}
        stagedPurchasesCount={pendingStagedPurchasesCount}
        onOpenReview={openStagedReview}
        mobileOpen={mobileNavOpen}
        onClose={closeMobileNav}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {!isSystemReady && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-600 dark:text-amber-400 px-4 py-2 text-xs font-semibold flex items-center justify-between shrink-0 z-global-modal">
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-500" />
              <span>Database initialization in progress — verifying schemas & integrity...</span>
            </div>
          </div>
        )}
        <Topbar
          theme={theme}
          setTheme={setTheme}
          notifications={notifications}
          hasUnread={hasUnread}
          onNewNotification={handleNewNotification}
          onClearAll={handleClearAll}
          onClearOne={handleClearOne}
          onMarkRead={handleMarkRead}
          onOpenStagedReview={openStagedReview}
          onOpenConnectModal={openConnectModal}
          onOpenWaQueue={openWaQueuePopover}
          onOpenAutomationHub={() => setShowAutomationHub(true)}
          automationHubHeadline={automationHubHeadline}
          onMenuClick={openMobileNav}
          compactCacheLoaded={compactCacheLoaded}
        />
        <div className="flex-1 flex flex-row overflow-hidden relative min-h-0">
          <main className={`flex-1 flex flex-col min-h-0 ${isFitPage ? 'overflow-hidden p-3 pt-1.5 pb-3' : 'overflow-y-auto p-4 pt-3 pb-4'} relative transition-all duration-200`}>
            {children}
          </main>

          <QuickAssistSidebar
            expanded={isSidebarExpanded}
            setExpanded={setIsSidebarExpanded}
            refills={refillsList}
            notifications={stagedNotifications}
            specialOrders={specialOrdersList}
            onActionComplete={handleQuickAssistActionComplete}
          />
        </div>

        {/* Real-Time Connected Mobile Devices Status Footer Bar */}
        <ConnectedDevicesFooterBar
          onOpenConnectModal={openConnectModal}
        />

        {/* Global Modals */}
        {showQuickOrder && (
          <QuickOrderModal onClose={() => setShowQuickOrder(false)} />
        )}
        {showLiveCartAdd && (
          <LiveCartAddModal
            initialSearch={liveCartAddSearch}
            initialQty={liveCartAddQty}
            sourceOrderId={liveCartAddSourceOrderId}
            sourceRefillId={liveCartAddSourceRefillId}
            onClose={() => {
              setShowLiveCartAdd(false);
              setLiveCartAddSearch(undefined);
              setLiveCartAddQty(undefined);
              setLiveCartAddSourceOrderId(undefined);
              setLiveCartAddSourceRefillId(undefined);
            }}
          />
        )}

        {showStagedReview && (
          <StagedReviewModal
            onClose={() => setShowStagedReview(false)}
            onActionComplete={() => fetchStagedCounts(true)}
          />
        )}

        {showConnectModal && (
          <MobileConnectionModal
            onClose={() => setShowConnectModal(false)}
          />
        )}

        {showWaQueuePopover && (
          <WhatsAppQueuePopover
            onClose={() => setShowWaQueuePopover(false)}
          />
        )}

        {showAutomationHub && (
          <AutomationHubPopover
            onClose={handleAutomationHubClose}
          />
        )}

        {showBackupModal && (
          <BackupCenterModal
            isOpen={showBackupModal}
            onClose={() => setShowBackupModal(false)}
            isStartupMode={isBackupStartupMode}
          />
        )}

        {/* Subtle background glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[40%] h-[40%] bg-purple/5 rounded-full blur-[100px]" />
        </div>
      </div>
    </div>
  );
};

const KeyboardShortcutsModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('All');
  if (!isOpen) return null;

  const categories = ['All', 'Global', 'POS', 'Learning', 'CRM', 'Purchases', 'Settings'];
  const filtered = filterCategory === 'All'
    ? SHORTCUT_DIRECTORY
    : SHORTCUT_DIRECTORY.filter(s => s.category === filterCategory);

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
      <div className="bg-bg border border-glass-border w-full max-w-2xl rounded-3xl p-6 space-y-4 text-left shadow-2xl">
        <div className="flex justify-between items-center border-b border-glass-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky border border-sky-500/20">
              <Keyboard size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-text">Keyboard Shortcuts Cheat Sheet</h3>
              <p className="text-[11px] text-muted">Essential shortcuts for fast on-premise navigation & control</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-text transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1.5 border-b border-glass-border/30 pb-2 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterCategory === cat
                  ? 'bg-sky-500/20 text-sky border border-sky-500/30'
                  : 'text-muted hover:text-text hover:bg-bg3/60'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Shortcuts Directory Grid */}
        <div className="max-h-80 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {filtered.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 rounded-xl bg-bg2/40 border border-glass-border/30 hover:bg-bg2/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky border border-sky-500/20">
                  {item.category}
                </span>
                <span className="text-xs font-semibold text-text">{item.description}</span>
              </div>
              <kbd className="px-2.5 py-1 rounded-lg bg-bg border border-glass-border font-mono text-[11px] font-bold text-sky drop-shadow-sm">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-glass-border/30">
          <span className="text-[10px] text-muted">Press <kbd className="px-1.5 py-0.5 rounded bg-bg border border-glass-border font-mono">Esc</kbd> anytime to close this helper or any active popup</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-sky hover:bg-sky-400 text-white text-xs font-bold transition-all active:scale-95"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Layout;
