import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { toastEvent, quickOrderEvent, liveCartAddEvent } from './services/events';
import type { ToastEventDetail } from './services/events';
import { QuickOrderModal } from './components/QuickOrderModal';
import { LiveCartAddModal } from './components/LiveCartAddModal';
import { StagedReviewModal } from './components/StagedReviewModal';
import { MobileConnectionModal } from './components/MobileConnectionModal';
import { api, apiClient } from './services/api';
import { Agentation } from 'agentation';
import BackupCenterModal from './components/BackupCenterModal';

// ponytail: lazy-load all pages so each is its own JS chunk — avoids loading
// all 26 pages upfront and eliminates the main cause of slow page switching.
export const pageImports: Record<string, () => Promise<any>> = {
  '/dashboard': () => import('./pages/Dashboard'),
  '/inventory': () => import('./pages/Inventory'),
  '/pos': () => import('./pages/POS'),
  '/purchases': () => import('./pages/Purchases'),
  '/crm': () => import('./pages/CRM'),
  '/purchase-history': () => import('./pages/PurchaseHistory'),
  '/migration': () => import('./pages/Migration'),
  '/doctors': () => import('./pages/Doctors'),
  '/dispatch': () => import('./pages/Dispatch'),
  '/reports': () => import('./pages/Reports'),
  '/license': () => import('./pages/License'),
  '/settings': () => import('./pages/Settings'),
  '/mail': () => import('./pages/Mail'),
  '/returns': () => import('./pages/Returns'),
  '/catalog': () => import('./pages/CatalogUpload'),
  '/orders': () => import('./pages/Orders'),
  '/expiry': () => import('./pages/Expiry'),
  '/sells': () => import('./pages/Sells'),
  '/learning': () => import('./pages/Learning'),
  '/database': () => import('./pages/Database'),
  '/composition-queue': () => import('./pages/CompositionQueue'),
  '/customer-returns': () => import('./pages/CustomerReturn'),
  '/customer-return-history': () => import('./pages/CustomerReturnHistory'),
  '/pharmarack-cart': () => import('./pages/PharmarackCart'),
  '/non-mapped-distributors': () => import('./pages/NonMappedDistributors'),
  '/automation-center': () => import('./pages/AutomationCenter'),
  '/investigation': () => import('./pages/Investigation'),
  '/phone-sales': () => import('./pages/PhoneSales'),
};

const Dashboard = lazy(pageImports['/dashboard']);
const Inventory = lazy(pageImports['/inventory']);
const POS = lazy(pageImports['/pos']);
const Purchases = lazy(pageImports['/purchases']);
const CRM = lazy(pageImports['/crm']);
const PurchaseHistory = lazy(pageImports['/purchase-history']);
const Migration = lazy(pageImports['/migration']);
const Doctors = lazy(pageImports['/doctors']);
const Dispatch = lazy(pageImports['/dispatch']);
const Reports = lazy(pageImports['/reports']);
const License = lazy(pageImports['/license']);
const Settings = lazy(pageImports['/settings']);
const Mail = lazy(pageImports['/mail']);
const Returns = lazy(pageImports['/returns']);
const CatalogUpload = lazy(pageImports['/catalog']);
const Orders = lazy(pageImports['/orders']);
const Expiry = lazy(pageImports['/expiry']);
const Sells = lazy(pageImports['/sells']);
const Learning = lazy(pageImports['/learning']);
const DatabasePage = lazy(pageImports['/database']);
const CompositionQueue = lazy(pageImports['/composition-queue']);
const CustomerReturn = lazy(pageImports['/customer-returns']);
const CustomerReturnHistory = lazy(pageImports['/customer-return-history']);
const PharmarackCart = lazy(pageImports['/pharmarack-cart']);
const NonMappedDistributors = lazy(pageImports['/non-mapped-distributors']);
const AutomationCenter = lazy(pageImports['/automation-center']);
const InvestigationCenter = lazy(pageImports['/investigation']);
const PhoneSales = lazy(pageImports['/phone-sales']);

// Minimal page-switch loading fallback — renders instantly, no layout shift
const PageLoader = () => (
  <div className="flex-1 flex items-center justify-center h-full">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <span className="text-xs text-muted font-semibold uppercase tracking-widest">Loading...</span>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
interface AppNotification {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
}

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
    { path: '/sells', label: 'Sells / Bills', icon: <Receipt size={18} /> },
    { path: '/phone-sales', label: 'Phone Sales', icon: <Smartphone size={18} /> },
    { path: '/investigation', label: 'Investigation Center', icon: <PackageSearch size={18} /> },
    { path: '/inventory', label: 'Inventory', icon: <PackageSearch size={18} /> },
    { path: '/purchases', label: 'Purchases', icon: <Receipt size={18} /> },
    { path: '/purchase-history', label: 'Purchase History', icon: <ClipboardList size={18} /> },
    { path: '/mail', label: 'Distributor Mail', icon: <Activity size={18} /> },
    { path: '/doctors', label: 'Doctors', icon: <UserPlus size={18} /> },
    { path: '/expiry', label: 'Expiry Monitor', icon: <CalendarDays size={18} /> },
    { path: '/returns', label: 'Supplier Returns', icon: <RotateCcw size={18} /> },
    { path: '/orders', label: 'Orders & Requests', icon: <ClipboardList size={18} /> },
    { path: '/automation-center', label: 'Automation Center', icon: <Activity size={18} /> },
    { path: '/pharmarack-cart', label: 'Pharmarack Cart', icon: <ShoppingCart size={18} /> },
    { path: '/non-mapped-distributors', label: 'Non-Mapped Distributors', icon: <Building2 size={18} /> },
    { path: '/database', label: 'Master Database', icon: <Database size={18} /> },
    { path: '/composition-queue', label: 'Composition Queue', icon: <Beaker size={18} /> },
    { path: '/reports', label: 'Reports', icon: <LayoutDashboard size={18} /> },
    { path: '/learning', label: 'AI Learning', icon: <Activity size={18} /> },
    { path: '/crm', label: 'CRM / Patients', icon: <Users size={18} /> },
    { path: '/catalog', label: 'Catalog Upload', icon: <Database size={18} /> },
    { path: '/customer-returns', label: 'Customer Returns', icon: <RotateCcw size={18} /> },
    { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { path: '/migration', label: 'Data Migration', icon: <Database size={18} /> },
    { path: '/dispatch', label: 'Dispatch', icon: <Activity size={18} /> },
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
            const isActive = location.pathname === item.path;
            
            // Staged sync count badges
            let badge = null;
            if (item.path === '/sells' && stagedSalesCount > 0) {
              badge = (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[9px] font-black text-white px-1 border border-black/40 animate-pulse">
                  {stagedSalesCount}
                </span>
              );
            } else if (item.path === '/purchases' && stagedPurchasesCount > 0) {
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
                  pageImports[item.path]?.();
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
    // Premium custom Apple logo SVG path
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.12.09 2.27-.56 2.95-1.39z"/>
      </svg>
    );
  }
  
  // Custom Android robot logo SVG path
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
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const dismissFlash = useCallback(() => {
    clearTimeout(flashTimerRef.current);
    setFlashToast(null);
  }, []);

  const handleBellClick = () => {
    setShowPanel(prev => !prev);
  };

  const getPageTitle = (pathname: string) => {
    const map: Record<string, string> = {
      '/learning': 'AI Learning',
      '/crm': 'CRM / Patients',
      '/catalog': 'Catalog Upload',
      '/customer-returns': 'Customer Returns',
      '/dashboard': 'Dashboard',
      '/migration': 'Data Migration',
      '/dispatch': 'Dispatch',
      '/mail': 'Distributor Mail',
      '/doctors': 'Doctors',
      '/expiry': 'Expiry Monitor',
      '/inventory': 'Inventory',
      '/license': 'License',
      '/database': 'Master Database',
      '/composition-queue': 'Composition Queue',
      '/orders': 'Orders & Requests',
      '/purchase-history': 'Purchase History',
      '/purchases': 'Purchases',
      '/manual-purchase': 'Create Purchase Bill',
      '/reports': 'Reports',
      '/pos': 'Sales / POS',
      '/sells': 'Sells / Bills',
      '/investigation': 'Medicine & Bill Investigation Center',
      '/settings': 'Settings',
      '/returns': 'Supplier Returns',
    };
    // Extract base path (e.g. /pos/invoice -> /pos) for fallback matching if needed, though strictly exact match first
    return map[pathname] || 'Administration';
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <>
      {/* Flash Toast — top center */}
      <FlashToast toast={flashToast} onDismiss={dismissFlash} onOpenReview={onOpenStagedReview} />

      <header className="h-16 bg-glass-bg border-b border-glass-border backdrop-blur-xl flex items-center justify-between px-8 shrink-0 relative z-40">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold tracking-tight text-white uppercase">{getPageTitle(location.pathname)}</h2>
        </div>

        {/* Global Catalog Ingestion Progress Bar */}
        {catalogJob ? (
          <Link
            to="/catalog"
            className="hidden md:flex items-center gap-3 bg-bg2/40 border border-glass-border px-4 py-1.5 rounded-2xl max-w-sm w-full transition-all hover:bg-bg3/50 hover:border-primary/30 shadow-[0_0_15px_rgba(14,165,233,0.05)]"
          >
            <div className="flex items-center justify-center shrink-0 w-7 h-7 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <RefreshCw size={12} className="animate-spin text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center text-[10px] font-bold text-text uppercase tracking-wider mb-1">
                <span className="truncate">
                  {catalogJob.status === 'processing_analysis' || catalogJob.status === 'pending_analysis'
                    ? 'Analyzing File...'
                    : catalogJob.status === 'waiting_for_mapping'
                    ? 'Ready for Mapping'
                    : 'Ingesting Catalog...'}
                </span>
                <span className="font-mono text-primary font-bold">{catalogJob.progress}%</span>
              </div>
              <div className="w-full bg-bg3 rounded-full h-1.5 relative overflow-hidden border border-glass-border">
                <div
                  className="h-full bg-gradient-to-r from-primary to-purple-600 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${catalogJob.progress}%` }}
                />
              </div>
              {catalogJob.processed_count !== undefined && catalogJob.total_count !== undefined && catalogJob.total_count > 0 ? (
                <div className="text-[9px] text-muted font-mono mt-0.5 text-right leading-none">
                  {catalogJob.processed_count.toLocaleString()} / {catalogJob.total_count.toLocaleString()}
                </div>
              ) : null}
            </div>
          </Link>
        ) : null}

        <div className="flex items-center gap-3">
          {/* Quick Request */}
          <button
            onClick={() => quickOrderEvent.triggerOpen()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary/20 hover:border-primary/40 text-primary hover:text-white transition-all text-xs font-bold active:scale-95 group shadow-[0_0_12px_rgba(59,130,246,0.05)]"
            title="Quick Order / Special Request (Alt + O)"
          >
            <Plus size={13} className="group-hover:rotate-90 transition-transform duration-300" />
            <span>Quick Request</span>
            <span className="hidden sm:inline text-[9px] bg-black/40 border border-white/10 text-muted px-1.5 py-0.5 rounded font-mono font-normal">Alt + O</span>
          </button>

          {/* Live Cart Add (Direct inventory replenishment) */}
          <button
            onClick={() => liveCartAddEvent.triggerOpen()}
            className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 hover:text-white transition-all text-xs font-bold active:scale-95 group shadow-[0_0_12px_rgba(16,185,129,0.05)]"
            title="Live Cart Add / Inventory Refill (Alt + L)"
          >
            <ShoppingCart size={13} className="group-hover:scale-110 transition-transform duration-300" />
            <span>Live Cart Add</span>
            {orderAlertCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-black px-1 border border-black/40 animate-pulse">
                {orderAlertCount}
              </span>
            )}
            <span className="hidden sm:inline text-[9px] bg-black/40 border border-white/10 text-muted px-1.5 py-0.5 rounded font-mono font-normal">Alt + L</span>
          </button>

          {/* Dev-only: TEST MODE banner when VITE_SKIP_AUTH=true */}
          {import.meta.env.VITE_SKIP_AUTH === 'true' && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400 text-[10px] font-black uppercase tracking-widest animate-pulse select-none"
              title="Auth bypass is active via SKIP_AUTH. Unset SKIP_AUTH to disable.">
              <AlertTriangle size={12} className="shrink-0" />
              <span>Test Mode — Auth Bypassed</span>
            </div>
          )}

          {/* ── Mobile Connection Status Indicators ── */}
          <div className="relative flex items-center gap-2" ref={popoverRef}>
            {connectedDevices.length === 0 ? (
              <button
                onClick={onOpenConnectModal}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-glass-border bg-glass-bg/30 text-muted text-xs font-semibold hover:bg-white/5 transition-all animate-pulse-slow"
                title="Connect mobile device via QR Code"
              >
                <QrCode size={13} className="text-primary animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider font-bold">QR Connect</span>
              </button>
            ) : (
              connectedDevices.map(device => {
                const offlineSeconds = device.offline_seconds ?? 999999;
                const isOnline = device.is_online === 1;
                const isRecentlyOffline = !isOnline && offlineSeconds < 180; // 3 minutes

                // Styles based on status
                let btnStyle = 'bg-glass-bg/30 border-glass-border/40 text-muted hover:bg-white/5';
                let statusText = 'Offline';
                let iconColor = 'text-muted opacity-40';
                
                if (isOnline) {
                  btnStyle = 'bg-green/10 border-green/20 text-green shadow-[0_0_12px_rgba(34,197,94,0.05)] hover:bg-green/15';
                  statusText = 'Connected';
                  iconColor = 'text-green animate-pulse';
                } else if (isRecentlyOffline) {
                  btnStyle = 'bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.05)] hover:bg-amber-500/15';
                  statusText = 'Checking';
                  iconColor = 'text-amber-400 animate-pulse';
                }

                return (
                  <button
                    key={device.token}
                    onClick={isOnline ? () => setShowDevicesPopover(prev => !prev) : onOpenConnectModal}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-300 border ${btnStyle}`}
                    title={isOnline ? `${device.device_name} (${device.os}) - ${statusText}` : `Connect mobile device via QR Code`}
                  >
                    {!isOnline ? (
                      <QrCode size={13} className={`${iconColor}`} />
                    ) : (
                      <DeviceIcon 
                        os={device.os} 
                        size={13} 
                        className={iconColor} 
                      />
                    )}
                    <span className="truncate max-w-[80px] text-[10px] uppercase tracking-wide">
                      {isOnline ? device.device_name : 'QR Connect'}
                    </span>
                    
                    {/* Glowing/offline dot */}
                    <span className="relative flex h-1.5 w-1.5">
                      {isOnline ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green"></span>
                        </>
                      ) : isRecentlyOffline ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                        </>
                      ) : (
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500/50"></span>
                      )}
                    </span>
                  </button>
                );
              })
            )}

            {/* Devices Popover */}
            {showDevicesPopover && (
              <div
                className="absolute right-0 top-full mt-3 w-80 z-dropdown flex flex-col rounded-2xl overflow-hidden glass-panel p-4"
                style={{
                  backdropFilter: 'blur(24px)',
                  boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
                }}
              >
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-glass-border">
                  <span className="text-sm font-bold text-text">Mobile Devices</span>
                  <span className="text-[10px] text-muted font-bold uppercase">
                    {connectedDevices.filter(d => d.is_online === 1).length} / {connectedDevices.length} Connected
                  </span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-thin">
                  {connectedDevices.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted">
                      No mobile devices registered yet.
                    </div>
                  ) : (
                    connectedDevices.map((device) => {
                      const offlineSeconds = device.offline_seconds ?? 999999;
                      const isOnline = device.is_online === 1;
                      const isRecentlyOffline = !isOnline && offlineSeconds < 180;
                      let badgeStyle = 'bg-zinc-500/10 text-muted';
                      let badgeText = 'Offline';
                      let iconColor = 'text-zinc-500';
                      
                      if (isOnline) {
                        badgeStyle = 'bg-green/10 text-green';
                        badgeText = 'Online';
                        iconColor = 'text-green animate-pulse';
                      } else if (isRecentlyOffline) {
                        badgeStyle = 'bg-amber-500/10 text-amber-500';
                        badgeText = 'Checking';
                        iconColor = 'text-amber-500 animate-pulse';
                      }

                      return (
                        <div key={device.token} className="flex flex-col gap-1.5 p-2 rounded-xl bg-bg2/40 border border-glass-border">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {!isOnline ? (
                                <QrCode size={14} className={iconColor} />
                              ) : (
                                <DeviceIcon os={device.os} size={14} className={iconColor} />
                              )}
                              <div className="min-w-0">
                                {renamingToken === device.token ? (
                                  <input
                                    autoFocus
                                    className="text-xs font-semibold bg-bg3 border border-primary/40 rounded px-1.5 py-0.5 text-text w-32 outline-none focus:border-primary"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleRenameDevice(device.token, renameValue);
                                      if (e.key === 'Escape') { setRenamingToken(null); setRenameValue(''); }
                                    }}
                                    onBlur={() => handleRenameDevice(device.token, renameValue)}
                                  />
                                ) : (
                                  <p className="text-xs font-semibold text-text truncate">{device.device_name}</p>
                                )}
                                <p className="text-[9px] text-muted capitalize">{device.os}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => { setRenamingToken(device.token); setRenameValue(device.device_name); }}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-bg3 border border-glass-border text-muted hover:text-primary hover:border-primary/30 transition-all"
                                title="Rename device"
                              >
                                Rename
                              </button>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${badgeStyle}`}>
                                {badgeText}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-glass-border">
                  <button
                    onClick={() => {
                      setShowDevicesPopover(false);
                      onOpenConnectModal();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/20 hover:border-primary/40 text-primary hover:text-white transition-all text-xs font-bold animate-pulse-slow"
                  >
                    <QrCode size={13} />
                    <span>Connect New Device</span>
                  </button>
                </div>
              </div>
            )}
          </div>


          {/* ── Notification Bell ── */}
          <div className="relative">
            <button
              id="notification-bell-btn"
              onClick={handleBellClick}
              className={`
                relative p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center
                ${showPanel
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.2)]'
                  : 'text-muted hover:text-white hover:bg-white/8 border border-transparent'}
              `}
              aria-label="Notifications"
              title="View Notifications"
            >
              {hasUnread ? (
                <BellRing size={18} className={showPanel ? 'text-sky-400' : 'text-white'} />
              ) : (
                <Bell size={18} />
              )}

              {/* Unread badge */}
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60"></span>
                  <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-red-500 text-white text-[9px] font-black border border-black/40">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                </span>
              )}

              {/* Soft blinking dot when unread but count collapses (always visible) */}
              {unreadCount === 0 && hasUnread && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500/60 animate-pulse" />
              )}
            </button>

            {/* Panel */}
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
            className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center"
            aria-label="Toggle theme"
            title={theme === 'light' ? 'Switch to Night Mode' : 'Switch to Day Mode'}
          >
            {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button className="p-2 text-muted hover:text-white transition-colors flex items-center justify-center" aria-label="Log out" title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
    </>
  );
};

// Module-level cache for staged counts to prevent redundant database fetches on page switches (G4)
let cachedStagedSalesCount: number | null = null;
let cachedStagedPurchasesCount: number | null = null;
let lastStagedCountsFetchTime = 0;

// ──────────────────────────────────────────────
// Refill Control Sidebar
// ──────────────────────────────────────────────
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

  const liveOrders = refills.filter(r => r.hold_for_stock === 1 || r.is_ready === 0);
  const stockAlerts = refills.filter(r => r.is_ready === 1);

  if (!expanded) {
    return (
      <div className="w-12 bg-glass-bg border-l border-glass-border backdrop-blur-xl flex flex-col items-center py-4 shrink-0 transition-all duration-300">
        <button
          onClick={() => setExpanded(true)}
          className="p-2 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors mb-4 cursor-pointer"
          title="Expand Refill Sidebar"
        >
          <ChevronLeftIcon size={18} />
        </button>
        <div className="flex flex-col gap-4 mt-4">
          <div className="relative" title={`${liveOrders.length} Live Order Requests`}>
            <CartIcon size={18} className="text-sky-400" />
            {liveOrders.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-500" />
            )}
          </div>
          <div className="relative" title={`${stockAlerts.length} Stock Alerts`}>
            <AlertIcon size={18} className="text-amber-500" />
            {stockAlerts.some(r => r.acknowledged === 0) && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            )}
          </div>
          <div className="relative" title={`${notifications.length} Staged Messages`}>
            <MessageSquareIcon size={18} className="text-purple-400" />
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-500" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-glass-bg border-l border-glass-border backdrop-blur-xl flex flex-col h-full shrink-0 transition-all duration-300 text-sm">
      <div className="p-4 border-b border-glass-border flex items-center justify-between shrink-0 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-sky-400" />
          <span className="font-bold text-text tracking-wide uppercase text-xs">Refill Panel</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="p-1 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          title="Collapse Refill Sidebar"
        >
          <ChevronRightIcon size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 custom-scrollbar">
        <div>
          <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-sky-400">
            <CartIcon size={14} />
            <span>Live Order Requests ({liveOrders.length})</span>
          </div>
          {liveOrders.length === 0 ? (
            <p className="text-xs text-muted/60 pl-2">No active auto-orders</p>
          ) : (
            <div className="flex flex-col gap-2">
              {liveOrders.map(r => (
                <div key={r.id} className="p-2.5 rounded-xl bg-white/[0.02] border border-glass-border flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text truncate max-w-[150px]">{r.medicine_name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[9px] uppercase font-bold">Pharmarack</span>
                  </div>
                  <div className="text-[11px] text-muted leading-none">
                    Patient: {r.patient_name}
                  </div>
                  <div className="text-[10px] text-muted/50 font-mono mt-0.5 flex items-center gap-1">
                    <ClockIcon size={10} />
                    Due: {r.next_refill_date ? new Date(r.next_refill_date).toLocaleDateString() : 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-amber-500">
            <AlertIcon size={14} />
            <span>Stock Alerts ({stockAlerts.length})</span>
          </div>
          {stockAlerts.length === 0 ? (
            <p className="text-xs text-muted/60 pl-2">No pending stock alerts</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {stockAlerts.map(r => {
                const isBlinking = r.acknowledged === 0;
                return (
                  <div
                    key={r.id}
                    className={`
                      p-3 rounded-xl border transition-all duration-300 flex flex-col gap-2
                      ${isBlinking
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-200 animate-pulse'
                        : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'}
                    `}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-text truncate">{r.medicine_name}</div>
                        <div className="text-[11px] text-muted/80 mt-0.5">Patient: {r.patient_name}</div>
                      </div>
                      {!isBlinking && (
                        <span className="text-emerald-400 shrink-0" title="Stock Acknowledged">
                          <ShieldCheckIcon size={16} />
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      {isBlinking && (
                        <button
                          onClick={() => handleAcknowledge(r.id)}
                          className="flex-1 py-1 rounded bg-amber-500 hover:bg-amber-600 text-black text-[10px] font-black tracking-wide uppercase transition-colors flex items-center justify-center gap-1 shadow-sm shrink-0 cursor-pointer"
                        >
                          <CheckSquareIcon size={10} />
                          Check
                        </button>
                      )}
                      <button
                        onClick={() => {
                          navigate(`/pos?refillPatientName=${encodeURIComponent(r.patient_name)}&refillPatientPhone=${encodeURIComponent(r.patient_phone || '')}&refillMedicineId=${r.medicine_id}&refillMedicineName=${encodeURIComponent(r.medicine_name || '')}&refillId=${r.id}&refillDays=${r.refill_interval_days || 30}`);
                        }}
                        className={`
                          py-1 rounded text-[10px] font-black tracking-wide uppercase transition-all flex items-center justify-center gap-1 cursor-pointer
                          ${isBlinking
                            ? 'flex-1 border border-amber-500/35 hover:bg-white/5 text-amber-300'
                            : 'w-full bg-emerald-500 hover:bg-emerald-600 text-black'}
                        `}
                      >
                        <SendIcon size={10} />
                        Checkout
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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

// ──────────────────────────────────────────────
// Layout (holds notification state globally)
// ──────────────────────────────────────────────
const Layout = ({
  children,
  theme,
  setTheme,
}: {
  children: React.ReactNode;
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
}) => {
  const location = useLocation();
  const isFitPage = ['/pos', '/orders', '/expiry', '/database', '/returns', '/purchases', '/manual-purchase', '/sells', '/purchase-history', '/crm', '/reports', '/learning', '/pharmarack-cart', '/non-mapped-distributors', '/automation-center', '/investigation', '/phone-sales'].includes(location.pathname);

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
      // Quick Order Shortcut: Alt+O or Alt+N or Ctrl+Shift+O
      const isQuickOrderKey = 
        (e.altKey && (e.key === 'o' || e.key === 'O')) ||
        (e.altKey && (e.key === 'n' || e.key === 'N')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'o' || e.key === 'O'));

      if (isQuickOrderKey) {
        e.preventDefault();
        setShowQuickOrder(prev => !prev);
      }

      // Live Cart Shortcut: Alt+L or Ctrl+Shift+L
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

      // If a local handler (like an autocomplete dropdown) already prevented default, let it do its thing.
      if (e.defaultPrevented) return;

      // Prevent the browser from changing <input type="number"> values
      if (target instanceof HTMLInputElement && target.type === 'number') {
        e.preventDefault();
      }

      // Find all interactive inputs
      const focusableSelector = 'input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
      const elements = Array.from(document.querySelectorAll(focusableSelector)) as HTMLElement[];
      const index = elements.indexOf(target);

      if (index > -1) {
        e.preventDefault(); // Stop default scroll or number increment
        
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
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
    setHasUnread(true);

    // Show native desktop notification if permission is granted
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

// ──────────────────────────────────────────────
// App
// ──────────────────────────────────────────────
function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.body.classList.add('light');
      try { localStorage.setItem('feedback-toolbar-theme', 'light'); } catch { }
    } else {
      document.documentElement.classList.remove('light');
      document.body.classList.remove('light');
      try { localStorage.setItem('feedback-toolbar-theme', 'dark'); } catch { }
    }
    try { localStorage.setItem('theme', theme); } catch { }
  }, [theme]);



  return (
    <BrowserRouter>
      <Layout theme={theme} setTheme={setTheme}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/pos" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/expiry" element={<Expiry />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/sells" element={<Sells />} />
            <Route path="/phone-sales" element={<PhoneSales />} />
            <Route path="/investigation" element={<InvestigationCenter />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/manual-purchase" element={<Purchases />} />
            <Route path="/purchase-history" element={<PurchaseHistory />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/automation-center" element={<AutomationCenter />} />
            <Route path="/pharmarack-cart" element={<PharmarackCart />} />
            <Route path="/non-mapped-distributors" element={<NonMappedDistributors />} />
            <Route path="/migration" element={<Migration />} />
            <Route path="/doctors" element={<Doctors />} />
            <Route path="/dispatch" element={<Dispatch />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/license" element={<License />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/catalog" element={<CatalogUpload />} />
            <Route path="/learning" element={<Learning />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/composition-queue" element={<CompositionQueue />} />
            <Route path="/customer-returns" element={<CustomerReturn />} />
            <Route path="/customer-returns-history" element={<CustomerReturnHistory />} />
            <Route path="*" element={
              <div className="flex flex-col items-center justify-center h-full text-muted">
                <h1 className="text-2xl font-bold mb-2">Coming Soon</h1>
                <p>This module is currently being migrated to React.</p>
              </div>
            } />
          </Routes>
        </Suspense>
      </Layout>
      <Agentation key={theme} />
    </BrowserRouter>
  );
}

export default App;
