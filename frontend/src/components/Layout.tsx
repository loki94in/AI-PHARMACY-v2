import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { 
  LayoutDashboard, 
  PackageSearch, 
  ShoppingCart, 
  Receipt, 
  Users, 
  UserPlus, 
  Settings as SettingsIcon, 
  Activity,
  LogOut,
  Database,
  RotateCcw,
  ClipboardList,
  CalendarDays,
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
  Beaker,
  Smartphone,
  ClipboardPlus,
  RefreshCw,
  Building2,
  Clock,
  Edit,
  Menu,
  Truck,
  Package,
  Download,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { 
  ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon, 
  Activity as ActivityIcon, 
  ShieldCheck as ShieldCheckIcon, 
  CheckSquare as CheckSquareIcon, 
  ShoppingCart as CartIcon, 
  Clock as ClockIcon, 
  AlertTriangle as AlertIcon, 
  MessageSquare as MessageSquareIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  Send as SendIcon
} from 'lucide-react';


import { toastEvent, quickOrderEvent, liveCartAddEvent, refillEvent } from '../services/events';
import type { ToastEventDetail } from '../services/events';
import { QuickOrderModal } from './QuickOrderModal';
import { LiveCartAddModal } from './LiveCartAddModal';
import { WhatsAppQueuePopover } from './WhatsAppQueuePopover';
import { StagedReviewModal } from './StagedReviewModal';
import { MobileConnectionModal } from './MobileConnectionModal';
import { ConnectedDevicesFooterBar } from './ConnectedDevicesFooterBar';
import { api, apiClient, isCompactInventoryCacheReady } from '../services/api';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { useApiQuery } from '../hooks/useApiQuery';
import { pageImports } from '../lib/pageImports';
import BackupCenterModal from './BackupCenterModal';
import { useFetchMode } from '../hooks/useFetchMode';

// Defer non-critical startup work until the browser is idle (falls back to a 2s
// timeout where requestIdleCallback isn't available, e.g. Safari), so it doesn't
// compete with first paint / LCP. Returns a cancel function for effect cleanup.
function deferUntilIdle(fn: () => void): () => void {
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    const handle = ric(fn, { timeout: 3000 });
    return () => (window as any).cancelIdleCallback?.(handle);
  }
  const timeoutId = setTimeout(fn, 2000);
  return () => clearTimeout(timeoutId);
}

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
export interface AppNotification {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
  distributor?: string;
  qty?: string | number;
}

// Minimal page-switch loading fallback — renders instantly, no layout shift
export const PageLoader = () => (
  <div className="flex-1 flex items-center justify-center h-full">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <span className="text-xs text-muted font-semibold uppercase tracking-widest">Loading...</span>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────
const Sidebar = ({
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const hoverPrefetchControl = useFetchMode('layout.hoverPrefetch');
  const menuItems = [
    { path: '/pos', label: 'Sales / POS', icon: <ShoppingCart size={18} /> },
    { path: '/sells', label: 'Sales History / Bills', icon: <Receipt size={18} /> },
    { path: '/inventory', label: 'Inventory', icon: <PackageSearch size={18} /> },
    { path: '/purchase-history', label: 'Purchase History', icon: <ClipboardList size={18} /> },
    { path: '/purchases', label: 'Purchases', icon: <Receipt size={18} /> },
    { path: '/mail', label: 'Distributor Mail', icon: <Activity size={18} /> },
    { path: '/reports', label: 'Reports', icon: <LayoutDashboard size={18} /> },
    { path: '/pharmarack-cart', label: 'Pharmarack Cart', icon: <ShoppingCart size={18} /> },
    { path: '/investigation', label: 'Investigation Center', icon: <PackageSearch size={18} /> },
    { path: '/composition-queue', label: 'Composition Queue', icon: <Beaker size={18} /> },
    { path: '/learning', label: 'AI Learning', icon: <Activity size={18} /> },
    { path: '/crm', label: 'CRM & Messages', icon: <Users size={18} /> },
    { path: '/returns', label: 'Supplier Returns', icon: <RotateCcw size={18} /> },
    { path: '/database', label: 'Master Database', icon: <Database size={18} /> },
    { path: '/phone-sales', label: 'Phone Sales', icon: <Smartphone size={18} /> },
    { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { path: '/migration', label: 'Data Migration', icon: <Database size={18} /> },
    { path: '/license', label: 'License', icon: <Database size={18} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
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
              <path d="M12 4V20M4 12H20" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
              <path d="M12 8.5V15.5M8.5 12H15.5" stroke="#fafafa" strokeWidth="2" strokeLinecap="round"/>
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
              if (location.pathname !== basePath) return false;
              const targetTab = queryStr ? new URLSearchParams(queryStr).get('tab') : null;
              const currentTab = new URLSearchParams(location.search).get('tab');
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
                    } else if (basePath === '/orders') {
                      queryClient.prefetchQuery({
                        queryKey: ['orders'],
                        queryFn: () => api.getOrders(),
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

      </div>
    </>
  );
};

// ──────────────────────────────────────────────
// Flash Toast — small pop at top-center
// ──────────────────────────────────────────────
const FlashToast = ({
  toast,
  onDismiss,
  onOpenReview,
}: {
  toast: (ToastEventDetail & { id: number }) | null;
  onDismiss: () => void;
  onOpenReview: () => void;
}) => {
  if (!toast) return null;

  const cfg = {
    success: { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400', icon: <Check size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]' },
    error:   { bg: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',                 icon: <AlertTriangle size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]' },
    info:    { bg: 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-400',                 icon: <Info size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(14,165,233,0.15)]' },
    mail:    { bg: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400',     icon: <MailIcon size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(99,102,241,0.15)]' },
    automation: { bg: 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400', icon: <Activity size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]' },
  }[toast.type] || { bg: 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-400',                 icon: <Info size={15} className="shrink-0" />, glow: 'shadow-[0_0_20px_rgba(14,165,233,0.15)]' };

  const isStagedSync = toast.message.toLowerCase().includes('sync') || toast.message.toLowerCase().includes('staged');

  return (
    <div
      key={toast.id}
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-toast
        flex items-center gap-2.5 px-4 py-2.5 rounded-2xl
        border backdrop-blur-2xl ${cfg.bg} ${cfg.glow}
        animate-soft-toast
        min-w-[260px] max-w-[450px]
      `}
    >
      {cfg.icon}
      <span className="text-sm font-semibold flex-1 leading-snug">{toast.message}</span>
      {isStagedSync && (
        <button
          onClick={() => {
            onOpenReview();
            onDismiss();
          }}
          className="ml-2 bg-primary hover:bg-primary/80 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors shrink-0"
        >
          Proceed
        </button>
      )}
      <button
        onClick={onDismiss}
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
  onClearOne: (id: number) => void;
  onMarkRead: (id: number) => void;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

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
    if (type === 'success') return { dot: 'bg-emerald-400', text: 'text-emerald-400', icon: <Check size={14} />, label: 'Success' };
    if (type === 'error')   return { dot: 'bg-red-400',     text: 'text-red-400',     icon: <AlertTriangle size={14} />, label: 'Error' };
    if (type === 'mail')    return { dot: 'bg-indigo-400',  text: 'text-indigo-400',  icon: <MailIcon size={14} />,      label: 'Mail' };
    if (type === 'automation') return { dot: 'bg-purple-400', text: 'text-purple-400', icon: <Activity size={14} />,      label: 'Automation' };
    return                         { dot: 'bg-sky-400',     text: 'text-sky-400',     icon: <Info size={14} />,          label: 'Info' };
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-3 w-96 z-dropdown flex flex-col rounded-2xl overflow-hidden glass-panel"
      style={{
        backdropFilter: 'blur(24px)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border">
        <div className="flex items-center gap-2.5">
          <BellRing size={16} className="text-sky-400" />
          <span className="text-sm font-bold text-text tracking-wide">Notifications</span>
          {unread > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-sky-500/20 border border-sky-500/30 text-sky-400 text-[10px] font-bold">
              {unread} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              navigate('/settings');
              onClose();
            }}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-all flex items-center gap-1 text-[11px] font-medium"
            title="Manage Notification & Message Settings"
          >
            <SettingsIcon size={13} />
            <span className="hidden sm:inline">Settings</span>
          </button>
          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="flex items-center gap-1 text-[10px] font-semibold text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            >
              <Trash2 size={11} />
              Clear All
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-black/10 transition-all"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Notification List */}
      <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-black/5 border border-glass-border flex items-center justify-center">
              <Bell size={26} className="text-muted opacity-40" />
            </div>
            <p className="text-muted text-sm font-medium">All caught up!</p>
            <p className="text-muted/50 text-xs">No notifications right now</p>
          </div>
        ) : (
          <div className="py-1">
            {notifications.map((notif, idx) => {
              const cfg = typeConfig(notif.type);
              return (
                <div
                  key={notif.id}
                  className={`
                    group flex items-start gap-3 px-4 py-3 relative transition-all duration-200
                    ${!notif.read ? 'bg-primary/[0.04]' : 'hover:bg-black/[0.03]'}
                    ${idx < notifications.length - 1 ? 'border-b border-glass-border' : ''}
                  `}
                  onClick={() => onMarkRead(notif.id)}
                >
                  {/* Unread indicator bar */}
                  {!notif.read && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-sky-500 rounded-r" />
                  )}

                  {/* Type Icon */}
                  <div className={`
                    shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5
                    ${notif.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 
                      notif.type === 'error'   ? 'bg-red-500/10 text-red-400' : 
                      notif.type === 'mail'    ? 'bg-indigo-500/10 text-indigo-400' :
                      notif.type === 'automation' ? 'bg-purple-500/10 text-purple-400' :
                                                 'bg-sky-500/10 text-sky-400'}
                  `}>
                    {cfg.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!notif.read ? 'text-text font-medium' : 'text-muted'}`}>
                      {notif.message}
                    </p>
                    {/* Distributor + Qty badges */}
                    {(notif.distributor || notif.qty !== undefined) && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {notif.distributor && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold">
                            <Building2 size={9} />
                            {notif.distributor}
                          </span>
                        )}
                        {notif.qty !== undefined && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                            Qty: {notif.qty}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
                      <span className="text-[10px] text-muted/50">·</span>
                      <span className="text-[10px] text-muted/50 font-mono">{formatTime(notif.time)}</span>
                    </div>
                    {/* Open link if available */}
                    {notif.link && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onMarkRead(notif.id);
                          navigate(notif.link!);
                          onClose();
                        }}
                        className="flex items-center gap-1 mt-1.5 text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        <ExternalLink size={10} />
                        Open
                        <ChevronRight size={10} />
                      </button>
                    )}
                  </div>

                  {/* Clear One Button */}
                  <button
                    onClick={e => { e.stopPropagation(); onClearOne(notif.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-all p-1.5 rounded-lg hover:bg-red-500/10 text-muted hover:text-red-400 mt-0.5 cursor-pointer"
                    aria-label="Remove notification"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="px-4 py-2.5 border-t border-glass-border flex items-center justify-between">
          <span className="text-[10px] text-muted">{notifications.length} total notification{notifications.length !== 1 ? 's' : ''}</span>
          {unread > 0 && (
            <button
              onClick={() => notifications.forEach(n => { if (!n.read) onMarkRead(n.id); })}
              className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            >
              Mark all read
            </button>
          )}
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
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.12.09 2.27-.56 2.95-1.39z"/>
      </svg>
    );
  }
  
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <path d="M17.5 8c.46 0 .89.11 1.28.31l1.58-1.58c.2-.2.51-.2.71 0s.2.51 0 .71l-1.63 1.63C19.78 9.77 20 10.86 20 12v3H4v-3c0-1.14.22-2.23.63-3.12L3 7.25c-.2-.2-.2-.51 0-.71s.51-.2.71 0l1.58 1.58C5.68 8.11 6.11 8 6.5 8h11M7 11.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1m10 0c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1M16 16v4.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V16H11v4.5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5V16H4.5C3.67 16 3 15.33 3 14.5V14h18v.5c0 .83-.67 1.5-1.5 1.5H16z"/>
    </svg>
  );
};

// ──────────────────────────────────────────────
// Topbar
// ──────────────────────────────────────────────
const Topbar = ({
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
  onMenuClick,
  compactCacheLoaded = false,
}: {
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  notifications: AppNotification[];
  hasUnread: boolean;
  onNewNotification: (n: ToastEventDetail) => void;
  onClearAll: () => void;
  onClearOne: (id: number) => void;
  onMarkRead: (id: number) => void;
  onOpenStagedReview: () => void;
  onOpenConnectModal: () => void;
  onOpenWaQueue?: () => void;
  onMenuClick?: () => void;
  compactCacheLoaded?: boolean;
}) => {
  const location = useLocation();
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
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

  const enrichmentPollControl = useFetchMode('layout.enrichmentPoll');

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

    // Poll enrichment status to show/hide the header pill
    const pollEnrichment = async () => {
      try {
        const { data } = await apiClient.get('/enrichment/status');
        setEnrichmentRunning(!!data?.isRunning);
      } catch {
        // silently ignore — don't surface a UI error just for the header pill
      }
    };
    if (enrichmentPollControl.shouldFetch) {
      let enrichmentPollInterval: ReturnType<typeof setInterval> | undefined;
      const cancelDefer = deferUntilIdle(() => {
        pollEnrichment();
        enrichmentPollInterval = setInterval(pollEnrichment, 5000);
      });
      return () => {
        cancelDefer();
        clearInterval(enrichmentPollInterval);
      };
    }
  }, [enrichmentPollControl.shouldFetch, compactCacheLoaded]);
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
    whatsapp: { connected: boolean; initializing: boolean; isSyncing: boolean; pendingQueueCount: number };
  } | null>(null);

  const [waQueueDetail, setWaQueueDetail] = useState<{
    isProcessing: boolean;
    isPaused?: boolean;
    activeTargetName?: string | null;
    counts: { pending: number; sending: number; sent: number };
  } | null>(null);

  const notifiedFailedQueueIdsRef = useRef<Set<number>>(new Set());

  const waQueueActiveRef = useRef(false);
  const prevQueueActiveRef = useRef(false);
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
        setServicesStatus(res.services);
      }
      // Also fetch detailed queue worker state for live header progress
      const qData = await api.getWhatsAppQueueStatus();
      if (qData) {
        setWaQueueDetail({
          isProcessing: qData.isProcessing,
          isPaused: qData.isPaused,
          activeTargetName: qData.activeTargetName,
          counts: qData.counts || { pending: 0, sending: 0, sent: 0 }
        });
        const pending = qData.counts?.pending || 0;
        const sending = qData.counts?.sending || 0;
        const sent = qData.counts?.sent || 0;
        const isQueueActive = pending > 0 || sending > 0 || qData.isProcessing;
        // Update ref for polling interval adjustment (avoids effect re-trigger)
        waQueueActiveRef.current = isQueueActive;

        if (prevQueueActiveRef.current && !isQueueActive && sent > 0) {
          setLastQueueCompletedAt(Date.now());
          toastEvent.trigger(`✅ All ${sent} WhatsApp message${sent === 1 ? '' : 's'} sent`, 'success');
        }
        prevQueueActiveRef.current = isQueueActive;

        if (Array.isArray(qData.recentItems)) {
          qData.recentItems.forEach((item: any) => {
            if ((item.status === 'failed_perm' || (item.status === 'failed_offline' && item.retry_count >= 3)) && !notifiedFailedQueueIdsRef.current.has(item.id)) {
              notifiedFailedQueueIdsRef.current.add(item.id);
              const target = item.target_name || (item.number ? `+${item.number}` : 'Recipient');
              toastEvent.trigger(`❌ WhatsApp message to ${target} failed: ${item.error_message || 'Permanent send failure'}`, 'error');
            }
          });
        }
      }
    } catch (err) {
      console.warn('[Layout] Failed to fetch services status:', err);
    }
  }, []);
  useEffect(() => {
    if (!compactCacheLoaded) return;
    // Poll faster (every 3s) when queue has pending/sending items, otherwise 8s
    let interval: ReturnType<typeof setInterval> | undefined;
    const poll = () => {
      fetchServicesStatus().then(() => {
        const activeQueue = waQueueActiveRef.current;
        const newMs = activeQueue ? 3000 : 8000;
        if (!interval) {
          interval = setInterval(poll, newMs);
        }
      }).catch(() => {});
    };
    const cancelDefer = deferUntilIdle(() => {
      poll();
    });
    return () => {
      cancelDefer();
      clearInterval(interval);
    };
  }, [fetchServicesStatus, compactCacheLoaded]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowDevicesPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Listen to Escape key to close open header panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPanel(false);
        setShowDevicesPopover(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for toast events — show flash AND add to panel
  useEffect(() => {
    return toastEvent.subscribe((detail) => {
      onNewNotification(detail);
      // Show flash
      const id = Date.now();
      setFlashToast({ ...detail, id });
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashToast(null), 4200);
    });
  }, [onNewNotification]);

  const queuePillVisible = Boolean(
    waQueueDetail?.isProcessing
    || (waQueueDetail?.counts?.pending || 0) > 0
    || (waQueueDetail?.counts?.sending || 0) > 0
    || (lastQueueCompletedAt && Date.now() - lastQueueCompletedAt < 5000)
  );
  const queueCompletedRecently = lastQueueCompletedAt && Date.now() - lastQueueCompletedAt < 5000;

  const onlineDevicesCount = connectedDevices.filter(d => d.is_online === 1).length;

  return (
    <>
      <FlashToast toast={flashToast} onDismiss={() => setFlashToast(null)} onOpenReview={onOpenStagedReview} />
      
      <header className="h-14 bg-glass-bg border-b border-glass-border backdrop-blur-xl flex items-center justify-between px-3 sm:px-6 relative z-sticky-header shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="lg:hidden shrink-0 p-1.5 -ml-1 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-bold uppercase tracking-wider text-text/90 truncate">
            {location.pathname === '/' ? 'POS' : location.pathname.substring(1).replace('-', ' ')}
          </span>
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

        <div className="flex items-center gap-2">
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
              hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer text-xs font-semibold uppercase tracking-wider
              ${servicesStatus?.pharmarack?.isRefreshing
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : servicesStatus?.pharmarack?.connected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}
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

          {/* WhatsApp Connection & Background Queue Status (Live Header Pill with Auto-Hide & Inline Play/Pause) */}
          {queuePillVisible && (
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold uppercase tracking-wider shrink-0 ${
              queueCompletedRecently
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/10'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/10'
            }`}>
              {queueCompletedRecently ? (
                <button
                  type="button"
                  onClick={onOpenWaQueue}
                  className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                  title="All WhatsApp messages sent"
                >
                  <Check size={12} className="text-emerald-400 shrink-0" />
                  <span className="font-bold text-white">All sent</span>
                </button>
              ) : (
                <>
              <button
                type="button"
                onClick={onOpenWaQueue}
                className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                title={`WhatsApp Live Queue Controller (${(waQueueDetail?.counts?.pending || 0) + (waQueueDetail?.counts?.sending || 0)} queued)`}
              >
                {waQueueDetail?.isPaused ? (
                  <PauseIcon size={12} className="text-amber-400 shrink-0" />
                ) : (
                  <RefreshCw size={12} className="animate-spin text-emerald-400 shrink-0" />
                )}
                <span className="font-bold text-white font-mono">
                  {waQueueDetail?.counts?.sent || 0}/{(waQueueDetail?.counts?.sent || 0) + (waQueueDetail?.counts?.pending || 0) + (waQueueDetail?.counts?.sending || 0)}
                </span>
                {waQueueDetail?.activeTargetName && (
                  <span className="text-emerald-300 font-bold truncate max-w-[120px]">
                    ▶ {waQueueDetail.activeTargetName}
                  </span>
                )}
              </button>

              {/* Inline Play / Pause Toggle Button */}
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await apiClient.post('/whatsapp/queue/toggle-pause');
                    window.dispatchEvent(new CustomEvent('cache-invalidate'));
                  } catch (err) {
                    console.error('Failed to toggle queue pause:', err);
                  }
                }}
                className={`p-1 rounded-lg transition-all cursor-pointer ${
                  waQueueDetail?.isPaused
                    ? 'bg-amber-500/30 text-amber-300 hover:bg-amber-500/50'
                    : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40'
                }`}
                title={waQueueDetail?.isPaused ? "Resume WhatsApp Queue" : "Pause WhatsApp Queue"}
              >
                {waQueueDetail?.isPaused ? <PlayIcon size={12} className="fill-current" /> : <PauseIcon size={12} className="fill-current" />}
              </button>
                </>
              )}
            </div>
          )}

          {/* Quick Order Shortcut Button */}
          <button
            onClick={() => quickOrderEvent.triggerOpen()}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center relative hover:bg-white/5 rounded-xl cursor-pointer"
            title="Quick Special Request (Alt+O)"
            aria-label="Quick special request"
          >
            <ClipboardPlus size={18} />
          </button>

          {/* Live Cart Shortcut Button */}
          <button
            onClick={() => liveCartAddEvent.triggerOpen()}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center relative hover:bg-white/5 rounded-xl cursor-pointer"
            title="Live Cart Add (Alt+L)"
            aria-label="Live cart"
          >
            <ShoppingCart size={18} />
          </button>

          {/* Refresh Page Cache Button */}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cache-invalidate'));
            }}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center hover:bg-white/5 rounded-xl cursor-pointer"
            title="Refresh Page Data"
          >
            <RefreshCw size={18} />
          </button>

          {/* Backup Center Shortcut Button */}
          <button
            onClick={() => {
              if (typeof window.openBackupCenter === 'function') {
                window.openBackupCenter();
              }
            }}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center hover:bg-white/5 rounded-xl cursor-pointer"
            title="Backup & Restore Panel"
          >
            <Database size={18} />
          </button>

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => setShowPanel(prev => !prev)}
              className={`p-2 rounded-xl transition-colors flex items-center justify-center hover:bg-white/5 cursor-pointer ${hasUnread ? 'text-primary' : 'text-muted hover:text-white'}`}
              aria-label="Notifications"
            >
              {hasUnread ? <BellRing size={18} /> : <Bell size={18} />}
              {hasUnread && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-dark"></span>
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

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center hover:bg-white/5 rounded-xl cursor-pointer"
            aria-label="Toggle theme"
            title={theme === 'light' ? 'Switch to Night Mode' : 'Switch to Day Mode'}
          >
            {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center hover:bg-white/5 rounded-xl cursor-pointer" aria-label="Log out" title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
    </>
  );
};

// ──────────────────────────────────────────────
// Quick Assist Sidebar
// ──────────────────────────────────────────────
const QuickAssistSidebar = ({
  expanded,
  setExpanded,
  refills,
  notifications,
  specialOrders = [],
  onActionComplete,
}: {
  expanded: boolean;
  setExpanded: (val: boolean) => void;
  refills: any[];
  notifications: any[];
  specialOrders?: any[];
  onActionComplete: () => void;
}) => {
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(sidebarRef, () => {
    if (expanded) {
      setExpanded(false);
    }
  });

  const handleAcknowledge = async (id: number) => {
    try {
      await api.acknowledgeRefill(id);
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to acknowledge refill:', e);
    }
  };

  const handleSend = async (id: number) => {
    try {
      await api.sendRefillNow(id);
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to send refill message:', e);
    }
  };

  const handlePause = async (id: number) => {
    try {
      await api.updateRefill(id, { is_active: 0 });
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to pause refill:', e);
    }
  };

  const handleSkip = async (id: number) => {
    try {
      await api.skipRefill(id);
      refillEvent.triggerRefresh();
      onActionComplete();
    } catch (e) {
      console.error('Failed to skip refill:', e);
    }
  };

  const handleSendSpecialOrder = async (order: any) => {
    try {
      const msg = `🏬 *QUICK SPECIAL ORDER — AI PHARMACY*\n\n📦 *Item:* ${order.product}\n📊 *Qty:* ${order.qty || 1}\n📋 *Requested By:* ${order.requester || 'Customer'} (${order.phone || 'N/A'})\n\n*Please confirm receipt & order dispatch.*`;
      
      if (order.phone) {
        const cleanPhone = order.phone.replace(/\D/g, '');
        const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(msg)}`;
        window.open(waUrl, '_blank');
      }

      await apiClient.post(`/orders/${order.id}/status`, { status: 'Ordered' });
      toastEvent.trigger(`Marked special request "${order.product}" as Ordered!`, 'success');
      window.dispatchEvent(new CustomEvent('refresh-special-orders'));
      onActionComplete();
    } catch (e: any) {
      console.error('Failed to send special order:', e);
      toastEvent.trigger('Failed to update special request status', 'error');
    }
  };

  const handleAddToCartSpecialOrder = (order: any) => {
    liveCartAddEvent.triggerOpen(order.product, order.qty || 1, order.id);
    toastEvent.trigger(`Added "${order.product}" to Live Cart search!`, 'info');
  };

  if (!expanded) {
    const activeRefillsCount = Array.isArray(refills) ? refills.filter(r => r.is_active === 1).length : 0;
    const activeSpecialOrdersCount = Array.isArray(specialOrders) 
      ? specialOrders.filter(s => s.status !== 'Completed' && s.status !== 'Cancelled').length 
      : 0;
    const stagedNotificationsCount = Array.isArray(notifications) ? notifications.length : 0;

    return (
      <div
        onClick={() => setExpanded(true)}
        className="w-10 h-full bg-glass-bg border-l border-glass-border flex flex-col items-center py-4 gap-4 hover:bg-bg2/40 hover:text-text transition-all duration-200 cursor-pointer shrink-0 z-20 select-none shadow-[inset_1px_0_0_rgba(255,255,255,0.02)]"
        title="Expand Quick Assist"
      >
        <ChevronLeftIcon size={16} className="text-muted mt-1" />
        
        {/* 3 Distinct Category Count Badges at TOP */}
        <div className="flex flex-col gap-1.5 items-center mt-1">
          {/* 1. Automations / Refills (Purple) */}
          {activeRefillsCount > 0 && (
            <div 
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-purple-500/20 text-purple-400 text-[9px] font-black border border-purple-500/40 shadow-sm"
              title={`Automations / Refills: ${activeRefillsCount}`}
            >
              {activeRefillsCount}
            </div>
          )}

          {/* 2. Quick Special Requests (Amber) */}
          {activeSpecialOrdersCount > 0 && (
            <div 
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-black border border-amber-500/40 shadow-sm animate-pulse"
              title={`Quick Special Requests: ${activeSpecialOrdersCount}`}
            >
              {activeSpecialOrdersCount}
            </div>
          )}

          {/* 3. Staged Messages / Notifications (Emerald) */}
          {stagedNotificationsCount > 0 && (
            <div 
              className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black border border-emerald-500/40 shadow-sm"
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
          <ActivityIcon size={12} className="rotate-90 shrink-0 text-purple-400" />
          <span>Quick Assist</span>
        </div>
      </div>
    );
  }

  const activeRefills = refills.filter(r => r.is_active === 1);
  const inactiveRefills = refills.filter(r => r.is_active === 0);
  const activeSpecialOrders = Array.isArray(specialOrders) 
    ? specialOrders.filter(s => s.status !== 'Completed' && s.status !== 'Cancelled') 
    : [];

  return (
    <div ref={sidebarRef} className="w-80 bg-glass-bg border-l border-glass-border backdrop-blur-xl flex flex-col h-full shrink-0 z-20 transition-all duration-300">
      {/* Header */}
      <div className="p-4 border-b border-glass-border flex items-center justify-between shrink-0 bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-purple-400" />
          <span className="text-sm font-bold text-text uppercase tracking-wider">Quick Assist</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="p-1 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-all cursor-pointer"
          title="Collapse"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      {/* Main content scroll */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin">
        {/* Active Refills */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-muted/70">
            <span>Automations ({activeRefills.length})</span>
            <button
              onClick={() => navigate('/refills')}
              className="text-[9px] font-black text-sky-400 hover:text-sky-300 uppercase tracking-widest"
            >
              Manage
            </button>
          </div>
          {activeRefills.length === 0 ? (
            <p className="text-xs text-muted/50 italic pl-2 py-1">No active refill tracks</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activeRefills.map(refill => (
                <div key={refill.id} className="p-3 rounded-xl bg-white/[0.01] border border-glass-border flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-semibold text-xs text-text truncate max-w-[170px]">{refill.patient_name}</span>
                    {refill.hold_for_stock === 1 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[8px] font-bold uppercase tracking-wider animate-pulse shrink-0">
                        Hold Stock
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted flex items-center gap-1">
                    <span className="font-mono text-purple-400">{refill.medicine_name}</span>
                    <span>·</span>
                    <span>{refill.refill_interval_days}d cycle</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 justify-between">
                    <div className="flex items-center gap-1 text-[9px] text-muted/70 font-medium">
                      <ClockIcon size={10} />
                      <span>Next: {new Date(refill.next_refill_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    </div>
                    {refill.hold_for_stock === 1 && (
                      <button
                        onClick={() => handleAcknowledge(refill.id)}
                        className="py-1 px-2.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black tracking-wide uppercase transition-colors shadow-sm cursor-pointer"
                        title="Mark item as checked / resolved"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Due Soon — patients with upcoming refills (within 5 days) */}
        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const cutoff = new Date(today);
          cutoff.setDate(today.getDate() + 5);

          const dueSoon = refills.filter(r => {
            if (r.is_active !== 1) return false;
            if (!r.next_refill_date) return false;
            const d = new Date(r.next_refill_date);
            return d >= today && d <= cutoff;
          });

          if (dueSoon.length === 0) return null;

          return (
            <div>
              <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400/80">
                <div className="flex items-center gap-1.5">
                  <BellRing size={13} className="text-emerald-400" />
                  <span>Due Soon ({dueSoon.length})</span>
                </div>
                <button
                  onClick={() => navigate('/refills')}
                  className="text-[9px] font-black text-emerald-400 hover:text-emerald-300 uppercase tracking-widest"
                >
                  View All
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {dueSoon.map(refill => {
                  const dueDate = new Date(refill.next_refill_date);
                  const diffDays = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
                  const dueLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`;
                  return (
                    <div key={refill.id} className="p-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/20 flex items-center justify-between gap-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-xs text-text truncate">{refill.patient_name}</span>
                        <span className="text-[10px] text-emerald-400 font-mono">{dueLabel}</span>
                      </div>
                      <button
                        onClick={() => handleSend(refill.id)}
                        className="shrink-0 py-1.5 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold tracking-wide uppercase transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer min-w-[60px] justify-center"
                        title={`Send WhatsApp reminder to ${refill.patient_name}`}
                      >
                        <SendIcon size={11} />
                        Send
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Quick Special Requests */}
        <div>
          <div className="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">
            <div className="flex items-center gap-1.5">
              <Package size={14} className="text-amber-400" />
              <span>Quick Special Requests ({activeSpecialOrders.length})</span>
            </div>
            <button
              onClick={() => navigate('/crm?tab=special_orders')}
              className="text-[9px] font-black text-amber-400 hover:text-amber-300 uppercase tracking-widest"
            >
              View All
            </button>
          </div>
          {activeSpecialOrders.length === 0 ? (
            <p className="text-xs text-muted/50 italic pl-2 py-1">No active special requests</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activeSpecialOrders.map(order => (
                <div key={order.id} className="p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-bold text-xs text-text truncate">{order.product}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-mono font-bold shrink-0">
                      Qty: {order.qty || 1}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted flex items-center justify-between">
                    <span className="truncate">{order.requester || 'Customer'} {order.phone ? `(${order.phone})` : ''}</span>
                    <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      order.status === 'Ready' 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : order.status === 'Ordered' 
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {order.status || 'Pending'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {order.status === 'Ready' ? (
                      <button
                        onClick={async () => {
                          try {
                            await apiClient.post(`/orders/${order.id}/status`, { status: 'Completed' });
                            toastEvent.trigger(`Marked "${order.product}" as Completed!`, 'success');
                            window.dispatchEvent(new CustomEvent('refresh-special-orders'));
                            window.dispatchEvent(new CustomEvent('app-special-orders-updated'));
                            onActionComplete();
                          } catch (err) {
                            console.error('Failed to complete order:', err);
                            toastEvent.trigger('Failed to update status', 'error');
                          }
                        }}
                        className="flex-1 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        title="Mark special request as Completed"
                      >
                        <Check size={12} />
                        Complete
                      </button>
                    ) : order.status === 'Ordered' ? (
                      <button
                        onClick={async () => {
                          try {
                            await apiClient.post(`/orders/${order.id}/status`, { status: 'Ready' });
                            toastEvent.trigger(`Marked "${order.product}" as Ready!`, 'success');
                            window.dispatchEvent(new CustomEvent('refresh-special-orders'));
                            window.dispatchEvent(new CustomEvent('app-special-orders-updated'));
                            onActionComplete();
                          } catch (err) {
                            console.error('Failed to mark order as ready:', err);
                            toastEvent.trigger('Failed to update status', 'error');
                          }
                        }}
                        className="flex-1 py-1.5 rounded bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        title="Mark order as Ready for customer"
                      >
                        <Check size={12} />
                        Mark Ready
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSendSpecialOrder(order)}
                        className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        title="Send WhatsApp Order for this Special Request"
                      >
                        <SendIcon size={12} />
                        Send Order
                      </button>
                    )}
                    <button
                      onClick={() => handleAddToCartSpecialOrder(order)}
                      className="py-1.5 px-2.5 rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-[10px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer"
                      title="Add item to Pharmarack Cart"
                    >
                      <ShoppingCart size={11} />
                      Cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Staged Messages */}
        <div>
          <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-purple-400">
            <MessageSquareIcon size={14} />
            <span>Staged Messages ({notifications.length})</span>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-muted/60 pl-2">No staged messages</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {notifications.map(msg => (
                <div key={msg.id} className="p-3 rounded-xl bg-purple-500/[0.03] border border-purple-500/20 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text truncate max-w-[140px]">{msg.recipient_name}</span>
                    <span className="text-[10px] text-purple-400 font-bold font-mono truncate max-w-[100px]">{msg.recipient_phone}</span>
                  </div>
                  <p className="text-[11px] text-muted leading-snug italic bg-black/10 p-1.5 rounded-lg border border-glass-border">
                    "{msg.message}"
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => handleSend(msg.reference_id ? Number(msg.reference_id) : msg.id)}
                      className="flex-1 py-1.5 rounded bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold tracking-wide uppercase transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      title="Approve and Send WhatsApp message"
                    >
                      <SendIcon size={12} />
                      Send
                    </button>
                    <button
                      onClick={() => handlePause(msg.reference_id ? Number(msg.reference_id) : msg.id)}
                      className="py-1 px-2 rounded border border-glass-border hover:bg-white/5 text-muted hover:text-white text-[10px] font-bold uppercase transition-all cursor-pointer"
                      title="Pause this refill reminder cycle"
                    >
                      <PauseIcon size={10} />
                    </button>
                    <button
                      onClick={() => handleSkip(msg.reference_id ? Number(msg.reference_id) : msg.id)}
                      className="py-1 px-2.5 rounded border border-glass-border hover:bg-white/5 text-muted hover:text-white text-[10px] font-bold uppercase transition-all cursor-pointer"
                      title="Skip this alert for today"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Module-level cache for staged counts to prevent redundant database fetches on page switches (G4)
let cachedStagedSalesCount: number | null = null;
let cachedStagedPurchasesCount: number | null = null;
let lastStagedCountsFetchTime = 0;

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
  const isFitPage = ['/pos', '/inventory', '/orders', '/expiry', '/database', '/returns', '/purchases', '/manual-purchase', '/sells', '/purchase-history', '/crm', '/reports', '/learning', '/pharmarack-cart', '/non-mapped-distributors', '/automation-center', '/investigation', '/phone-sales', '/refills', '/migration'].includes(location.pathname);

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const stored = localStorage.getItem('app_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.map((n: any) => ({ ...n, time: new Date(n.time) }));
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
        return parsed.some((n: any) => !n.read);
      }
    } catch {}
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

  const [stagedNotifications, setStagedNotifications] = useState<any[]>([]);
  const [compactCacheLoaded, setCompactCacheLoaded] = useState(() => isCompactInventoryCacheReady());

  // Priority 0 on cold boot: compact inventory cache before other startup polls
  useEffect(() => {
    if (compactCacheLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await api.getCompactInventory();
        if (!cancelled) {
          console.log('[Layout] Compact inventory cache loaded.');
          setCompactCacheLoaded(true);
        }
      } catch (err) {
        if (!cancelled) console.warn('[Layout] Failed to load compact inventory:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [compactCacheLoaded]);

  const { data: specialOrdersList = [], refetch: refetchSpecialOrders } = useApiQuery<any[]>(
    'orders',
    async () => {
      const data = await api.getOrders();
      return Array.isArray(data) ? data : [];
    },
    { refetchInterval: 15000, staleTime: 5000, enabled: compactCacheLoaded }
  );

  const { data: refillsList = [], refetch: refetchRefills } = useApiQuery<any[]>(
    'refills',
    async () => {
      const data = await api.getRefills();
      return Array.isArray(data) ? data : [];
    },
    { refetchInterval: 15000, staleTime: 5000, enabled: compactCacheLoaded }
  );

  useEffect(() => {
    const handleRefresh = () => refetchSpecialOrders();
    window.addEventListener('refresh-special-orders', handleRefresh);
    window.addEventListener('app-special-orders-updated', handleRefresh);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
      window.removeEventListener('app-special-orders-updated', handleRefresh);
    };
  }, [refetchSpecialOrders]);
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
    } catch {}
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
    const unsubRefill = refillEvent.subscribeRefresh(() => {
      fetchStagedNotifications();
      refetchSpecialOrders();
      refetchRefills();
    });

    const handleDataRefresh = () => {
      fetchStagedNotifications();
      refetchSpecialOrders();
      refetchRefills();
    };

    window.addEventListener('focus', handleDataRefresh);
    document.addEventListener('visibilitychange', handleDataRefresh);
    window.addEventListener('refresh-special-orders', handleDataRefresh);
    window.addEventListener('app-purchases-updated', handleDataRefresh);

    return () => {
      unsubRefill();
      window.removeEventListener('focus', handleDataRefresh);
      document.removeEventListener('visibilitychange', handleDataRefresh);
      window.removeEventListener('refresh-special-orders', handleDataRefresh);
      window.removeEventListener('app-purchases-updated', handleDataRefresh);
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

  const handleClearAll = useCallback(() => {
    setNotifications([]);
    setHasUnread(false);
  }, []);

  const handleClearOne = useCallback((id: number) => {
    setNotifications(prev => {
      const updated = prev.filter(n => n.id !== id);
      if (updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  const handleMarkRead = useCallback((id: number) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      if (updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text selection:bg-primary/30">
      <Sidebar
        stagedSalesCount={pendingStagedSalesCount}
        stagedPurchasesCount={pendingStagedPurchasesCount}
        onOpenReview={() => setShowStagedReview(true)}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Topbar
          theme={theme}
          setTheme={setTheme}
          notifications={notifications}
          hasUnread={hasUnread}
          onNewNotification={handleNewNotification}
          onClearAll={handleClearAll}
          onClearOne={handleClearOne}
          onMarkRead={handleMarkRead}
          onOpenStagedReview={() => setShowStagedReview(true)}
          onOpenConnectModal={() => setShowConnectModal(true)}
          onOpenWaQueue={() => setShowWaQueuePopover(true)}
          onMenuClick={() => setMobileNavOpen(true)}
          compactCacheLoaded={compactCacheLoaded}
        />
        <div className="flex-1 flex flex-row overflow-hidden relative">
          <main className={`flex-1 flex flex-col ${isFitPage ? 'overflow-hidden p-3 pt-1.5 pb-3' : 'overflow-y-auto p-4 pt-3 pb-4'} relative transition-all duration-200`}>
            {children}
          </main>
          
          <QuickAssistSidebar
            expanded={isSidebarExpanded}
            setExpanded={setIsSidebarExpanded}
            refills={refillsList}
            notifications={stagedNotifications}
            specialOrders={specialOrdersList}
            onActionComplete={() => {
              fetchStagedNotifications();
              refetchSpecialOrders();
              refetchRefills();
            }}
          />
        </div>
        
        {/* Real-Time Connected Mobile Devices Status Footer Bar */}
        <ConnectedDevicesFooterBar
          onOpenConnectModal={() => setShowConnectModal(true)}
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

export default Layout;
