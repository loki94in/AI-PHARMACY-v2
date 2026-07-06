import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  QrCode,
  RefreshCw,
  Building2,
  Clock,
  Edit,
} from 'lucide-react';
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

import { toastEvent, quickOrderEvent, liveCartAddEvent } from '../services/events';
import type { ToastEventDetail } from '../services/events';
import { QuickOrderModal } from './QuickOrderModal';
import { LiveCartAddModal } from './LiveCartAddModal';
import { StagedReviewModal } from './StagedReviewModal';
import { MobileConnectionModal } from './MobileConnectionModal';
import { api, apiClient } from '../services/api';
import { pageImports } from '../lib/pageImports';
import BackupCenterModal from './BackupCenterModal';

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
}: {
  stagedSalesCount?: number;
  stagedPurchasesCount?: number;
  onOpenReview?: () => void;
}) => {
  const location = useLocation();
  const menuItems = [
    { path: '/pos', label: 'Sales / POS', icon: <ShoppingCart size={18} /> },
    { path: '/crm?tab=refills', label: 'Patient Refills', icon: <Clock size={18} /> },
    { path: '/sells', label: 'Sells / Bills', icon: <Receipt size={18} /> },
    { path: '/phone-sales', label: 'Phone Sales', icon: <Smartphone size={18} /> },
    { path: '/investigation', label: 'Investigation Center', icon: <PackageSearch size={18} /> },
    { path: '/inventory', label: 'Inventory', icon: <PackageSearch size={18} /> },
    { path: '/purchases', label: 'Purchases', icon: <Receipt size={18} /> },
    { path: '/purchase-history', label: 'Purchase History', icon: <ClipboardList size={18} /> },
    { path: '/mail', label: 'Distributor Mail', icon: <Activity size={18} /> },
    { path: '/learning?tab=doctors', label: 'Doctors', icon: <UserPlus size={18} /> },
    { path: '/returns?tab=expiry', label: 'Expiry Monitor', icon: <CalendarDays size={18} /> },
    { path: '/returns', label: 'Supplier Returns', icon: <RotateCcw size={18} /> },
    { path: '/orders', label: 'Orders & Requests', icon: <ClipboardList size={18} /> },
    { path: '/crm?tab=automation', label: 'Automation Center', icon: <Activity size={18} /> },
    { path: '/pharmarack-cart', label: 'Pharmarack Cart', icon: <ShoppingCart size={18} /> },
    { path: '/pharmarack-cart?tab=non-mapped', label: 'Non-Mapped Distributors', icon: <Building2 size={18} /> },
    { path: '/database', label: 'Master Database', icon: <Database size={18} /> },
    { path: '/composition-queue', label: 'Composition Queue', icon: <Beaker size={18} /> },
    { path: '/reports', label: 'Reports', icon: <LayoutDashboard size={18} /> },
    { path: '/learning', label: 'AI Learning', icon: <Activity size={18} /> },
    { path: '/crm', label: 'CRM / Patients', icon: <Users size={18} /> },
    { path: '/database?tab=catalog', label: 'Catalog Upload', icon: <Database size={18} /> },
    { path: '/customer-returns', label: 'Customer Returns', icon: <RotateCcw size={18} /> },
    { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { path: '/migration', label: 'Data Migration', icon: <Database size={18} /> },
    { path: '/learning?tab=dispatch', label: 'Dispatch', icon: <Activity size={18} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
    { path: '/license', label: 'License', icon: <Database size={18} /> },
  ];

  return (
    <div className="w-64 bg-glass-bg border-r border-glass-border backdrop-blur-xl flex flex-col h-full">
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
          <div className="shrink-0 pl-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green"></span>
            </span>
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
                if (basePath === '/crm') return !currentTab || currentTab === 'crm';
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
                }}
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
}) => {
  const location = useLocation();
  const [showPanel, setShowPanel] = useState(false);
  const [flashToast, setFlashToast] = useState<(ToastEventDetail & { id: number }) | null>(null);
  const [catalogJob, setCatalogJob] = useState<{
    id: number;
    status: string;
    progress: number;
    total_count?: number;
    processed_count?: number;
  } | null>(null);

  const [orderAlertCount, setOrderAlertCount] = useState(0);

  const fetchAlertCount = useCallback(async () => {
    try {
      const [orders, refills] = await Promise.all([
        api.getOrders(),
        api.getRefills(),
      ]);
      const pendingOrdersCount = Array.isArray(orders) 
        ? orders.filter(o => o.status === 'Pending' || o.status === 'Ordered').length 
        : 0;
      const pendingRefillsCount = Array.isArray(refills)
        ? refills.filter(r => r.is_active === 1 && r.status === 'pending' && r.hold_for_stock === 1).length
        : 0;
      setOrderAlertCount(pendingOrdersCount + pendingRefillsCount);
    } catch (err) {
      console.warn('Failed to fetch alert counts for Topbar:', err);
    }
  }, []);

  useEffect(() => {
    fetchAlertCount();
    // Poll every 30 seconds
    const interval = setInterval(fetchAlertCount, 30000);
    
    // Also refresh on cart refresh/update events
    const handleRefresh = () => {
      fetchAlertCount();
    };
    window.addEventListener('refresh-pharmarack-cart', handleRefresh);
    window.addEventListener('refresh-special-orders', handleRefresh);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('refresh-pharmarack-cart', handleRefresh);
      window.removeEventListener('refresh-special-orders', handleRefresh);
    };
  }, [fetchAlertCount]);

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
    const timer = setInterval(fetchActiveJob, 30000); // Optimized: poll active catalog jobs every 30s instead of 8s
    return () => clearInterval(timer);
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

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 30000); // Optimized: poll connected devices every 30s instead of 5s
    return () => clearInterval(interval);
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

  // Connect to backend real-time notification SSE stream
  useEffect(() => {
    const backendUrl = apiClient.defaults.baseURL || window.location.origin;
    const cleanBaseUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
    const sseUrl = cleanBaseUrl.startsWith('/api')
      ? `${cleanBaseUrl}/notifications/stream`
      : `${cleanBaseUrl}/api/notifications/stream`;
    
    let eventSource: EventSource | null = null;
    
    const connectSSE = () => {
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'wa_new_message' || data.type === 'wa_message_ack' || data.type === 'wa_chats_updated') {
            window.dispatchEvent(new CustomEvent('whatsapp_event', { detail: data }));
          }
          if (data.type === 'auth_failure' || data.type === 'auth_required' || data.type === 'notification') {
            toastEvent.trigger(
              data.payload?.message || data.message || 'Action required',
              data.payload?.type || 'error',
              data.payload?.link || '/settings'
            );
          } else if (data.type === 'catalog_job_progress' && data.payload) {
            const payload = data.payload;
            setCatalogJob(prev => {
              if (!prev || prev.id === payload.id) {
                return {
                  id: payload.id,
                  status: payload.status || 'processing',
                  progress: payload.progress !== undefined ? payload.progress : (prev?.progress || 0),
                  total_count: payload.total_count,
                  processed_count: payload.processed_count || (payload.progress / 100 * (payload.total_count || 0))
                };
              }
              return prev;
            });
          } else if (data.type === 'catalog_job_update' && data.payload) {
            const payload = data.payload;
            const status = payload.status;
            if (status === 'done' || status === 'failed') {
              setCatalogJob(null);
            } else {
              setCatalogJob(prev => {
                if (!prev || prev.id === payload.id) {
                  return {
                    id: payload.id,
                    status: status,
                    progress: payload.progress !== undefined ? payload.progress : (prev?.progress || 0),
                    total_count: payload.total_count,
                    processed_count: payload.processed_count
                  };
                }
                return prev;
              });
            }
            if (status === 'waiting_for_mapping') {
              toastEvent.trigger('Catalogue analyzed! Ready for mapping configuration.', 'info', '/catalog');
            } else if (status === 'done') {
              toastEvent.trigger('Catalogue ingestion completed successfully!', 'success', '/catalog');
            } else if (status === 'failed') {
              toastEvent.trigger('Catalogue processing failed: ' + (payload.error || 'Unknown error'), 'error', '/catalog');
            }
          } else if (data.type === 'sales_sync') {
            toastEvent.trigger(`Mobile synced ${data.payload.count || 1} offline sales bill(s) for review!`, 'info');
            if (typeof (window as any).refreshStagedCounts === 'function') {
              (window as any).refreshStagedCounts(true);
            }
          } else if (data.type === 'purchases_sync') {
            toastEvent.trigger(`Mobile synced ${data.payload.count || 1} offline purchase bill(s) for review!`, 'info');
            if (typeof (window as any).refreshStagedCounts === 'function') {
              (window as any).refreshStagedCounts(true);
            }
          }
        } catch (err) {
          console.error('Failed to parse SSE event:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.warn('SSE disconnected or failed, retrying in 5 seconds...', err);
        eventSource?.close();
        setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      eventSource?.close();
    };
  }, []);

  const onlineDevicesCount = connectedDevices.filter(d => d.is_online === 1).length;

  return (
    <>
      <FlashToast toast={flashToast} onDismiss={() => setFlashToast(null)} onOpenReview={onOpenStagedReview} />
      
      <header className="h-14 bg-glass-bg border-b border-glass-border backdrop-blur-xl flex items-center justify-between px-6 relative z-30 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-wider text-text/90">
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
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile Connection / Devices Status */}
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

          {/* Quick Order Shortcut Button */}
          <button
            onClick={() => quickOrderEvent.triggerOpen()}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center relative hover:bg-white/5 rounded-xl cursor-pointer"
            title="Quick Order (Alt+O)"
            aria-label="Quick order"
          >
            <QrCode size={18} />
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

          {/* Special Orders & Alerts indicator */}
          <Link
            to="/orders"
            className={`
              p-2 rounded-xl transition-colors flex items-center justify-center relative hover:bg-white/5
              ${orderAlertCount > 0 ? 'text-amber-400' : 'text-muted hover:text-white'}
            `}
            title="Special Orders & Pending Requests"
          >
            <ClipboardList size={18} />
            {orderAlertCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            )}
          </Link>

          {/* Backup Center Shortcut Button */}
          <button
            onClick={() => {
              if (typeof (window as any).openBackupCenter === 'function') {
                (window as any).openBackupCenter();
              }
            }}
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center hover:bg-white/5 rounded-xl cursor-pointer"
            title="Backup & Restore Panel"
          >
            <RefreshCw size={18} />
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
// Refill Control Sidebar
// ──────────────────────────────────────────────
const RefillControlSidebar = ({
  expanded,
  setExpanded,
  refills,
  notifications,
  onActionComplete,
}: {
  expanded: boolean;
  setExpanded: (val: boolean) => void;
  refills: any[];
  notifications: any[];
  onActionComplete: () => void;
}) => {
  const navigate = useNavigate();

  const handleAcknowledge = async (id: number) => {
    try {
      await api.acknowledgeRefill(id);
      onActionComplete();
    } catch (e) {
      console.error('Failed to acknowledge refill:', e);
    }
  };

  const handleSend = async (id: number) => {
    try {
      await api.sendRefillNow(id);
      onActionComplete();
    } catch (e) {
      console.error('Failed to send refill message:', e);
    }
  };

  const handlePause = async (id: number) => {
    try {
      await api.updateRefill(id, { is_active: 0 });
      onActionComplete();
    } catch (e) {
      console.error('Failed to pause refill:', e);
    }
  };

  const handleSkip = async (id: number) => {
    try {
      await api.skipRefill(id);
      onActionComplete();
    } catch (e) {
      console.error('Failed to skip refill:', e);
    }
  };

  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="w-10 h-full bg-glass-bg border-l border-glass-border flex flex-col items-center py-4 gap-6 hover:bg-bg2/40 hover:text-text transition-all duration-200 cursor-pointer shrink-0 z-20 select-none shadow-[inset_1px_0_0_rgba(255,255,255,0.02)]"
        title="Expand Refill Assistant"
      >
        <ChevronLeftIcon size={16} className="text-muted mt-2" />
        <div 
          style={{ writingMode: 'vertical-rl' }}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase text-muted tracking-widest"
        >
          <ActivityIcon size={12} className="rotate-90 shrink-0 text-purple-400" />
          <span>Refill Control</span>
        </div>
        {(refills.length > 0 || notifications.length > 0) && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-[9px] font-black text-white px-1 border border-purple-600/30 animate-pulse">
            {refills.length + notifications.length}
          </span>
        )}
      </div>
    );
  }

  const activeRefills = refills.filter(r => r.is_active === 1);
  const inactiveRefills = refills.filter(r => r.is_active === 0);

  return (
    <div className="w-80 bg-glass-bg border-l border-glass-border backdrop-blur-xl flex flex-col h-full shrink-0 z-20 transition-all duration-300">
      {/* Header */}
      <div className="p-4 border-b border-glass-border flex items-center justify-between shrink-0 bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-purple-400" />
          <span className="text-sm font-bold text-text uppercase tracking-wider">Refill Assistant</span>
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
                      className="flex-1 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-black tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                      title="Approve and Send WhatsApp message"
                    >
                      <SendIcon size={10} />
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
  const isFitPage = ['/pos', '/inventory', '/orders', '/expiry', '/database', '/returns', '/purchases', '/manual-purchase', '/sells', '/purchase-history', '/crm', '/reports', '/learning', '/pharmarack-cart', '/non-mapped-distributors', '/automation-center', '/investigation', '/phone-sales', '/refills'].includes(location.pathname);

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
  const [pendingStagedSalesCount, setPendingStagedSalesCount] = useState(0);
  const [pendingStagedPurchasesCount, setPendingStagedPurchasesCount] = useState(0);
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [showLiveCartAdd, setShowLiveCartAdd] = useState(false);

  const [refills, setRefills] = useState<any[]>([]);
  const [stagedNotifications, setStagedNotifications] = useState<any[]>([]);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    try {
      return localStorage.getItem('refill_sidebar_expanded') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('refill_sidebar_expanded', String(isSidebarExpanded));
    } catch {}
  }, [isSidebarExpanded]);

  const fetchRefillData = useCallback(async () => {
    try {
      const data = await api.getRefills();
      setRefills(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load refills in layout:', err);
    }

    try {
      const notifications = await api.getAutomationNotifications({ status: 'staged' });
      setStagedNotifications(Array.isArray(notifications) ? notifications : []);
    } catch (err) {
      console.warn('Failed to load staged notifications in layout:', err);
    }
  }, []);

  useEffect(() => {
    fetchRefillData();
    const timer = setInterval(fetchRefillData, 15000);
    return () => clearInterval(timer);
  }, [fetchRefillData]);

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isBackupStartupMode, setIsBackupStartupMode] = useState(false);

  useEffect(() => {
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

    (window as any).openBackupCenter = () => {
      setIsBackupStartupMode(false);
      setShowBackupModal(true);
    };

    return () => {
      delete (window as any).openBackupCenter;
    };
  }, []);

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
    (window as any).refreshStagedCounts = fetchStagedCounts;
    return () => {
      delete (window as any).refreshStagedCounts;
    };
  }, [fetchStagedCounts]);

  // Subscribe to global open events for modals (G2)
  useEffect(() => {
    const unsubscribeQuickOrder = quickOrderEvent.subscribeOpen(() => setShowQuickOrder(true));
    const unsubscribeLiveCartAdd = liveCartAddEvent.subscribeOpen(() => setShowLiveCartAdd(true));
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
        />
        <div className="flex-1 flex flex-row overflow-hidden relative z-10">
          <main className={`flex-1 flex flex-col ${isFitPage ? 'overflow-hidden p-3 pt-1.5 pb-3' : 'overflow-y-auto p-4 pt-3 pb-4'} relative z-10 transition-all duration-200`}>
            {children}
          </main>
          
          <RefillControlSidebar
            expanded={isSidebarExpanded}
            setExpanded={setIsSidebarExpanded}
            refills={refills}
            notifications={stagedNotifications}
            onActionComplete={fetchRefillData}
          />
        </div>
        
        {/* Global Modals */}
        {showQuickOrder && (
          <QuickOrderModal onClose={() => setShowQuickOrder(false)} />
        )}
        {showLiveCartAdd && (
          <LiveCartAddModal onClose={() => setShowLiveCartAdd(false)} />
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
