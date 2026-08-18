import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, RotateCw, RotateCcw, ExternalLink, ShoppingCart, Package, AlertCircle, Truck, Clock, Send, Building2, MessageSquare, Phone, UserCheck, Search, Edit2, X, Plus, Check, Calendar, TrendingUp, Layers, Trash2 } from 'lucide-react';
import { formatDisplayDate } from '../../utils/date';
import { api, apiClient, type SpecialOrder, type Refill } from '../../services/api';
import { toastEvent, liveCartAddEvent, specialOrdersEvent, whatsappQueueEvent, messageSendEvent } from '../../services/events';
import { findBestCartMatchForOrder } from '../../utils/orderFuzzyMatcher';

import { useSearchParams, useNavigate } from 'react-router-dom';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import NonMappedDistributors from '../NonMappedDistributors';
import { PharmarackCartCalendar } from '../../components/PharmarackCartCalendar';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { broadcastContactDataChanged } from '../../utils/settingsSync';

interface CartLineItem {
  productId: number | null;
  storeId: number;
  productCode: string;
  productName: string;
  company: string;
  packaging: string;
  qty: number;
  ptr: number;
  mrp: number;
  scheme: string;
  stock: number | null;
  amount: number;
  cartSource: string;
  isChecked: boolean;
  createdDate: string;
}

interface Distributor {
  storeId: number;
  storeName: string;
  lineTotal: number;
  deliveryPersons: { name: string; code: string }[];
  items: CartLineItem[];
}

// Module-level cache to persist data across page navigation (unmount/remount)
let cachedDistributors: Distributor[] = [];
let cachedPendingOrders: SpecialOrder[] = [];
let cachedPendingRefills: Refill[] = [];
let cachedPriceHistory: Record<string, any[]> = {};
let cachedLastFetched: Date | null = null;

const USER_CHECK_STORAGE_KEY = 'pharmacart_user_check_overrides_v1';
const getTodayDateKey = () => new Date().toISOString().slice(0, 10);

const loadUserCheckOverrides = (): Record<string, boolean> => {
  try {
    const saved = localStorage.getItem(USER_CHECK_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.data === 'object' && parsed.date === getTodayDateKey()) {
        return parsed.data;
      }
    }
  } catch (_) { }
  return {};
};

const saveUserCheckOverrides = (overrides: Record<string, boolean>) => {
  try {
    localStorage.setItem(USER_CHECK_STORAGE_KEY, JSON.stringify({
      date: getTodayDateKey(),
      timestamp: Date.now(),
      data: overrides
    }));
  } catch (_) { }
};

const getItemCheckKey = (storeId: number, item: { productCode?: string; productId?: number | string | null; productName?: string; product?: string; name?: string }): string => {
  const code = item.productCode || (item.productId !== null && item.productId !== undefined ? String(item.productId) : '');
  const name = (item.productName || item.product || item.name || '').toLowerCase().trim();
  return `${storeId}::${code}::${name}`;
};

let waWindowRef: Window | null = null;

function openOrReuseWhatsappTab(url: string, phone?: string, text?: string) {
  // Convert web.whatsapp.com/send to api.whatsapp.com/send for 100% reliable loading
  let targetUrl = url;
  if (phone) {
    let cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length === 10) cleanDigits = `91${cleanDigits}`;
    const encodedText = encodeURIComponent(text || '');
    targetUrl = `https://api.whatsapp.com/send?phone=${cleanDigits}&text=${encodedText}`;
  } else if (url.includes('web.whatsapp.com/send')) {
    targetUrl = url.replace('web.whatsapp.com/send', 'api.whatsapp.com/send');
  }

  // 1. Dispatch custom events and window.postMessage for Chrome / WhatsApp Web Extensions
  try {
    window.postMessage({
      type: 'WHATSAPP_WEB_EXTENSION_SEND',
      source: 'AI_PHARMACY',
      phone: phone || '',
      text: text || '',
      url: targetUrl
    }, '*');

    document.dispatchEvent(new CustomEvent('WHATSAPP_WEB_EXTENSION_SEND', {
      detail: { phone: phone || '', text: text || '', url: targetUrl }
    }));
  } catch (err) {
    console.warn('WhatsApp Extension dispatch warning:', err);
  }

  // 2. Reuse existing WhatsApp Web window or open a target tab reliably
  try {
    if (waWindowRef && !waWindowRef.closed) {
      waWindowRef.location.href = targetUrl;
      waWindowRef.focus();
      return;
    }
  } catch (err) {
    console.warn('Could not navigate existing WhatsApp Web window handle:', err);
  }

  waWindowRef = window.open(targetUrl, '_blank');
  if (waWindowRef) {
    try {
      waWindowRef.focus();
    } catch (_) { }
  } else {
    // Fallback if browser blocked popups: direct navigate current tab
    window.location.href = targetUrl;
  }
}

export default function PharmarackCart() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentTab = searchParams.get('tab') || 'cart';
  const [distributors, setDistributors] = useState<Distributor[]>(() => cachedDistributors);
  const [userCheckOverrides, setUserCheckOverrides] = useState<Record<string, boolean>>(() => loadUserCheckOverrides());
  const userCheckOverridesRef = useRef(userCheckOverrides);
  userCheckOverridesRef.current = userCheckOverrides;

  const [loading, setLoading] = useState(() => cachedDistributors.length === 0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(() => cachedLastFetched);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [priceHistoryCache, setPriceHistoryCache] = useState<Record<string, any[]>>(() => cachedPriceHistory);
  const [sendingNotifId, setSendingNotifId] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>(() => cachedPendingOrders);
  const [addingOrderId, setAddingOrderId] = useState<number | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'all' | 'requests' | 'refills' | 'sales_suggestions' | 'missing_phone' | 'history'>('all');
  const [pendingRefills, setPendingRefills] = useState<Refill[]>(() => cachedPendingRefills);
  const [addingRefillId, setAddingRefillId] = useState<number | null>(null);
  const [showAddedItems, setShowAddedItems] = useState<boolean>(false);
  const [reorderBannerCollapsed, setReorderBannerCollapsed] = useState<boolean>(false);

  const [reorderSuggestions, setReorderSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState<boolean>(false);

  const fetchReorderSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const res = await api.getSalesReorderSuggestions();
      if (res && res.success && Array.isArray(res.items)) {
        setReorderSuggestions(res.items);
      }
    } catch (err) {
      console.warn('Failed to load sales reorder suggestions:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const [sentDates, setSentDates] = useState<string[]>([]);
  const [selectedSentDate, setSelectedSentDate] = useState<string>('');
  const [sentOrders, setSentOrders] = useState<any[]>([]);
  const [sentOrdersLoading, setSentOrdersLoading] = useState<boolean>(false);
  const [readdingSentItems, setReaddingSentItems] = useState<boolean>(false);

  // Latest sent order history map by store ID / store name
  const [latestSentMap, setLatestSentMap] = useState<Record<string, { storeId: number | null; storeName: string; placedAt: number; items: any[] }>>({});

  const fetchLatestSentMap = async () => {
    try {
      const res = await api.getPharmarackLatestSentMap();
      if (res && res.success && res.sentMap) {
        setLatestSentMap(res.sentMap);
      }
    } catch (err) {
      console.warn('Failed to load latest sent map:', err);
    }
  };

  interface PastOrderedInfo {
    isPastOrdered: boolean;
    placedAt: number;
    placedDateStr: string;
    isToday: boolean;
    isYesterday: boolean;
  }

  const getPastOrderedInfo = (item: CartLineItem, dist: Distributor): PastOrderedInfo => {
    const storeKey = dist.storeId ? String(dist.storeId) : (dist.storeName || '').toLowerCase().trim();
    const normDistName = (dist.storeName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    let sentInfo = latestSentMap[storeKey] || latestSentMap[(dist.storeName || '').toLowerCase().trim()] || latestSentMap[normDistName];
    if (!sentInfo && normDistName) {
      const matchKey = Object.keys(latestSentMap).find(k => {
        const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normK && (normK === normDistName || (normK.length >= 4 && normDistName.length >= 4 && (normK.includes(normDistName) || normDistName.includes(normK))));
      });
      if (matchKey) sentInfo = latestSentMap[matchKey];
    }

    if (!sentInfo) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    let matchedSentItem: any = null;
    if (Array.isArray(sentInfo.items) && sentInfo.items.length > 0) {
      const normItemName = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
      matchedSentItem = sentInfo.items.find((sentItem: any) => {
        if (item.productCode && sentItem.productCode && item.productCode === sentItem.productCode) {
          return true;
        }
        const normSentName = (sentItem.productName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return normItemName && normSentName && (normItemName === normSentName || (normItemName.length >= 4 && normSentName.length >= 4 && (normItemName.includes(normSentName) || normSentName.includes(normItemName))));
      });
    }

    if (!matchedSentItem && !sentInfo.placedAt) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    const placedTimestamp = Number(matchedSentItem?.placedAt || sentInfo.placedAt || 0);
    if (!placedTimestamp || isNaN(placedTimestamp)) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    const placedDate = new Date(placedTimestamp);
    const now = new Date();

    const isToday = placedDate.getFullYear() === now.getFullYear() &&
                    placedDate.getMonth() === now.getMonth() &&
                    placedDate.getDate() === now.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = placedDate.getFullYear() === yesterday.getFullYear() &&
                        placedDate.getMonth() === yesterday.getMonth() &&
                        placedDate.getDate() === yesterday.getDate();

    const placedDateStr = placedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

    return {
      isPastOrdered: true,
      placedAt: placedTimestamp,
      placedDateStr,
      isToday,
      isYesterday
    };
  };

  const isItemAlreadySent = (item: CartLineItem, dist: Distributor): boolean => {
    // Session status fallback: sent today in current session
    if (sentWaStatusMap[dist.storeId] === 'success' || sentWaStatusMap[dist.storeId] === 'queued') {
      return true;
    }

    const pastInfo = getPastOrderedInfo(item, dist);
    // Only treat as already sent if it was placed TODAY in a previous session
    if (pastInfo.isPastOrdered && pastInfo.isToday) {
      return true;
    }

    return false;
  };

  const isItemIncludedInDispatch = (item: CartLineItem, dist: Distributor): boolean => {
    const pastInfo = getPastOrderedInfo(item, dist);
    const isYesterdayOrPast = pastInfo.isPastOrdered && !pastInfo.isToday;
    if (!isYesterdayOrPast) {
      // Fresh new medicines are always included by default!
      return true;
    }
    const key = getItemCheckKey(dist.storeId, item);
    if (typeof userCheckOverridesRef.current[key] === 'boolean') {
      return userCheckOverridesRef.current[key];
    }
    return false; // Old medicines are unchecked / excluded by default unless user ticks the box
  };

  const handleToggleItemCheck = (storeId: number, itemOrKey: any, isChecked: boolean) => {
    let key = '';
    if (typeof itemOrKey === 'object' && itemOrKey !== null) {
      key = getItemCheckKey(storeId, itemOrKey);
    } else {
      const productKey = String(itemOrKey);
      const targetDist = distributors.find(d => d.storeId === storeId);
      const targetItem = targetDist?.items.find(i => (i.productCode && i.productCode === productKey) || i.productName === productKey);
      key = targetItem ? getItemCheckKey(storeId, targetItem) : `${storeId}::${productKey}::${productKey.toLowerCase().trim()}`;
    }

    setUserCheckOverrides(prev => {
      const next = { ...prev, [key]: isChecked };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });

    setDistributors(prev => {
      const next = prev.map(dist => {
        if (dist.storeId !== storeId) return dist;
        return {
          ...dist,
          items: dist.items.map(item => {
            const itKey = getItemCheckKey(dist.storeId, item);
            const legacyKey = item.productCode || item.productName;
            if (itKey === key || legacyKey === itemOrKey || item.productCode === itemOrKey || item.productName === itemOrKey) {
              return { ...item, isChecked };
            }
            return item;
          })
        };
      });
      cachedDistributors = next;
      return next;
    });
  };

  const handleToggleSelectAllInDist = (storeId: number, isChecked: boolean) => {
    const updatedOverrides: Record<string, boolean> = {};

    setDistributors(prev => {
      const next = prev.map(dist => {
        if (dist.storeId !== storeId) return dist;
        return {
          ...dist,
          items: dist.items.map(item => {
            const key = getItemCheckKey(dist.storeId, item);
            updatedOverrides[key] = isChecked;
            return { ...item, isChecked };
          })
        };
      });
      cachedDistributors = next;
      return next;
    });

    setUserCheckOverrides(prev => {
      const next = { ...prev, ...updatedOverrides };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });
  };

  // Toggle ALL previous-ordered items across ALL distributors at once (for the reorder banner).
  const handleToggleAllPreviousItems = (isChecked: boolean) => {
    const updatedOverrides: Record<string, boolean> = {};

    setDistributors(prev => {
      const next = prev.map(dist => ({
        ...dist,
        items: dist.items.map(item => {
          const pastInfo = getPastOrderedInfo(item, dist);
          if (pastInfo.isPastOrdered && !pastInfo.isToday) {
            const key = getItemCheckKey(dist.storeId, item);
            updatedOverrides[key] = isChecked;
            return { ...item, isChecked };
          }
          return item;
        })
      }));
      cachedDistributors = next;
      return next;
    });

    setUserCheckOverrides(prev => {
      const next = { ...prev, ...updatedOverrides };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });
  };

  const loadSentDates = async () => {
    try {
      const res = await api.getPharmarackSentDates();
      if (res && res.success && Array.isArray(res.dates)) {
        setSentDates(res.dates);
        if (res.dates.length > 0) {
          const targetDate = (!selectedSentDate || !res.dates.includes(selectedSentDate)) ? res.dates[0] : selectedSentDate;
          setSelectedSentDate(targetDate);
          loadSentOrdersForDate(targetDate);
        }
      }
    } catch (err) {
      console.error('Failed to load sent dates:', err);
    }
  };

  const loadSentOrdersForDate = async (dateStr: string) => {
    if (!dateStr) return;
    setSentOrdersLoading(true);
    try {
      const res = await api.getPharmarackSentOrders(dateStr);
      if (res && res.success && Array.isArray(res.orders)) {
        setSentOrders(res.orders);
      }
    } catch (err) {
      console.error('Failed to load sent orders for date:', err);
    } finally {
      setSentOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (sidebarTab === 'history' || currentTab === 'sent-history') {
      loadSentDates();
    }
  }, [sidebarTab, currentTab]);

  useEffect(() => {
    if ((sidebarTab === 'history' || currentTab === 'sent-history') && selectedSentDate) {
      loadSentOrdersForDate(selectedSentDate);
    }
  }, [sidebarTab, currentTab, selectedSentDate]);

  const handleCopySentItemsToCart = async (items: any[]) => {
    if (!items || items.length === 0) return;
    setReaddingSentItems(true);
    try {
      const payload = items.map(item => ({
        productId: item.productId || 0,
        storeId: item.storeId || item.store_id || 0,
        qty: item.qty || item.quantity || 1,
        productCode: item.productCode || '',
        productName: item.productName || item.product || item.name || '',
        company: item.company || '',
        packaging: item.packaging || item.Packing || '',
        rate: item.ptr || item.rate || 0,
        mrp: item.mrp || 0,
        storeName: item.storeName || item.store_name || '',
        mapped: true
      })).filter(i => i.productName);

      if (payload.length === 0) {
        toastEvent.trigger('No valid items to re-add.', 'error');
        return;
      }

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        cachedDistributors = [];
        await fetchCart();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        toastEvent.trigger(`✅ Re-added ${payload.length} item(s) to Pharmarack cart!`, 'success');
        setSearchParams({ tab: 'cart' });
      } else {
        toastEvent.trigger(res?.error || 'Failed to re-add items to cart', 'error');
      }
    } catch (err: any) {
      console.error('Error re-adding sent items to cart:', err);
      toastEvent.trigger('Failed to re-add items: ' + (err?.response?.data?.error || err.message || 'Server error'), 'error');
    } finally {
      setReaddingSentItems(false);
    }
  };

  const [isSendingBatchWhatsApp, setIsSendingBatchWhatsApp] = useState(false);
  const isSendingBatchRef = useRef(false);
  const [sendingWaDistributorId, setSendingWaDistributorId] = useState<number | null>(null);

  // Persistent WhatsApp sent status map by storeId (preserves history across reloads & sessions, scoped to TODAY)
  const getTodayDateKey = () => new Date().toISOString().slice(0, 10);

  const [sentWaStatusMap, setSentWaStatusMap] = useState<Record<number, 'success' | 'queued' | 'sending' | 'error'>>(() => {
    try {
      const saved = localStorage.getItem('pharmacart_sent_wa_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.data === 'object' && parsed.date === getTodayDateKey()) {
          return parsed.data;
        }
      }
    } catch (_) { }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('pharmacart_sent_wa_history', JSON.stringify({
        date: getTodayDateKey(),
        timestamp: Date.now(),
        data: sentWaStatusMap
      }));
    } catch (_) { }
  }, [sentWaStatusMap]);

  const pageActive = usePageActive();

  // Poll WhatsApp queue status to dynamically sync distributor order badges (queued -> sending -> success / error)
  useEffect(() => {
    if (!pageActive) return;
    let isMounted = true;
    const syncQueueStatus = async () => {
      try {
        const qStatus = await api.getWhatsAppQueueStatus();
        if (!qStatus || !qStatus.recentItems || !isMounted) return;

        const recentItems = qStatus.recentItems;
        const updatedStatus: Record<number, 'queued' | 'sending' | 'success' | 'error'> = {};
        const updatedTimes: Record<number, string> = {};

        distributors.forEach(dist => {
          let phoneNum = getDistributorPhoneNumber(dist);
          let cleanPhone = phoneNum.replace(/\D/g, '');
          if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

          const distName = (dist.storeName || '').toLowerCase().trim();
          const matchingItem = recentItems.find((item: any) => {
            const itemPhone = (item.number || '').replace(/\D/g, '');
            const matchPhone = itemPhone.length >= 7 && cleanPhone.length >= 7
              && (itemPhone.endsWith(cleanPhone.slice(-10)) || cleanPhone.endsWith(itemPhone.slice(-10)));
            const itemName = (item.target_name || '').toLowerCase().trim();
            const matchName = distName.length > 0 && itemName.length > 0
              && (itemName === distName || itemName.includes(distName) || distName.includes(itemName));
            if (matchPhone && matchName) return true;
            if (matchPhone && !itemName) return true;
            if (matchName && !itemPhone) return true;
            return matchPhone || matchName;
          });

          if (matchingItem) {
            if (matchingItem.status === 'sending') {
              updatedStatus[dist.storeId] = 'sending';
            } else if (matchingItem.status === 'sent') {
              updatedStatus[dist.storeId] = 'success';
              if (matchingItem.sent_at) {
                const timeStr = new Date(matchingItem.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                updatedTimes[dist.storeId] = timeStr;
              }
            } else if (matchingItem.status === 'failed_perm' || (matchingItem.status === 'failed_offline' && matchingItem.retry_count >= 3)) {
              updatedStatus[dist.storeId] = 'error';
            } else if (matchingItem.status === 'pending' || matchingItem.status === 'failed_offline') {
              updatedStatus[dist.storeId] = 'queued';
            }
          }
        });

        if (Object.keys(updatedStatus).length > 0 && isMounted) {
          setSentWaStatusMap(prev => ({ ...prev, ...updatedStatus }));
        }
        if (Object.keys(updatedTimes).length > 0 && isMounted) {
          setLastSentWaTimeMap(prev => {
            const next = { ...prev, ...updatedTimes };
            try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) {}
            return next;
          });
        }
      } catch (_) {}
    };

    syncQueueStatus();
    const interval = setInterval(syncQueueStatus, 185000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [distributors, pageActive]);

  // Saved distributor contacts, delivery boys, and store settings
  const [storeInfo, setStoreInfo] = useState<{ name: string; phone: string; address: string; email: string; adminPhone: string; deliveryBoyName1: string; deliveryBoyPhone: string; deliveryBoyName2: string; deliveryBoyPhone2: string; invoiceFileFormat: string }>({
    name: 'AI Pharmacy',
    phone: '',
    address: '',
    email: '',
    adminPhone: '',
    deliveryBoyName1: '',
    deliveryBoyPhone: '',
    deliveryBoyName2: '',
    deliveryBoyPhone2: '',
    invoiceFileFormat: 'CSV File Format'
  });

  // Track last sent WhatsApp message timestamps
  const [lastBatchSentTime, setLastBatchSentTime] = useState<string>(() => {
    try {
      return localStorage.getItem('pharmarack_last_batch_sent_time') || '';
    } catch (_) { return ''; }
  });

  const [lastSentWaTimeMap, setLastSentWaTimeMap] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('pharmarack_last_sent_wa_time_map');
      return saved ? JSON.parse(saved) : {};
    } catch (_) { return {}; }
  });

  const [deliveryBoysList, setDeliveryBoysList] = useState<{ id?: number; name: string; whatsapp_number: string; is_active?: number }[]>([]);
  const [savedDistributorsList, setSavedDistributorsList] = useState<any[]>([]);
  const [distributorMappings, setDistributorMappings] = useState<Record<string, { distributorId: number | null; phone: string }>>({});

  const fetchSavedDistributors = async () => {
    try {
      const res = await apiClient.get('/distributors');
      if (res.data && Array.isArray(res.data)) {
        setSavedDistributorsList(res.data);
      }
    } catch (err) {
      console.warn('Failed to load saved distributors list:', err);
    }
  };

  const fetchDistributorMappings = async () => {
    try {
      const res = await apiClient.get('/pharmarack/distributor-mappings');
      if (res.data && Array.isArray(res.data.mappings)) {
        const mapObj: Record<string, { distributorId: number | null; phone: string }> = {};
        res.data.mappings.forEach((m: any) => {
          if (m.store_name) {
            mapObj[m.store_name.toLowerCase().trim()] = {
              distributorId: m.distributor_id || null,
              phone: m.distributor_phone || m.phone || ''
            };
          }
        });
        setDistributorMappings(mapObj);
      }
    } catch (err) {
      console.warn('Failed to load distributor mappings:', err);
    }
  };

  const fetchDeliveryBoys = async () => {
    try {
      const res = await apiClient.get('/dispatch/delivery-boys');
      if (Array.isArray(res.data)) {
        const active = res.data.filter((b: any) => b.is_active !== 0);
        setDeliveryBoysList(active);
        return active as { id?: number; name: string; whatsapp_number: string; is_active?: number }[];
      }
    } catch (err) {
      console.warn('Failed to load delivery boys list for WhatsApp template:', err);
    }
    return [];
  };

  const fetchStoreInfo = async (boys?: { id?: number; name: string; whatsapp_number: string; is_active?: number }[]) => {
    const activeBoys = boys ?? deliveryBoysList;
    try {
      const res = await apiClient.get('/settings');
      if (res.data) {
        const s = res.data;
        setStoreInfo({
          name: s.pharmacy_name || s.shop_name || s.store_name || s.medical_name || s.name || '',
          phone: s.phone || s.shop_phone || s.store_phone || s.whatsapp_number || s.owner_whatsapp_number || '',
          address: s.address || s.shop_address || s.store_address || '',
          email: s.email || '',
          adminPhone: s.admin_whatsapp || s.admin_phone || s.owner_whatsapp_number || '',
          deliveryBoyName1: activeBoys[0]?.name || '',
          deliveryBoyPhone: activeBoys[0]?.whatsapp_number || '',
          deliveryBoyName2: activeBoys[1]?.name || '',
          deliveryBoyPhone2: activeBoys[1]?.whatsapp_number || '',
          invoiceFileFormat: s.distributor_invoice_file_format || 'CSV File Format'
        });
      }
    } catch (err) {
      console.warn('Failed to load store settings for WhatsApp template:', err);
    }
  };

  const loadContactData = async () => {
    const boys = await fetchDeliveryBoys();
    await fetchStoreInfo(boys);
  };

  const hasPharmacySettings = () => {
    return Boolean(
      storeInfo.name && storeInfo.name.trim().length > 0 &&
      storeInfo.phone && storeInfo.phone.trim().length > 0
    );
  };

  useEffect(() => {
    fetchSavedDistributors();
    fetchDistributorMappings();
    loadContactData();

    const handlePhoneUpdate = () => {
      fetchSavedDistributors();
      fetchDistributorMappings();
      loadContactData();
    };

    const handleClearSentHistory = () => {
      setSentWaStatusMap({});
      setLastSentWaTimeMap({});
      setLastBatchSentTime('');
      setLatestSentMap({});
      setSentOrders([]);
      setDistributors([]);
      setPendingOrders([]);
      setPendingRefills([]);
      cachedDistributors = [];
      cachedPendingOrders = [];
      cachedPendingRefills = [];
      cachedPriceHistory = {};
      cachedLastFetched = null;
      try {
        localStorage.removeItem('pharmacart_sent_wa_history');
        localStorage.removeItem('pharmarack_last_sent_wa_time_map');
        localStorage.removeItem('pharmarack_last_batch_sent_time');
        localStorage.removeItem('pharmarack_sent_history');
        localStorage.removeItem('pharmarack_latest_sent_map');
      } catch (_) {}
    };

    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    window.addEventListener('settings-updated', handlePhoneUpdate);
    window.addEventListener('clear-sent-history', handleClearSentHistory);
    window.addEventListener('clear-app-cache', handleClearSentHistory);
    return () => {
      window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
      window.removeEventListener('settings-updated', handlePhoneUpdate);
      window.removeEventListener('clear-sent-history', handleClearSentHistory);
      window.removeEventListener('clear-app-cache', handleClearSentHistory);
    };
  }, []);

  // Session custom phone number override map by storeId (transient in-memory fallback)
  const [customDistributorPhones, setCustomDistributorPhones] = useState<Record<number, string>>({});

  useEffect(() => {
    // Permanently purge stale localStorage phone overrides so latest database numbers are always used
    try {
      localStorage.removeItem('custom_distributor_phones');
    } catch (_) { }
  }, []);

  const isValidPhoneNumber = (rawPhone: string): boolean => {
    if (!rawPhone) return false;
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length === 10) return /^[6789]\d{9}$/.test(digits);
    if (digits.length === 12 && digits.startsWith('91')) return /^91[6789]\d{9}$/.test(digits);
    return false;
  };

  // Distributor filter sub-tab state ('active' | 'all' | 'success' | 'failed' | 'unmapped')
  const [distributorFilterTab, setDistributorFilterTab] = useState<'active' | 'unsent' | 'sent' | 'all' | 'success' | 'failed' | 'unmapped'>('active');

  // Distributor search & contact edit modal state
  const [editingDistributor, setEditingDistributor] = useState<Distributor | null>(null);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalPhoneInput, setModalPhoneInput] = useState('');
  const [selectedSavedDistId, setSelectedSavedDistId] = useState<number | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);

  // New distributor inline creation state inside modal
  const [isAddingNewDistributor, setIsAddingNewDistributor] = useState(false);
  const [newDistNameInput, setNewDistNameInput] = useState('');

  // Missing delivery boy validation prompt state
  const [showMissingBoyModal, setShowMissingBoyModal] = useState(false);
  const [pendingTargetDistributor, setPendingTargetDistributor] = useState<Distributor | 'ALL' | null>(null);
  const [quickBoyName, setQuickBoyName] = useState('');
  const [quickBoyPhone, setQuickBoyPhone] = useState('');
  const [isSavingQuickBoy, setIsSavingQuickBoy] = useState(false);

  const hasDeliveryBoyContacts = () => {
    const hasActiveBoys = deliveryBoysList.some(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0);
    const hasSettingsBoys = Boolean(
      (storeInfo.deliveryBoyPhone && storeInfo.deliveryBoyPhone.trim().length > 0) ||
      (storeInfo.deliveryBoyPhone2 && storeInfo.deliveryBoyPhone2.trim().length > 0)
    );
    return hasActiveBoys || hasSettingsBoys;
  };

  useEffect(() => {
    if (!editingDistributor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingDistributor(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingDistributor]);

  const normalizeDistName = (rawName: string): string => {
    if (!rawName) return '';
    return rawName
      .toLowerCase()
      .trim()
      .replace(/\(.*?\)/g, '')
      .replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic/gi, '')
      .replace(/[^a-z0-9]/g, '');
  };

  const findSavedDistributorMatch = (distName: string) => {
    if (!distName || !Array.isArray(savedDistributorsList)) return null;

    const normCart = normalizeDistName(distName);
    const rawCartNorm = distName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normCart && !rawCartNorm) return null;

    const getPhone = (d: any) => {
      const p = d.phone || d.mobile || d.whatsapp || d.contact || '';
      return p.trim();
    };

    // 1. Highest Priority: EXACT match WITH a non-empty phone number
    const exactWithPhone = savedDistributorsList.find((d: any) => {
      if (!d || !d.name || !getPhone(d)) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (rawCartNorm && rawCartNorm === rawSavedNorm) || (normCart && normSaved && normCart === normSaved);
    });
    if (exactWithPhone) return exactWithPhone;

    // 2. Second Priority: EXACT match ANY record (even if phone not yet set)
    const exactAny = savedDistributorsList.find((d: any) => {
      if (!d || !d.name) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (rawCartNorm && rawCartNorm === rawSavedNorm) || (normCart && normSaved && normCart === normSaved);
    });
    if (exactAny) return exactAny;

    // 3. Third Priority: Fuzzy substring match WITH a non-empty phone number
    const fuzzyWithPhone = savedDistributorsList.find((d: any) => {
      if (!d || !d.name || !getPhone(d)) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        (normCart && normSaved && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });
    if (fuzzyWithPhone) return fuzzyWithPhone;

    // 4. Fourth Priority: Any fuzzy match fallback
    return savedDistributorsList.find((d: any) => {
      if (!d || !d.name) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        (normCart && normSaved && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });
  };

  const getDistributorPhoneNumber = (dist: Distributor): string => {
    // 1. Primary priority: Transient memory session override (user explicitly edited/saved number in modal)
    const custom = customDistributorPhones[dist.storeId];
    if (custom && custom.trim().length > 0) return custom.trim();

    // 2. Persistent store-to-distributor mapping from SQLite DB
    const normName = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
    const cleanStoreNorm = dist.storeName ? dist.storeName.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    let mapping = normName ? distributorMappings[normName] : null;
    if (!mapping && cleanStoreNorm) {
      const matchKey = Object.keys(distributorMappings).find(k => {
        const kNorm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        return kNorm === cleanStoreNorm;
      });
      if (matchKey) {
        mapping = distributorMappings[matchKey];
      }
    }

    if (mapping) {
      if (mapping.distributorId) {
        const found = savedDistributorsList.find((d: any) => d.id === mapping.distributorId);
        const latestPhone = found?.phone || found?.mobile || found?.whatsapp || found?.contact || '';
        if (latestPhone && latestPhone.trim().length > 0) {
          return latestPhone.trim();
        }
      }
      if (mapping.phone && mapping.phone.trim().length > 0) {
        return mapping.phone.trim();
      }
    }

    // 3. Central Database (distributors table) match
    const matched = findSavedDistributorMatch(dist.storeName);
    const dbPhone = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
    if (dbPhone && dbPhone.trim().length > 0) return dbPhone.trim();

    return '';
  };

  const isDistributorMapped = (dist: Distributor) => {
    return isValidPhoneNumber(getDistributorPhoneNumber(dist).replace(/\D/g, ''));
  };

  const mappedDistributors = React.useMemo(() => {
    return distributors.filter(d => isDistributorMapped(d));
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings]);

  const successDistributors = React.useMemo(() => {
    return distributors.filter(d => sentWaStatusMap[d.storeId] === 'success');
  }, [distributors, sentWaStatusMap]);

  const failedDistributors = React.useMemo(() => {
    return distributors.filter(d => sentWaStatusMap[d.storeId] === 'error');
  }, [distributors, sentWaStatusMap]);

  const unmappedDistributors = React.useMemo(() => {
    return distributors.filter(d => !isDistributorMapped(d));
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings]);

  const getCartItemAmount = (item: any): number => {
    if (typeof item.amount === 'number' && item.amount > 0) return item.amount;
    const rate = item.ptr || item.rate || 0;
    const qty = item.qty || item.quantity || 1;
    return rate * qty;
  };

  const getDistributorCheckedTotal = (dist: Distributor): number => {
    return (dist.items || [])
      .filter(item => isItemIncludedInDispatch(item, dist))
      .reduce((sum, item) => sum + getCartItemAmount(item), 0);
  };

  const getDistributorFullTotal = (dist: Distributor): number => {
    return (dist.items || [])
      .reduce((sum, item) => sum + getCartItemAmount(item), 0);
  };

  const unsentCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const checkedTotal = getDistributorCheckedTotal(dist);
      return {
        ...dist,
        lineTotal: checkedTotal
      };
    }).filter(dist => dist.items.length > 0 && sentWaStatusMap[dist.storeId] !== 'success');
  }, [distributors, sentWaStatusMap, userCheckOverrides, latestSentMap]);

  const sentCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const sentItems = dist.items.filter(item => isItemAlreadySent(item, dist));
      const computedTotal = sentItems.reduce((sum, item) => sum + getCartItemAmount(item), 0);
      return {
        ...dist,
        items: sentItems.length > 0 ? sentItems : dist.items,
        lineTotal: computedTotal
      };
    }).filter(dist => (dist.items.length > 0 && dist.items.some(i => isItemAlreadySent(i, dist))) || sentWaStatusMap[dist.storeId] === 'success');
  }, [distributors, latestSentMap, sentWaStatusMap]);

  const activeCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const fullTotal = getDistributorFullTotal(dist);
      return {
        ...dist,
        lineTotal: fullTotal
      };
    }).filter(dist => dist.items.length > 0);
  }, [distributors]);

  const readyToSendDistributors = React.useMemo(() => {
    return distributors.filter(d => 
      isDistributorMapped(d) && 
      (d.items || []).some(i => isItemIncludedInDispatch(i, d)) &&
      sentWaStatusMap[d.storeId] !== 'success'
    );
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings, sentWaStatusMap, userCheckOverrides, latestSentMap]);

  const filteredDistributorList = React.useMemo(() => {
    if (distributorFilterTab === 'unsent' || distributorFilterTab === 'active') return unsentCartDistributors;
    if (distributorFilterTab === 'sent' || distributorFilterTab === 'success') return sentCartDistributors;
    if (distributorFilterTab === 'failed') return failedDistributors;
    if (distributorFilterTab === 'unmapped') return unmappedDistributors;
    if (distributorFilterTab === 'all') return activeCartDistributors;
    return unsentCartDistributors;
  }, [distributorFilterTab, unsentCartDistributors, sentCartDistributors, failedDistributors, unmappedDistributors, activeCartDistributors]);

  // Aggregate all previous-ordered items (yesterday/past) from the current cart for the reorder banner.
  // Uses existing getPastOrderedInfo + isItemIncludedInDispatch — no new data fetching.
  const previousOrderItemsInfo = React.useMemo(() => {
    const result: { dist: Distributor; item: CartLineItem; isChecked: boolean; placedDateStr: string }[] = [];
    for (const dist of distributors) {
      for (const item of dist.items) {
        const pastInfo = getPastOrderedInfo(item, dist);
        if (pastInfo.isPastOrdered && !pastInfo.isToday) {
          result.push({
            dist,
            item,
            isChecked: isItemIncludedInDispatch(item, dist),
            placedDateStr: pastInfo.placedDateStr
          });
        }
      }
    }
    return result;
  }, [distributors, latestSentMap, userCheckOverrides]);

  // ponytail: delivery boy data comes exclusively from /dispatch/delivery-boys (delivery_boys table)
  // Store info (name, phone, address) comes from /settings. No delivery boy keys read from app_settings.

  const fetchPendingRefills = async () => {
    try {
      const res = await apiClient.get('/refills/panel');
      if (res.data && Array.isArray(res.data)) {
        const refillList: Refill[] = [];
        const today = new Date();

        res.data.forEach((patient: any) => {
          if (!patient.medicines || !Array.isArray(patient.medicines)) return;

          patient.medicines.forEach((m: any) => {
            if (m.status === 'canceled' || m.is_active === 0) return;

            const dueDate = new Date(patient.next_refill_date);
            const diffMs = dueDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const reqQty = Number(m.quantity_needed || 1);
            const stockQty = Number(m.in_stock_qty || 0);

            // Show in Quick Assist if stock shortage exists, due within 14 days, or hold_for_stock is set
            if (stockQty < reqQty || diffDays <= 14 || m.hold_for_stock === 1) {
              refillList.push({
                id: m.id,
                patient_name: patient.patient_name,
                patient_phone: patient.patient_phone,
                medicine_id: m.medicine_id || m.id,
                medicine_name: m.medicine_name,
                refill_interval_days: m.refill_interval_days || 30,
                last_refill_date: '',
                next_refill_date: patient.next_refill_date,
                status: m.status || 'active',
                hold_for_stock: m.hold_for_stock || 0,
                is_active: m.is_active !== undefined ? m.is_active : 1,
                quantity_needed: reqQty,
                in_stock_qty: stockQty
              });
            }
          });
        });

        setPendingRefills(refillList);
        cachedPendingRefills = refillList;
        return;
      }
    } catch (err) {
      console.warn('Failed to fetch refill panel for Quick Assist, trying fallback:', err);
    }

    try {
      const data = await api.getRefills();
      if (Array.isArray(data)) {
        const filtered = data.filter(r => r.is_active !== 0 && r.status !== 'canceled');
        setPendingRefills(filtered);
        cachedPendingRefills = filtered;
      }
    } catch (err) {
      console.error('Failed to fetch pending refills:', err);
    }
  };

  const getRefillItemInCart = (refill: Refill) => {
    const refillNameNorm = (refill.medicine_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of distributors) {
      for (const item of dist.items) {
        const cartNameNorm = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cartNameNorm.includes(refillNameNorm) || refillNameNorm.includes(cartNameNorm)) {
          return item;
        }
      }
    }
    return null;
  };

  const handleAddRefillToCart = async (refill: Refill) => {
    setAddingRefillId(refill.id);
    try {
      const medName = refill.medicine_name || `Medicine ${refill.medicine_id}`;
      toastEvent.trigger(`Searching Pharmarack for "${medName}"...`, 'info');
      const searchResults = await api.searchPharmarack(medName);
      if (!searchResults || searchResults.length === 0) {
        toastEvent.trigger(`No Pharmarack matches found for "${medName}"`, 'error');
        return;
      }

      // Add the first matching item to Pharmarack cart
      const matchedItem = searchResults[0];
      const payload = [{
        productId: matchedItem.productId,
        storeId: matchedItem.storeId,
        qty: 1, // Default to 1 pack for refill replenishment
        productCode: matchedItem.productCode,
        productName: matchedItem.name,
        company: matchedItem.company,
        packaging: matchedItem.packaging,
        rate: matchedItem.rate || 0,
        mrp: matchedItem.mrp || 0,
        storeName: matchedItem.distributor,
        mapped: matchedItem.mapped
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger(`Added "${medName}" to Pharmarack cart!`, 'success');
        await fetchCart();
        await fetchPendingRefills();
      } else {
        toastEvent.trigger(res?.error || 'Failed to add item to cart', 'error');
      }
    } catch (err: any) {
      console.error('Failed to add refill to cart:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to add item to cart', 'error');
    } finally {
      setAddingRefillId(null);
    }
  };

  const fetchPendingOrders = async () => {
    try {
      const data = await api.getOrders();
      if (Array.isArray(data)) {
        // Show all pending or ordered requests (no same-day date constraint)
        const filtered = data.filter(o => o.status === 'Pending' || o.status === 'Ordered');
        setPendingOrders(filtered);
        cachedPendingOrders = filtered;
      }
    } catch (err) {
      console.error('Failed to fetch pending special orders:', err);
    }
  };

  const getOrderCartMatch = (order: SpecialOrder) => {
    const { matchedItem, candidateItem, result } = findBestCartMatchForOrder(order, distributors);
    if (result && result.score >= 75) {
      return { item: matchedItem, candidateItem: matchedItem, result, isHighMatch: true, isPartialMatch: false };
    }
    if (result && result.score >= 40 && candidateItem) {
      return { item: null, candidateItem, result, isHighMatch: false, isPartialMatch: true };
    }
    return null;
  };

  const getOrderItemInCart = (order: SpecialOrder) => {
    const match = getOrderCartMatch(order);
    return match ? match.item : null;
  };

  // Single source of truth for the "Req"/"Refills" tab badge counts, so they match what
  // the "Show Added" toggle actually leaves visible in the list below instead of the raw,
  // unfiltered pending counts.
  const visiblePendingOrders = React.useMemo(() => {
    return showAddedItems ? pendingOrders : pendingOrders.filter(order => !getOrderItemInCart(order));
  }, [pendingOrders, showAddedItems]);

  const visiblePendingRefills = React.useMemo(() => {
    return showAddedItems ? pendingRefills : pendingRefills.filter(refill => !getRefillItemInCart(refill));
  }, [pendingRefills, showAddedItems]);

  const handleConfirmCandidateMatch = async (order: SpecialOrder, candidateItem: any) => {
    try {
      const prodName = candidateItem.productName || candidateItem.name || order.product;
      const storeName = candidateItem.distributor || candidateItem.storeName || order.pharmarack_distributor;
      const rate = candidateItem.rate || candidateItem.ptr || order.pharmarack_rate;
      const mrp = candidateItem.mrp || candidateItem.MRP || order.pharmarack_mrp;
      const scheme = candidateItem.scheme || order.pharmarack_scheme;

      await api.updateOrder(order.id, {
        status: 'Ordered',
        product: prodName,
        pharmarack_distributor: storeName,
        pharmarack_rate: rate ? Number(rate) : undefined,
        pharmarack_mrp: mrp ? Number(mrp) : undefined,
        pharmarack_scheme: scheme || undefined,
        pharmarack_mapped: 1,
        cart_add_error: null
      });

      toastEvent.trigger(`Confirmed & linked "${prodName}" to order #${order.id}!`, 'success');
      await fetchPendingOrders();
      await fetchCart();
    } catch (err: any) {
      console.error('Failed to confirm candidate match:', err);
      toastEvent.trigger('Failed to confirm order match', 'error');
    }
  };


  const handleAddPendingToCart = async (order: SpecialOrder) => {
    setAddingOrderId(order.id);
    try {
      toastEvent.trigger(`Searching Pharmarack for "${order.product}"...`, 'info');
      const searchResults = await api.searchPharmarack(order.product);
      if (!searchResults || searchResults.length === 0) {
        toastEvent.trigger(`No Pharmarack matches found for "${order.product}"`, 'error');
        return;
      }

      // Try to find the item from the same distributor if specified
      let matchedItem = searchResults[0];
      if (order.pharmarack_distributor) {
        const exactDist = searchResults.find((r: any) =>
          r.distributor.toLowerCase().trim() === order.pharmarack_distributor!.toLowerCase().trim()
        );
        if (exactDist) {
          matchedItem = exactDist;
        }
      }

      // Add to Pharmarack cart
      const payload = [{
        productId: matchedItem.productId,
        storeId: matchedItem.storeId,
        qty: order.qty,
        productCode: matchedItem.productCode,
        productName: matchedItem.name,
        company: matchedItem.company,
        packaging: matchedItem.packaging,
        rate: order.pharmarack_rate || matchedItem.rate || 0,
        mrp: order.pharmarack_mrp || matchedItem.mrp || 0,
        storeName: matchedItem.distributor,
        mapped: matchedItem.mapped
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger(`Added "${order.product}" to Pharmarack cart!`, 'success');
        // Update order status to 'Ordered'
        await api.updateOrder(order.id, { status: 'Ordered' });
        // Refresh cart & pending list
        await fetchCart();
        await fetchPendingOrders();
      } else {
        toastEvent.trigger(res?.error || 'Failed to add item to cart', 'error');
      }
    } catch (err: any) {
      console.error('Failed to add pending order to cart:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to add item to cart', 'error');
    } finally {
      setAddingOrderId(null);
    }
  };

  const [sendingDeliveryBoyNotifId, setSendingDeliveryBoyNotifId] = useState<number | null>(null);

  const handleSendDeliveryBoyNotification = async (dist: Distributor) => {
    setSendingDeliveryBoyNotifId(dist.storeId);
    try {
      const checkedItems = dist.items.filter(item => item.isChecked !== false);
      const itemsToSend = checkedItems.length > 0 ? checkedItems : dist.items;
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: itemsToSend
      });
      if (res && res.success) {
        toastEvent.trigger(`Delivery Boy notification sent via WhatsApp for ${dist.storeName}!`, 'success');
        // Persist sent status so it reflects immediately and across reloads
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      } else {
        toastEvent.trigger(res?.error || 'Failed to send delivery boy notification.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to send delivery boy notification:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to send delivery boy notification.', 'error');
    } finally {
      setSendingDeliveryBoyNotifId(null);
    }
  };

  const handleSendManualNotification = async (dist: Distributor) => {
    setSendingNotifId(dist.storeId);
    try {
      const checkedItems = dist.items.filter(item => item.isChecked !== false);
      const itemsToSend = checkedItems.length > 0 ? checkedItems : dist.items;
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: itemsToSend
      });
      if (res && res.success) {
        toastEvent.trigger(res.message || 'Notification sent successfully!', 'success');
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      } else {
        toastEvent.trigger(res?.error || 'Failed to send notifications.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to send notifications:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to send notifications.', 'error');
    } finally {
      setSendingNotifId(null);
    }
  };

  // ponytail: accepts optional pre-resolved boy so Send All can pass the live-fetched boy
  // without relying on stale React state closure from deliveryBoysList
  const buildDistributorOrderMessage = (
    dist: Distributor,
    resolvedBoy?: { name: string; whatsapp_number: string } | null
  ) => {
    const formatPhone = (raw: string) => {
      if (!raw) return '';
      let clean = raw.replace(/\D/g, '');
      if (clean.length === 10) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
      if (clean.startsWith('91') && clean.length === 12) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
      if (clean.length > 0) return `+${clean}`;
      return raw;
    };

    // Resolve registered delivery boy — prefer pre-resolved arg to avoid stale closure
    let boyName = 'Not assigned yet';
    let boyPhone = 'N/A';

    // 0. Use pre-resolved boy passed in from the send handler (live-fetched, not stale state)
    if (resolvedBoy?.name && resolvedBoy?.whatsapp_number) {
      boyName = resolvedBoy.name;
      boyPhone = formatPhone(resolvedBoy.whatsapp_number);
    }

    // 1. Check dist.deliveryPersons first if it has a matched delivery boy in deliveryBoysList
    if ((boyName === 'Not assigned yet' || boyPhone === 'N/A') && dist.deliveryPersons && dist.deliveryPersons.length > 0 && dist.deliveryPersons[0].name && dist.deliveryPersons[0].name !== 'Not assigned yet') {
      const match = deliveryBoysList.find(b => b.name && b.name.toLowerCase().includes(dist.deliveryPersons[0].name.toLowerCase()));
      if (match) {
        boyName = match.name;
        boyPhone = formatPhone(match.whatsapp_number);
      } else {
        boyName = dist.deliveryPersons[0].name;
      }
    }

    // 2. Fallback to first registered active delivery boy in deliveryBoysList
    if ((boyName === 'Not assigned yet' || boyPhone === 'N/A') && deliveryBoysList.length > 0) {
      const activeBoy = deliveryBoysList.find(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0) || deliveryBoysList[0];
      if (activeBoy?.name) {
        boyName = activeBoy.name;
        boyPhone = formatPhone(activeBoy.whatsapp_number || '');
      }
    }

    // 3. Fallback to Store Admin/Owner phone if no active delivery boy was found
    if (boyName === 'Not assigned yet' || boyPhone === 'N/A') {
      if (storeInfo.adminPhone || storeInfo.phone) {
        boyName = 'Admin / Store Owner';
        boyPhone = formatPhone(storeInfo.adminPhone || storeInfo.phone);
      }
    }

    const storeName = storeInfo.name || 'AI Pharmacy';
    const address = storeInfo.address || 'N/A';
    const email = storeInfo.email || 'N/A';
    const fileFormat = storeInfo.invoiceFileFormat ? storeInfo.invoiceFileFormat.replace(' File Format', '') : 'CSV';
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const storePhone = storeInfo.phone || storeInfo.adminPhone || '';
    const formattedStorePhone = storePhone ? formatPhone(storePhone) : 'N/A';

    // Filter to send ONLY included items (fresh items + user-checked past items)
    const itemsToSend = dist.items.filter(item => isItemIncludedInDispatch(item, dist));

    let msg = `🏥 *${storeName}*\n`;
    msg += `📍 *Delivery Location:* ${address}\n`;
    msg += `📞 *Pharmacy Contact:* ${formattedStorePhone}\n\n`;
    msg += `📅 *Order Date:* ${dateStr}\n\n`;
    msg += `📋 *ORDER ITEMS (${itemsToSend.length}):*\n`;

    itemsToSend.forEach((item, idx) => {
      const packStr = item.packaging ? ` [${item.packaging}]` : '';
      const priceStr = item.ptr > 0 ? ` @ ₹${item.ptr}` : '';
      msg += `${idx + 1}. *${item.productName}*${packStr}\n   📦 Quantity: *${item.qty}*${priceStr}\n`;
    });

    msg += `\n🚚 *Assigned Delivery Person:*\n`;
    msg += `  👤 *${boyName}*\n  📞 *${boyPhone || 'N/A'}*\n\n`;

    msg += `📝 *Note:* Please send invoice bill (${fileFormat}) to ${email}.`;

    return msg;
  };

  const handleSaveQuickDeliveryBoy = async () => {
    if (!quickBoyName.trim()) {
      toastEvent.trigger('Delivery boy name is required.', 'error');
      return;
    }
    const cleanPhone = sanitizePhoneInput(quickBoyPhone);
    if (!isValid10DigitPhone(cleanPhone)) {
      toastEvent.trigger('Please enter a valid 10-digit WhatsApp phone number.', 'error');
      return;
    }

    setIsSavingQuickBoy(true);
    try {
      await apiClient.post('/dispatch/delivery-boys', {
        name: quickBoyName.trim(),
        whatsapp_number: cleanPhone,
        is_active: 1
      });
      try {
        await api.saveContact({
          name: quickBoyName.trim(),
          type: 'distributor_delivery',
          phone: cleanPhone
        });
      } catch (_) {}
      toastEvent.trigger(`Added delivery boy "${quickBoyName.trim()}"!`, 'success');
      setShowMissingBoyModal(false);
      const distTarget = pendingTargetDistributor;
      setQuickBoyName('');
      setQuickBoyPhone('');
      await broadcastContactDataChanged();
      await loadContactData();

      if (distTarget === 'ALL') {
        handleSendAllWhatsAppOrders(true);
      } else if (distTarget && typeof distTarget === 'object') {
        handleSendWhatsAppOrder(distTarget, true);
      }
    } catch (err: any) {
      console.error('Failed to add delivery boy:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to save delivery boy.', 'error');
    } finally {
      setIsSavingQuickBoy(false);
    }
  };

  const handleSkipMissingBoyAndUseAdmin = () => {
    setShowMissingBoyModal(false);
    toastEvent.trigger('Using Admin Contact as delivery boy fallback for order.', 'info');
    const distTarget = pendingTargetDistributor;
    if (distTarget === 'ALL') {
      handleSendAllWhatsAppOrders(true);
    } else if (distTarget) {
      handleSendWhatsAppOrder(distTarget, true);
    }
  };

  const handleSendWhatsAppOrder = async (
    dist: Distributor,
    bypassMissingBoyCheck = false,
    forceResend = false,
    targetMode: 'distributor_only' | 'both' = 'both'
  ) => {
    if (!hasPharmacySettings()) {
      toastEvent.trigger('Pharmacy Name and Contact Phone are required in Settings before sending orders.', 'error');
      navigate('/settings?missing=pharmacy_details');
      return;
    }

    if (!bypassMissingBoyCheck && targetMode === 'both' && !hasDeliveryBoyContacts()) {
      setPendingTargetDistributor(dist);
      setShowMissingBoyModal(true);
      return;
    }

    const itemsToOrder = dist.items.filter(item => isItemIncludedInDispatch(item, dist));

    if (itemsToOrder.length === 0) {
      toastEvent.trigger(`No items selected for ${dist.storeName}. Please check at least 1 item to send.`, 'info');
      return;
    }

    let phoneNum = getDistributorPhoneNumber(dist);

    let cleanPhone = phoneNum.replace(/\D/g, '');
    if (!cleanPhone || !isValidPhoneNumber(cleanPhone)) {
      setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'error' }));
      toastEvent.trigger(`Invalid phone number "${phoneNum || 'missing'}" for ${dist.storeName}. Please enter a valid 10-digit number.`, 'error');
      handleOpenEditModal(dist);
      return;
    }

    if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    }

    const msg = buildDistributorOrderMessage(dist);

    setSendingWaDistributorId(dist.storeId);
    try {
      // 1. Send silently via backend API (100% background delivery, no popups)
      const res = await apiClient.post('/messaging/send', {
        number: cleanPhone,
        message: msg,
        target_name: dist.storeName
      });

      if (res?.status === 202 || res?.data?.queued) {
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'queued' }));
        toastEvent.trigger(`WhatsApp order queued for background delivery (${dist.storeName})`, 'info');
      } else if (res?.data?.success) {
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
        setLastSentWaTimeMap(prev => {
          const next = { ...prev, [dist.storeId]: timeNow };
          try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) {}
          return next;
        });
        toastEvent.trigger(
          forceResend
            ? `Resent WhatsApp order to ${dist.storeName}${targetMode === 'both' ? ' & Delivery Boy' : ' (Distributor Only)'}!`
            : `WhatsApp order sent and verified for ${dist.storeName}!`,
          'success'
        );
      } else {
        throw new Error(res?.data?.error || 'Silent send failed');
      }

      // Also trigger backend notification to Delivery Boys ONLY if targetMode is 'both'
      if (targetMode === 'both') {
        try {
          await apiClient.post('/pharmarack/cart/notify-manual', {
            storeId: dist.storeId,
            storeName: dist.storeName,
            deliveryPersons: dist.deliveryPersons,
            items: itemsToOrder
          });
        } catch (distErr) {
          console.warn('Could not notify delivery boys via backend route:', distErr);
        }
      }

      // Log placed order to DB history
      try {
        const itemsToLog = itemsToOrder;
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: itemsToLog,
          delivery_persons: dist.deliveryPersons
        });
        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        await fetchPendingOrders();
        await fetchLatestSentMap();
        await loadSentDates();
      } catch (logErr) {
        console.warn('Could not log placed order:', logErr);
      }
    } catch (err: any) {
      console.warn('Silent WhatsApp send fallback to Web tab:', err);

      // Copy order message to clipboard for instant manual paste if needed
      try {
        await navigator.clipboard.writeText(msg);
      } catch (_) {}

      // Fallback: open/reuse WhatsApp Web tab with pre-filled order message
      const encodedMsg = encodeURIComponent(msg);
      const waWebUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
      openOrReuseWhatsappTab(waWebUrl, cleanPhone, msg);
      
      const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      setLastSentWaTimeMap(prev => {
        const next = { ...prev, [dist.storeId]: timeNow };
        try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) {}
        return next;
      });

      toastEvent.trigger(`Opened WhatsApp Web for ${dist.storeName}! (Order message pre-filled)`, 'success');

      // Log placed order to DB history on tab fallback
      try {
        const freshItems = dist.items.filter(item => !isItemAlreadySent(item, dist));
        const itemsToLog = freshItems.length > 0 ? freshItems : dist.items;
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: itemsToLog,
          delivery_persons: dist.deliveryPersons
        });
        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        await fetchPendingOrders();
        await fetchLatestSentMap();
        await loadSentDates();
      } catch (logErr) {
        console.warn('Could not log placed order:', logErr);
      }
    } finally {
      setSendingWaDistributorId(null);
    }
  };

  const handleSendAllWhatsAppOrders = async (bypassMissingBoyCheck = false) => {
    if (isSendingBatchRef.current) {
      toastEvent.trigger('A WhatsApp batch send is already in progress.', 'info');
      return;
    }

    if (!hasPharmacySettings()) {
      toastEvent.trigger('Pharmacy Name and Contact Phone are required in Settings before sending orders.', 'error');
      navigate('/settings?missing=pharmacy_details');
      return;
    }

    if (!bypassMissingBoyCheck && !hasDeliveryBoyContacts()) {
      setPendingTargetDistributor('ALL');
      setShowMissingBoyModal(true);
      return;
    }

    const mapped = distributors.filter(d => isDistributorMapped(d));
    const unmapped = distributors.filter(d => !isDistributorMapped(d));

    if (distributors.length === 0) {
      toastEvent.trigger('Your cart is empty.', 'error');
      return;
    }

    if (mapped.length === 0) {
      toastEvent.trigger('No distributor phone numbers linked. Please add phone numbers.', 'info');
      if (unmapped.length > 0) handleOpenEditModal(unmapped[0]);
      return;
    }

    isSendingBatchRef.current = true;
    setIsSendingBatchWhatsApp(true);

    try {
      // Resolve primary delivery boy FIRST — re-fetch live to avoid stale React state closure
      let liveBoys = deliveryBoysList;
      if (liveBoys.length === 0) {
        try {
          const freshRes = await apiClient.get('/dispatch/delivery-boys');
          if (Array.isArray(freshRes.data)) {
            liveBoys = freshRes.data.filter((b: any) => b.is_active !== 0);
            setDeliveryBoysList(liveBoys);
          }
        } catch (_) {}
      }
      const primaryBoy = liveBoys.find(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0);
      const deliveryBoyPhone = primaryBoy?.whatsapp_number || storeInfo.deliveryBoyPhone || storeInfo.adminPhone || '';
      const deliveryBoyName = primaryBoy?.name || 'Delivery Staff';

      const ordersPayload: { storeName: string; storeId: number; phone: string; message: string; lineTotal?: number; items: any[] }[] = [];

      for (const dist of mapped) {
        const itemsForBatch = dist.items.filter(item => isItemIncludedInDispatch(item, dist));
        if (itemsForBatch.length === 0) {
          toastEvent.trigger(`Skipped ${dist.storeName}: No items selected.`, 'info');
          continue;
        }

        let phoneNum = getDistributorPhoneNumber(dist);
        let cleanPhone = phoneNum.replace(/\D/g, '');
        if (!cleanPhone || !isValidPhoneNumber(cleanPhone)) {
          setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'error' }));
          toastEvent.trigger(`Skipped ${dist.storeName}: Invalid phone number "${phoneNum || 'missing'}"`, 'error');
          continue;
        }

        if (cleanPhone.length === 10) {
          cleanPhone = `91${cleanPhone}`;
        }

        const msg = buildDistributorOrderMessage(dist, primaryBoy ?? null);
        ordersPayload.push({
          storeName: dist.storeName,
          storeId: dist.storeId,
          phone: cleanPhone,
          message: msg,
          lineTotal: itemsForBatch.reduce((sum, item) => sum + (item.ptr > 0 ? item.ptr * item.qty : item.amount), 0),
          items: itemsForBatch
        });
      }

      if (ordersPayload.length === 0) {
        toastEvent.trigger('No valid distributor phone numbers found to enqueue.', 'error');
        return;
      }

      // ENQUEUE ALL MESSAGES INSTANTLY TO BACKGROUND QUEUE WORKER
      messageSendEvent.triggerSendProgress('Pharmarack Batch Orders', `Batch dispatch for ${ordersPayload.length} stores...`, 10);
      const res = await api.enqueuePharmarackBatch({
        orders: ordersPayload,
        deliveryBoyPhone,
        deliveryBoyName
      });

      if (res && res.success) {
        const batchTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastBatchSentTime(batchTimeStr);
        try { localStorage.setItem('pharmarack_last_batch_sent_time', batchTimeStr); } catch (_) {}

        // Mark all mapped distributors as queued in local status map
        const statusUpdates: Record<number, 'queued'> = {};
        mapped.forEach(d => {
          statusUpdates[d.storeId] = 'queued';
        });

        setSentWaStatusMap(prev => ({ ...prev, ...statusUpdates }));

        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        whatsappQueueEvent.triggerOpen();
        whatsappQueueEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        await fetchPendingOrders();
        await fetchLatestSentMap();
        await loadSentDates();

        toastEvent.trigger(
          `⚡ WhatsApp Queue started in background! Enqueued 1 Delivery Boy + ${ordersPayload.length} Distributor orders. Dispatching automatically!`,
          'info'
        );
      } else {
        throw new Error(res?.message || 'Failed to enqueue WhatsApp batch orders');
      }

      if (unmapped.length > 0) {
        toastEvent.trigger(`${unmapped.length} distributor(s) missing WhatsApp numbers. Please add phone numbers.`, 'info');
      }
    } catch (err: any) {
      console.warn('Batch WhatsApp send error:', err);
      toastEvent.trigger(err?.message || 'Failed to send WhatsApp orders automatically.', 'error');

      // Fallback: If background queue or backend service is unavailable, offer browser WhatsApp Web tabs for mapped distributors
      try {
        const mapped = distributors.filter(d => isDistributorMapped(d));
        if (mapped.length > 0 && window.confirm('Automated background WhatsApp service is currently unavailable. Would you like to open WhatsApp Web tabs to send these orders directly in your browser?')) {
          mapped.forEach((dist, idx) => {
            setTimeout(() => {
              let phoneNum = getDistributorPhoneNumber(dist);
              let cleanPhone = phoneNum.replace(/\D/g, '');
              if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
              const msg = buildDistributorOrderMessage(dist);
              openOrReuseWhatsappTab('', cleanPhone, msg);
              setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
            }, idx * 1500);
          });
        }
      } catch (tabErr) {
        console.warn('Tab fallback error:', tabErr);
      }
    } finally {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
    }
  };

  const handleOpenEditModal = (dist: Distributor) => {
    setEditingDistributor(dist);
    setIsSavingContact(false);
    setModalSearchTerm(dist.storeName || '');
    setIsAddingNewDistributor(false);
    setNewDistNameInput(dist.storeName || '');

    const normName = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
    const storedMap = distributorMappings[normName];

    if (storedMap && storedMap.distributorId) {
      setSelectedSavedDistId(storedMap.distributorId);
      setModalPhoneInput(storedMap.phone || '');
    } else {
      const custom = customDistributorPhones[dist.storeId];
      const matched = findSavedDistributorMatch(dist.storeName);

      if (custom) {
        setModalPhoneInput(custom);
        setSelectedSavedDistId(matched?.id || null);
      } else if (matched?.phone || matched?.mobile || matched?.whatsapp) {
        setModalPhoneInput(matched.phone || matched.mobile || matched.whatsapp || '');
        setSelectedSavedDistId(matched.id);
      } else {
        setModalPhoneInput('');
        setSelectedSavedDistId(null);
      }
    }
  };

  const handleSaveDistributorContact = async () => {
    if (!editingDistributor || isSavingContact) return;
    setIsSavingContact(true);
    const cleanPhone = modalPhoneInput.trim();
    const storeId = editingDistributor.storeId;
    const distName = editingDistributor.storeName;

    // 1. Immediately update UI state & close modal for instant zero-latency feedback
    setCustomDistributorPhones(prev => ({
      ...prev,
      [storeId]: cleanPhone
    }));
    if (distName) {
      const normName = distName.toLowerCase().trim();
      setDistributorMappings(prev => ({
        ...prev,
        [normName]: {
          distributorId: selectedSavedDistId,
          phone: cleanPhone
        }
      }));
    }
    toastEvent.trigger(`Saved WhatsApp contact for ${distName}`, 'success');
    setEditingDistributor(null);
    setIsSavingContact(false);

    // 2. Persist to database in background
    try {
      let targetDistId = selectedSavedDistId;

      if (isAddingNewDistributor && newDistNameInput.trim()) {
        // User clicked '+' to create a brand new distributor in AI Learning DB
        const createRes = await apiClient.post('/distributors', {
          name: newDistNameInput.trim(),
          phone: cleanPhone
        });
        if (createRes.data && createRes.data.id) {
          targetDistId = createRes.data.id;
        }
      } else if (selectedSavedDistId) {
        // Updating an existing selected distributor from directory
        const foundSaved = savedDistributorsList.find((d: any) => d.id === selectedSavedDistId);
        try {
          const updateRes = await apiClient.put(`/distributors/${selectedSavedDistId}`, {
            name: foundSaved?.name || distName,
            phone: cleanPhone
          });
          if (updateRes.data && updateRes.data.id) {
            targetDistId = updateRes.data.id;
          }
        } catch (e) {
          console.warn('PUT distributor by ID failed, falling back to post upsert:', e);
          const fallbackRes = await apiClient.post('/distributors', {
            name: foundSaved?.name || distName,
            phone: cleanPhone
          });
          if (fallbackRes.data && fallbackRes.data.id) {
            targetDistId = fallbackRes.data.id;
          }
        }
      } else if (cleanPhone) {
        // Direct mobile number without directory selection -> create/upsert distributor for this store
        const createRes = await apiClient.post('/distributors', {
          name: distName,
          phone: cleanPhone
        });
        if (createRes.data && createRes.data.id) {
          targetDistId = createRes.data.id;
        }
      }

      // Save persistent store-to-distributor mapping in SQLite
      if (distName) {
        await apiClient.post('/pharmarack/distributor-mappings', {
          store_name: distName,
          distributor_id: targetDistId || null,
          phone: cleanPhone
        });
      }

      // Save to unified contacts master table
      try {
        await api.saveContact({
          name: isAddingNewDistributor && newDistNameInput.trim() ? newDistNameInput.trim() : distName,
          type: 'distributor',
          phone: cleanPhone
        });
      } catch (_) {}

      await broadcastContactDataChanged();
    } catch (err: any) {
      console.warn('Background save distributor contact error:', err);
    } finally {
      setIsSavingContact(false);
    }
  };

  const fetchPriceHistories = async (currDistributors: Distributor[]) => {
    const uniqueNames = Array.from(
      new Set(currDistributors.flatMap(d => d.items.map(it => it.productName)))
    ).filter(Boolean);

    setPriceHistoryCache(prevCache => {
      const namesToFetch = uniqueNames.filter(name => !prevCache[name]);
      if (namesToFetch.length > 0) {
        // Firing one request per unique cart item at once can burst into 15-20+ parallel
        // calls; each is a potentially expensive fuzzy-match lookup on the backend, and
        // piling them up on Node's single thread stalls the whole app, not just this page.
        // Throttle to a small concurrency window instead of Promise.all-ing everything.
        const CONCURRENCY = 4;
        const results: Array<{ name: string; data: any[] }> = [];
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < namesToFetch.length) {
            const name = namesToFetch[nextIndex++];
            try {
              const res = await api.getMedicinePriceHistory(name);
              results.push({ name, data: res?.data || [] });
            } catch (e) {
              results.push({ name, data: [] });
            }
          }
        };
        Promise.all(Array.from({ length: Math.min(CONCURRENCY, namesToFetch.length) }, worker)).then(() => {
          setPriceHistoryCache(current => {
            const next = { ...current };
            results.forEach(r => {
              next[r.name] = r.data;
            });
            cachedPriceHistory = next;
            return next;
          });
        });
      }
      return prevCache;
    });
  };

  const getDuplicateItemInCart = (currentItem: CartLineItem) => {
    const normName = currentItem.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of distributors) {
      if (dist.storeId === currentItem.storeId) continue;
      for (const it of dist.items) {
        const itNormName = it.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normName === itNormName && Math.abs(currentItem.mrp - it.mrp) < 0.01) {
          return {
            storeName: dist.storeName,
            qty: it.qty
          };
        }
      }
    }
    return null;
  };

  const normalizeItemsWithCheckStatus = (
    rawList: Distributor[],
    overrides: Record<string, boolean> = userCheckOverridesRef.current
  ): Distributor[] => {
    return rawList.map(dist => {
      const updatedItems = (dist.items || []).map(item => {
        const key = getItemCheckKey(dist.storeId, item);
        // 1. User manual override has highest priority!
        if (typeof overrides[key] === 'boolean') {
          return { ...item, isChecked: overrides[key] };
        }

        // 2. Default logic:
        const pastInfo = getPastOrderedInfo(item, dist);
        // Default to false (unchecked) if ordered yesterday or earlier
        // Default to true (checked) if fresh item or ordered today
        const defaultChecked = !(pastInfo.isPastOrdered && !pastInfo.isToday);
        return {
          ...item,
          isChecked: defaultChecked
        };
      });

      return {
        ...dist,
        items: updatedItems
      };
    });
  };

  const fetchCart = async () => {
    // Only show loading spinner on cold cache (first visit)
    if (cachedDistributors.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        const rawList = data.distributors || [];
        const list = normalizeItemsWithCheckStatus(rawList, userCheckOverridesRef.current);
        setDistributors(list);
        cachedDistributors = list;
        const now = new Date();
        setLastFetched(now);
        cachedLastFetched = now;
        fetchPriceHistories(list);
        fetchLatestSentMap();
      } else {
        setError('Failed to retrieve cart details.');
      }
    } catch (err: any) {
      console.error('Failed to fetch Pharmarack cart:', err);
      setError(err?.response?.data?.error || 'Failed to fetch cart. Please check server logs or verify your session.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchCart();
      await new Promise(r => setTimeout(r, 600));
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchCartSilent = async () => {
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        const rawList = data.distributors || [];
        const list = normalizeItemsWithCheckStatus(rawList, userCheckOverridesRef.current);
        setDistributors(list);
        cachedDistributors = list;
        const now = new Date();
        setLastFetched(now);
        cachedLastFetched = now;
        fetchPriceHistories(list);
      }
    } catch (err) {
      console.error('Failed silent cart refresh:', err);
    }
  };

  const handleUpdateQty = async (item: CartLineItem, newQty: number) => {
    if (newQty < 1) {
      handleDeleteItem(item);
      return;
    }

    // 1. Optimistic UI Update (< 5ms perception, instant response)
    setDistributors(prev => {
      const updated = prev.map(dist => {
        if (dist.storeId !== item.storeId) return dist;

        const updatedItems = dist.items.map(i => {
          if (i.productCode !== item.productCode) return i;
          const rateVal = i.ptr || 0;
          return {
            ...i,
            qty: newQty,
            amount: rateVal * newQty
          };
        });

        return {
          ...dist,
          items: updatedItems,
          lineTotal: updatedItems.reduce((sum, it) => sum + it.amount, 0)
        };
      });
      cachedDistributors = updated;
      return updated;
    });

    setUpdatingItemId(item.productCode);

    // 2. Silent Background API Sync (Debounced, never locks screen with loading spinners)
    try {
      const storeName = distributors.find(d => d.storeId === item.storeId)?.storeName || '';
      const payload = [{
        productId: item.productId || 0,
        storeId: item.storeId,
        qty: newQty,
        productCode: item.productCode,
        productName: item.productName,
        company: item.company,
        packaging: item.packaging,
        rate: item.ptr,
        mrp: item.mrp,
        storeName: storeName,
        mapped: true
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger('Quantity updated in Pharmarack live cart', 'success');
        // Silent delayed refresh to align with Pharmarack server indexing without page reload
        setTimeout(() => { fetchCartSilent(); }, 1500);
      } else {
        toastEvent.trigger(res?.error || 'Failed to update quantity on Pharmarack', 'error');
        await fetchCartSilent(); // Silent sync on error without full-screen loading spinner
      }
    } catch (err: any) {
      console.error('Failed to update quantity:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to update quantity', 'error');
      await fetchCartSilent(); // Silent sync on error without full-screen loading spinner
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleDeleteItem = async (item: CartLineItem) => {
    // 1. Optimistic UI update (immediately remove item from UI state & update totals in < 5ms)
    setDistributors(prev => {
      const updated = prev.map(dist => {
        if (dist.storeId !== item.storeId) return dist;
        const remainingItems = dist.items.filter(i => 
          (item.productCode && i.productCode === item.productCode) 
            ? false 
            : (item.productId && i.productId === item.productId)
              ? false 
              : i.productName !== item.productName
        );
        const newLineTotal = remainingItems.reduce((sum, it) => sum + it.amount, 0);
        return {
          ...dist,
          items: remainingItems,
          lineTotal: newLineTotal
        };
      }).filter(dist => dist.items.length > 0);

      cachedDistributors = updated;
      return updated;
    });

    const itemKey = item.productCode || String(item.productId || item.productName);
    setUpdatingItemId(itemKey);
    toastEvent.trigger(`Removing "${item.productName}"...`, 'info');

    // 2. Silent Background Live Cart Deletion
    try {
      const storeName = distributors.find(d => d.storeId === item.storeId)?.storeName || '';
      const res = await api.deletePharmarackCartItem({
        storeId: item.storeId,
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        company: item.company,
        packaging: item.packaging,
        ptr: item.ptr,
        mrp: item.mrp,
        storeName: storeName
      });

      if (res && res.success) {
        toastEvent.trigger(`Removed "${item.productName}" from live cart`, 'success');
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        setTimeout(() => { fetchCartSilent(); }, 1500);
      } else {
        toastEvent.trigger(res?.error || 'Failed to delete item from live cart', 'error');
        await fetchCartSilent(); // Silent sync on error without full-screen loading spinner
      }
    } catch (err: any) {
      console.error('Failed to delete Pharmarack cart item:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to delete item from live cart', 'error');
      await fetchCartSilent(); // Silent sync on error without full-screen loading spinner
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleTransferSentItemToUnsent = (dist: Distributor, item: CartLineItem) => {
    const key = getItemCheckKey(dist.storeId, item);
    setUserCheckOverrides(prev => {
      const next = { ...prev, [key]: true };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });

    setSentWaStatusMap(prev => {
      const next = { ...prev };
      delete next[dist.storeId];
      return next;
    });

    setDistributorFilterTab('unsent');
    toastEvent.trigger(`✅ Transferred "${item.productName}" to Unsent Cart Orders!`, 'success');
  };

  const handleReaddSingleSentItem = async (item: any, storeId?: number, storeName?: string) => {
    const medName = item.productName || item.product || item.name || '';
    const qty = item.qty || item.quantity || 1;

    if (!medName) {
      toastEvent.trigger('Invalid medicine details.', 'error');
      return;
    }

    setReaddingSentItems(true);
    try {
      const payload = [{
        productId: item.productId || 0,
        storeId: storeId || item.storeId || 0,
        qty: qty,
        productCode: item.productCode || '',
        productName: medName,
        company: item.company || '',
        packaging: item.packaging || item.Packing || '',
        rate: item.ptr || item.rate || 0,
        mrp: item.mrp || 0,
        storeName: storeName || item.storeName || '',
        mapped: true
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        const targetStoreId = storeId || item.storeId || 0;
        if (targetStoreId) {
          setSentWaStatusMap(prev => {
            const next = { ...prev };
            delete next[targetStoreId];
            return next;
          });
        }
        const key = getItemCheckKey(targetStoreId, { productCode: item.productCode, productId: item.productId, productName: medName });
        setUserCheckOverrides(prev => {
          const next = { ...prev, [key]: true };
          userCheckOverridesRef.current = next;
          saveUserCheckOverrides(next);
          return next;
        });

        cachedDistributors = [];
        await fetchCart();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));

        toastEvent.trigger(`✅ Transferred "${medName}" (x${qty}) to Unsent Cart Orders!`, 'success');
        
        // Auto-switch to Pharmarack Cart tab and 'unsent' filter
        setDistributorFilterTab('unsent');
        setSearchParams({ tab: 'cart' });
        return;
      } else {
        throw new Error(res?.error || 'Failed to add to cart');
      }
    } catch (err: any) {
      console.warn('Direct cart add failed, opening Live Cart search modal:', err);
      toastEvent.trigger(`Opening Live Cart search for "${medName}"...`, 'info');
      liveCartAddEvent.triggerOpen(medName, qty);
    } finally {
      setReaddingSentItems(false);
    }
  };

  // ponytail: stagger initial mount fetches — the live cart (plus its "already sent" badge
  // map) is the primary visible data, so it loads immediately. Pending special orders/refills
  // load shortly after, and sales reorder suggestions (lowest priority, sidebar-only) load last.
  // This 3-tier order (cart -> pending -> suggestions) avoids saturating the network with 5+
  // parallel requests on mount and gets the cart interactive sooner.
  const [showPendingTier, setShowPendingTier] = useState(false);
  const [showSuggestionsTier, setShowSuggestionsTier] = useState(false);

  useEffect(() => {
    fetchCart();
    fetchLatestSentMap();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowPendingTier(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowSuggestionsTier(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showPendingTier) return;
    fetchPendingOrders();
    fetchPendingRefills();
  }, [showPendingTier]);

  useEffect(() => {
    if (!showSuggestionsTier) return;
    fetchReorderSuggestions();
  }, [showSuggestionsTier]);

  // Re-fetch pending special orders whenever any page creates/updates an order.
  // This clears the module-level cache so stale data is never shown.
  useEffect(() => {
    const unsub = specialOrdersEvent.subscribeUpdated(() => {
      cachedPendingOrders = [];
      fetchPendingOrders();
    });
    return unsub;
  }, []);

  // Listen to cross-page refresh events fired by QuickOrderModal, LiveCartAddModal, login/OTP completion, etc.
  // 'refresh-pharmarack-cart'    → re-fetch cart so newly-added items appear immediately
  // 'pharmarack-auth-changed'     → re-fetch cart as soon as user enters OTP / session token updates
  // 'pharmarack-session-updated'  → re-fetch cart on session renewal
  // 'refresh-special-orders'     → re-fetch pending orders so the left sidebar count is up-to-date
  useEffect(() => {
    const handleCartRefresh = () => {
      cachedDistributors = [];
      fetchCart();
      fetchLatestSentMap();
    };
    const handleOrdersRefresh = () => {
      cachedPendingOrders = [];
      fetchPendingOrders();
    };
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchCartSilent();
      }
    };
    window.addEventListener('refresh-pharmarack-cart', handleCartRefresh);
    window.addEventListener('pharmarack-auth-changed', handleCartRefresh);
    window.addEventListener('pharmarack-session-updated', handleCartRefresh);
    window.addEventListener('refresh-special-orders', handleOrdersRefresh);
    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    return () => {
      window.removeEventListener('refresh-pharmarack-cart', handleCartRefresh);
      window.removeEventListener('pharmarack-auth-changed', handleCartRefresh);
      window.removeEventListener('pharmarack-session-updated', handleCartRefresh);
      window.removeEventListener('refresh-special-orders', handleOrdersRefresh);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
    };
  }, []);


  const [hasUnreadSentHistory, setHasUnreadSentHistory] = useState<boolean>(false);

  useEffect(() => {
    if (currentTab === 'sent-history') {
      setHasUnreadSentHistory(false);
    }
  }, [currentTab]);

  const totalProducts = distributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = distributors.reduce((s, d) => s + d.items.reduce((q, i) => q + (i.qty || 1), 0), 0);
  const totalAmount = distributors.reduce((s, d) => s + d.items.reduce((a, i) => a + getCartItemAmount(i), 0), 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg text-text gap-1 p-1.5 sm:p-2 pb-2 relative w-full h-full">
      {/* Top Integrated Scheduler & Navigation Bar */}
      <PharmarackCartCalendar
        currentTab={currentTab}
        onTabChange={(tab) => {
          setSearchParams({ tab });
          if (tab === 'sent-history') setHasUnreadSentHistory(false);
        }}
        hasUnreadSentHistory={hasUnreadSentHistory}
      />

      {currentTab === 'non-mapped' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-glass-bg border border-glass-border rounded-3xl p-6">
          <NonMappedDistributors />
        </div>
      ) : currentTab === 'sent-history' ? (
        /* ── Split-Pane Sent Orders History Master-Detail View ── */
        <div className="flex-1 flex overflow-hidden bg-glass-bg border border-glass-border rounded-3xl min-h-0">
          
          {/* Left Master Sidebar: Historical Order Dates */}
          <div className="w-72 md:w-80 shrink-0 border-r border-glass-border/40 flex flex-col bg-bg2/30 overflow-hidden">
            <div className="p-4 border-b border-glass-border/40 flex items-center justify-between shrink-0 bg-bg2/50">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-text">History Dates</h4>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                {sentDates.length} Days
              </span>
            </div>

            {/* Dates List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {sentDates.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted italic">
                  No historical dates found
                </div>
              ) : (
                sentDates.map(d => {
                  const isToday = d === new Date().toISOString().split('T')[0];
                  const isSelected = d === selectedSentDate;
                  const dateObj = new Date(d);
                  const formattedDisplay = isNaN(dateObj.getTime())
                    ? d
                    : dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });

                  return (
                    <button
                      key={d}
                      onClick={() => setSelectedSentDate(d)}
                      className={`w-full text-left p-3 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2 border ${
                        isSelected
                          ? 'bg-primary/15 border-primary/40 text-text shadow-md shadow-primary/5'
                          : 'bg-white/[0.02] border-glass-border/30 text-muted hover:text-text hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Clock size={14} className={isSelected ? "text-primary shrink-0" : "text-muted/60 shrink-0"} />
                        <div className="min-w-0">
                          <div className={`text-xs font-bold truncate ${isSelected ? 'text-text' : 'text-text/80'}`}>
                            {formattedDisplay}
                          </div>
                          <div className="text-[9px] text-muted font-mono">{d}</div>
                        </div>
                      </div>
                      {isToday && (
                        <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                          Today
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Detail Panel: Sent Orders for Selected Date */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-5 min-h-0 bg-glass-bg/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-glass-border/40 pb-4 shrink-0">
              <div>
                <h3 className="text-base font-bold text-text uppercase tracking-wide flex items-center gap-2">
                  <Send size={18} className="text-primary" />
                  Sent Orders: {selectedSentDate ? (isNaN(new Date(selectedSentDate).getTime()) ? selectedSentDate : new Date(selectedSentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })) : 'Select Date'}
                </h3>
                <p className="text-xs text-muted mt-1">
                  Distributor orders dispatched on {selectedSentDate}
                </p>
              </div>

              {selectedSentDate && (
                <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/5 border border-glass-border text-text font-mono shrink-0">
                  {sentOrders.length} Order{sentOrders.length !== 1 ? 's' : ''} Sent
                </span>
              )}
            </div>

            {/* Orders Grid / Cards */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
              {sentOrdersLoading ? (
                <div className="text-center py-16 text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                  Loading sent order history for {selectedSentDate}…
                </div>
              ) : sentOrders.length === 0 ? (
                <div className="text-center py-20 text-xs text-muted italic select-none">
                  No order dispatches found for date {selectedSentDate || 'selected'}.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {sentOrders.map((order: any) => (
                    <div key={order.id} className="p-4 rounded-2xl border border-glass-border/60 bg-bg/40 flex flex-col justify-between gap-3 shadow-md hover:border-glass-border transition-all">
                      <div>
                        <div className="flex items-center justify-between pb-2 border-b border-glass-border/30">
                          <span className="text-sm font-extrabold text-text truncate" title={order.store_name}>
                            {order.store_name}
                          </span>
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${order.batch_sent ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                            {order.batch_sent ? '● Sent' : '○ Pending'}
                          </span>
                        </div>

                        {/* Items List */}
                        <div className="space-y-2 mt-3">
                          {Array.isArray(order.items) && order.items.map((item: any, idx: number) => {
                            const medName = item.productName || item.product || item.name;
                            const itemQty = item.qty || item.quantity || 1;

                            return (
                              <div key={idx} className="flex justify-between items-center text-xs text-text bg-bg2/40 p-2.5 rounded-xl border border-glass-border/30 hover:border-glass-border transition-all">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => handleReaddSingleSentItem(item, order.store_id, order.store_name)}
                                    disabled={readdingSentItems}
                                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500 shadow-sm shrink-0 disabled:opacity-50"
                                    title="Click checkbox to transfer this medicine directly to Unsent Cart Orders"
                                  />
                                  <span className="truncate font-semibold text-text" title={medName}>{medName}</span>
                                  <span className="font-mono font-extrabold text-primary shrink-0">x{itemQty}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => handleReaddSingleSentItem(item, order.store_id, order.store_name)}
                                    disabled={readdingSentItems}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 text-[10px] font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-50 shadow-sm"
                                    title="Transfer this medicine to Unsent Cart Orders"
                                  >
                                    <Plus size={11} /> Re-add
                                  </button>
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen(medName, itemQty)}
                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-glass-border text-muted hover:text-text text-[10px] font-bold transition-all active:scale-95 cursor-pointer"
                                    title="Search across all available distributors in Live Cart Add modal"
                                  >
                                    <Search size={11} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="flex items-center justify-between mt-2 text-[10px] text-muted pt-2 border-t border-glass-border/20">
                        <span className="font-mono">
                          Sent at: {order.placed_at ? new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                        </span>
                        <span className="text-[9px] font-mono font-bold text-muted/70 uppercase">
                          {Array.isArray(order.items) ? order.items.length : 0} Item{Array.isArray(order.items) && order.items.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden bg-glass-bg border border-glass-border rounded-3xl min-h-0">
          {/* ── Top Header ── */}
          <div className="h-16 border-b border-glass-border/40 px-6 flex items-center justify-between shrink-0 bg-glass-bg/10 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <ShoppingCart size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text tracking-wide uppercase leading-none flex items-center gap-2">
                  Pharmarack Cart
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    ● LIVE
                  </span>
                </h3>
                <p className="text-[10px] text-muted tracking-wider mt-1">
                  {lastFetched
                    ? `Last synced ${lastFetched.toLocaleTimeString()}`
                    : 'Syncing with Pharmarack…'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleManualRefresh}
                disabled={loading || isRefreshing}
                className="group p-2 rounded-lg bg-bg2 border border-glass-border hover:border-emerald-500/40 hover:bg-emerald-500/10 text-muted hover:text-emerald-400 transition-all active:scale-90 flex items-center justify-center disabled:opacity-50 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)] cursor-pointer"
                title="Refresh Cart Contents"
              >
                <RotateCcw
                  size={14}
                  className={`transition-transform duration-500 ${isRefreshing || loading ? 'animate-spin text-emerald-400' : 'group-hover:-rotate-180 text-muted group-hover:text-emerald-400'}`}
                />
              </button>

              <button
                onClick={() => handleSendAllWhatsAppOrders()}
                disabled={isSendingBatchWhatsApp || distributors.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 font-extrabold transition-all active:scale-95 text-xs disabled:opacity-50 shadow-sm cursor-pointer"
                title="Send order messages silently to all saved distributor WhatsApp numbers with 30-45s safe delay"
              >
                {isSendingBatchWhatsApp ? (
                  <span className="w-3.5 h-3.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                ) : (
                  <MessageSquare size={13} />
                )}
                <span>
                  {isSendingBatchWhatsApp
                    ? 'Sending orders…'
                    : `Send All via WhatsApp (${readyToSendDistributors.length})`}
                </span>
              </button>

              {lastBatchSentTime && (
                <span className="text-[10px] text-emerald-400 font-extrabold px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-1 shrink-0">
                  <Clock size={11} className="text-emerald-400" />
                  Last Batch: {lastBatchSentTime}
                </span>
              )}

              <a
                href="https://retailers.pharmarack.com/cart"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg2 border border-glass-border text-muted hover:text-text hover:bg-bg3 transition-all text-xs font-bold active:scale-95"
                title="Open Cart on retailers.pharmarack.com"
              >
                <ExternalLink size={13} />
                <span>Open External</span>
              </a>
            </div>
          </div>

          {/* ── Main Area ── */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left Sidebar: Add Pending Order panel */}
            {!loading && !error && (
              <div className="w-80 border-r border-glass-border/40 bg-bg2/25 flex flex-col shrink-0 overflow-hidden">
                {/* Sidebar Tabs */}
                <div className="flex border-b border-glass-border/40 bg-bg3/10 shrink-0 select-none overflow-x-auto">
                  <button
                    onClick={() => setSidebarTab('all')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 min-w-[50px] ${sidebarTab === 'all'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                    title="View All Notifications & Items Combined"
                  >
                    <Layers size={11} />
                    All ({visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('requests')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 min-w-[50px] ${sidebarTab === 'requests'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <Clock size={11} />
                    Req ({visiblePendingOrders.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('refills')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 min-w-[55px] ${sidebarTab === 'refills'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <ShoppingCart size={11} />
                    Refills ({visiblePendingRefills.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('sales_suggestions')}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 min-w-[50px] ${sidebarTab === 'sales_suggestions'
                      ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                    title="2-Day Sales & 6-Month Average Reorder Suggestions"
                  >
                    <TrendingUp size={11} className="text-emerald-400" />
                    Sales ({reorderSuggestions.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('missing_phone' as any)}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 min-w-[55px] ${sidebarTab === ('missing_phone' as any)
                      ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <Phone size={11} />
                    Missing
                  </button>
                </div>

                {/* Auto-hide Cart Items Control Banner */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-bg3/30 border-b border-glass-border/40 text-[10px] text-muted shrink-0">
                  <span className="font-semibold text-muted">Auto-hiding items in Live Cart</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-text hover:text-primary">
                    <input
                      type="checkbox"
                      checked={showAddedItems}
                      onChange={e => setShowAddedItems(e.target.checked)}
                      className="rounded bg-bg border-glass-border text-primary focus:ring-0 w-3 h-3 cursor-pointer"
                    />
                    <span>Show Added ({pendingOrders.filter(o => getOrderItemInCart(o)).length + pendingRefills.filter(r => getRefillItemInCart(r)).length})</span>
                  </label>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(sidebarTab === 'all' || sidebarTab === 'requests') && (() => {
                    const displayOrders = visiblePendingOrders;

                    if (sidebarTab === 'requests' && displayOrders.length === 0) {
                      return (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          {pendingOrders.length > 0 && !showAddedItems
                            ? 'All special requests have been added to the Pharmarack cart!'
                            : 'No pending special requests found.'}
                        </div>
                      );
                    }

                    if (displayOrders.length === 0 && sidebarTab === 'all') return null;

                    return (
                      <div className="space-y-2">
                        {sidebarTab === 'all' && (
                          <div className="text-[10px] font-black uppercase text-primary tracking-wider px-1 pt-1 pb-1 border-b border-glass-border/30 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              Special Shortage Requests ({displayOrders.length})
                            </span>
                          </div>
                        )}
                        {displayOrders.map(order => {
                          const cartMatch = getOrderCartMatch(order);
                          const inCart = Boolean(cartMatch?.isHighMatch);
                          const isPartialMatch = Boolean(cartMatch?.isPartialMatch);
                          const candidateItem = cartMatch?.candidateItem;
                          const matchScore = cartMatch?.result?.score || 0;
                          const matchReasons = cartMatch?.result?.matchReasons || [];

                          const orderDateMs = new Date(order.date).getTime();
                          const hoursElapsed = !isNaN(orderDateMs) ? (Date.now() - orderDateMs) / (1000 * 60 * 60) : 0;
                          const isDelayedOver12h = hoursElapsed >= 12 && order.status !== 'Ready' && order.status !== 'Arrived' && order.status !== 'Fulfilled';

                          const handleConfirmOrdered = async () => {
                            try {
                              await api.updateOrder(order.id, { status: 'Ordered' });
                              toastEvent.trigger(`Confirmed & marked "${order.product}" as Ordered!`, 'success');
                              await fetchPendingOrders();
                            } catch (err: any) {
                              toastEvent.trigger('Failed to update status', 'error');
                            }
                          };

                          return (
                            <div
                              key={order.id}
                              className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${
                                isDelayedOver12h
                                  ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 shadow-amber-500/10 animate-pulse'
                                  : inCart
                                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400'
                                  : isPartialMatch
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                  : 'bg-red/10 border-red/20 text-red'
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <div 
                                  className="flex flex-col min-w-0 cursor-pointer group flex-1"
                                  onClick={() => liveCartAddEvent.triggerOpen(order.product, order.qty, order.id)}
                                  title="Click to search in Pharmarack and add to cart"
                                >
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[11px] font-bold truncate group-hover:underline ${inCart ? 'line-through opacity-65 text-emerald-400' : 'text-text'}`}>
                                      {order.product}
                                    </span>
                                    {isDelayedOver12h && (
                                      <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
                                        ⏰ {Math.floor(hoursElapsed)}h Shipment Delay
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[9px] text-muted mt-0.5 truncate">
                                    Customer: {order.requester} (Qty: {order.qty})
                                  </span>
                                  {inCart && matchReasons.length > 0 && (
                                    <span className="text-[8px] text-emerald-400/90 font-medium mt-0.5 truncate" title={matchReasons.join(', ')}>
                                      Match details: {matchReasons.join(' • ')}
                                    </span>
                                  )}
                                  <span className="text-[8px] text-muted/80 font-mono mt-0.2">
                                    Logged: {formatDisplayDate(order.date)}
                                  </span>

                                  {isDelayedOver12h && (
                                    <span className="text-[9px] font-bold text-amber-400 mt-1 flex items-center gap-1">
                                      ⚠️ Placed &gt;12h ago — Pending arrival in pharmacy inventory!
                                    </span>
                                  )}
                                  {order.cart_add_error && (
                                    <span
                                      className="text-[9px] font-semibold text-red mt-1 flex items-start gap-1"
                                      title={order.cart_add_error}
                                    >
                                      ⚠️ Last attempt failed: {order.cart_add_error}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                  {inCart ? (
                                    <>
                                      <span className="text-[8px] font-extrabold uppercase bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/30 text-emerald-400 select-none flex items-center gap-1">
                                        <span>✨ In Cart</span>
                                        <span className="opacity-75">({matchScore}%)</span>
                                      </span>
                                      {order.status === 'Pending' && (
                                        <button
                                          type="button"
                                          onClick={handleConfirmOrdered}
                                          className="text-[9px] font-bold bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 px-2 py-0.5 rounded transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                                          title="Double-check & confirm that this order is placed"
                                        >
                                          <Check size={10} />
                                          <span>Confirm Ordered</span>
                                        </button>
                                      )}
                                    </>
                                  ) : isPartialMatch && candidateItem ? (
                                    <>
                                      <span className="text-[8px] font-extrabold uppercase bg-amber-500/25 px-1.5 py-0.5 rounded-md border border-amber-500/30 text-amber-400 select-none flex items-center gap-1">
                                        <span>⚡ Possible Match</span>
                                        <span className="opacity-75">({matchScore}%)</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleConfirmCandidateMatch(order, candidateItem)}
                                        className="text-[9px] font-bold bg-white text-amber-600 border border-amber-500 hover:bg-amber-50 px-2 py-0.5 rounded transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                                        title={`Confirm "${candidateItem.productName || candidateItem.name}" in cart is this request`}
                                      >
                                        <Check size={10} />
                                        <span>Confirm Added</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => liveCartAddEvent.triggerOpen(order.product, order.qty, order.id)}
                                      className="text-[9px] font-bold bg-primary/20 hover:bg-primary/35 border border-primary/30 px-2 py-1 rounded-md transition-all active:scale-95 text-primary font-sans flex items-center gap-1 cursor-pointer"
                                      title="Open Medicine Search & Add to Pharmarack Live Cart"
                                    >
                                      <Search size={10} />
                                      <span>Search & Add</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Partial Candidate Match Banner */}
                              {isPartialMatch && candidateItem && (
                                <div className="mt-1 pt-1.5 border-t border-amber-500/20 text-[9px] text-amber-300/90 flex flex-col gap-0.5 bg-amber-500/5 p-1.5 rounded-lg">
                                  <div className="flex justify-between items-center font-semibold">
                                    <span className="truncate pr-1" title={candidateItem.productName || candidateItem.name}>
                                      Candidate: {candidateItem.productName || candidateItem.name}
                                    </span>
                                    {candidateItem.distributor && (
                                      <span className="text-[8px] bg-amber-500/20 px-1 py-0.2 rounded font-mono shrink-0">
                                        {candidateItem.distributor}
                                      </span>
                                    )}
                                  </div>
                                  {matchReasons.length > 0 && (
                                    <span className="text-[8px] text-amber-400/80 truncate">
                                      Match factors: {matchReasons.join(' • ')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {(sidebarTab === 'all' || sidebarTab === 'refills') && (() => {
                    const displayRefills = visiblePendingRefills;

                    if (sidebarTab === 'refills' && displayRefills.length === 0) {
                      return (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          {pendingRefills.length > 0 && !showAddedItems
                            ? 'All refill medicines have been added to the Pharmarack cart!'
                            : 'No pending out-of-stock refill medicines due.'}
                        </div>
                      );
                    }

                    if (displayRefills.length === 0 && sidebarTab === 'all') return null;

                    return (
                      <div className="space-y-2">
                        {sidebarTab === 'all' && (
                          <div className="text-[10px] font-black uppercase text-amber-400 tracking-wider px-1 pt-2 pb-1 border-b border-glass-border/30 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <ShoppingCart size={11} />
                              Chronic Patient Refills ({displayRefills.length})
                            </span>
                          </div>
                        )}
                        {displayRefills.map(refill => {
                          const inCart = getRefillItemInCart(refill);
                          const medName = refill.medicine_name || `Medicine ID: ${refill.medicine_id}`;
                          const reqQty = Number(refill.quantity_needed || 1);
                          const stockQty = Number(refill.in_stock_qty || 0);
                          const shortageQty = Math.max(1, reqQty - stockQty);

                          const today = new Date();
                          const dueDate = new Date(refill.next_refill_date);
                          const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                          const isLeadWindow = diffDays <= 6 && diffDays >= 0;

                          return (
                            <div
                              key={refill.id}
                              className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${inCart
                                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                }`}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div 
                                  className="flex flex-col min-w-0 cursor-pointer group flex-1"
                                  onClick={() => liveCartAddEvent.triggerOpen(medName, shortageQty, undefined, refill.id)}
                                  title="Click to search in Pharmarack and add to cart"
                                >
                                  <span className={`text-[11px] font-bold truncate group-hover:underline ${inCart ? 'line-through opacity-65 text-emerald-400' : 'text-text'}`}>
                                    {medName}
                                  </span>
                                  <span className="text-[9px] text-muted mt-0.5 truncate">
                                    Patient: {refill.patient_name}
                                  </span>
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    <span className="text-[8px] text-muted font-mono">
                                      Due: {formatDisplayDate(refill.next_refill_date)}
                                    </span>
                                    {isLeadWindow && (
                                      <span className="text-[8px] font-black text-amber-400 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/40">
                                        🔔 Lead Window ({diffDays}d)
                                      </span>
                                    )}
                                    <span className="text-[8px] font-bold text-red-400 bg-red-500/15 px-1.5 py-0.2 rounded">
                                      Need: {shortageQty} (Stock: {stockQty})
                                    </span>
                                  </div>
                                </div>
                                {inCart ? (
                                  <span className="shrink-0 text-[8px] font-extrabold uppercase bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/20 text-emerald-400 select-none">
                                    Added
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen(medName, shortageQty, undefined, refill.id)}
                                    className="shrink-0 text-[9px] font-bold bg-white text-amber-600 border border-amber-500 hover:bg-amber-50 px-2 py-1 rounded-md transition-all active:scale-95 font-sans flex items-center gap-1 cursor-pointer shadow-sm"
                                    title={`Add ${shortageQty} shortage units to Pharmarack Live Cart`}
                                  >
                                    <Search size={10} />
                                    <span>Add ({shortageQty})</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {(sidebarTab === 'all' || sidebarTab === 'sales_suggestions') && (() => {
                    if (suggestionsLoading) {
                      return (
                        <div className="flex flex-col items-center justify-center py-10 gap-2">
                          <div className="w-6 h-6 border-2 border-emerald-400/20 border-t-emerald-400 rounded-full animate-spin" />
                          <span className="text-[10px] text-muted animate-pulse font-bold uppercase tracking-wider">Calculating 6M & 2-Day Sales…</span>
                        </div>
                      );
                    }

                    if (sidebarTab === 'sales_suggestions' && reorderSuggestions.length === 0) {
                      return (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          No 2-day sales suggestions found.
                        </div>
                      );
                    }

                    if (reorderSuggestions.length === 0 && sidebarTab === 'all') return null;

                    return (
                      <div className="space-y-2">
                        {sidebarTab === 'all' && (
                          <div className="text-[10px] font-black uppercase text-primary tracking-wider px-1 pt-2 pb-1 border-b border-glass-border flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <TrendingUp size={11} />
                              Smart Restock & Safety Reorders ({reorderSuggestions.length})
                            </span>
                          </div>
                        )}
                        {reorderSuggestions.map((sug) => (
                          <div key={sug.medicineId} className="p-3 rounded-xl border border-glass-border bg-glass-bg flex flex-col gap-2 shadow-sm hover:border-primary/40 transition-all">
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col min-w-0 pr-1">
                                <span className="text-xs font-black text-text truncate" title={sug.medicineName}>
                                  {sug.medicineName}
                                </span>
                                <span className="text-[10px] text-muted truncate">
                                  {sug.company} {sug.packaging ? `• ${sug.packaging}` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                {sug.isLowStockSafety && (
                                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Low stock (1-2 strips left) with 6M demand history">
                                    ⚠️ Low Stock ({sug.currentStock} left)
                                  </span>
                                )}
                                {sug.isHotMover && (
                                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                                    🔥 Hot Mover
                                  </span>
                                )}
                                {!sug.isHotMover && !sug.isLowStockSafety && sug.twoDaySales > 0 && (
                                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    ⚡ {sug.twoDaySales} Sold (2d)
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-1 text-[9px] text-muted bg-bg2/40 px-2 py-1 rounded border border-glass-border">
                              <span title="Purchase-Weighted Monthly Consumption (70% Purchases / 30% Sales)">
                                📦 Purchases 6M: <strong className="text-text">{sug.sixMonthTotalPurchases || 0}</strong>
                              </span>
                              <span title="6-Month POS Sales Volume">
                                🛒 Sales 6M: <strong className="text-text">{sug.sixMonthTotalSales || 0}</strong>
                              </span>
                              <span title="Current Inventory Stock">
                                📊 Stock Level: <strong className={sug.currentStock > 0 ? 'text-emerald-400' : 'text-rose-400'}>{sug.currentStock}</strong>
                              </span>
                              <span title="Weighted Monthly Demand Rate">
                                📈 Est. Monthly: <strong className="text-primary">{sug.monthlyWeightedConsumption || sug.suggestedQty}</strong>/mo
                              </span>
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-glass-border">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold text-muted">
                                  Need: <strong className="text-primary font-mono">{sug.suggestedQty} qty</strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {/* Snooze Options */}
                                <div className="relative group">
                                  <button
                                    onClick={async () => {
                                      try {
                                        await api.snoozeReorderSuggestion(sug.medicineId, 7, '7_days');
                                        toastEvent.trigger(`Ignored ${sug.medicineName} for 7 days.`, 'success');
                                        fetchReorderSuggestions();
                                      } catch (_) {
                                        toastEvent.trigger('Failed to ignore suggestion', 'error');
                                      }
                                    }}
                                    className="text-[9px] font-bold text-muted hover:text-text bg-bg2 hover:bg-bg3 border border-glass-border px-2 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1"
                                    title="Ignore for 7 days (or hover for more options)"
                                  >
                                    <span>Ignore (7d)</span>
                                  </button>
                                  <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-bg2 border border-glass-border rounded-lg shadow-xl z-20 py-1 min-w-[120px]">
                                    <button
                                      onClick={async () => {
                                        try {
                                          await api.snoozeReorderSuggestion(sug.medicineId, 30, '30_days');
                                          toastEvent.trigger(`Paused ${sug.medicineName} for 30 days.`, 'success');
                                          fetchReorderSuggestions();
                                        } catch (_) {
                                          toastEvent.trigger('Failed to pause suggestion', 'error');
                                        }
                                      }}
                                      className="text-left px-2.5 py-1 text-[10px] text-text hover:bg-glass-bg cursor-pointer font-medium"
                                    >
                                      Pause 1 Month (30d)
                                    </button>
                                    <button
                                      onClick={async () => {
                                        try {
                                          await api.snoozeReorderSuggestion(sug.medicineId, 180, '6_months');
                                          toastEvent.trigger(`Paused ${sug.medicineName} for 6 Months (Seasonal).`, 'success');
                                          fetchReorderSuggestions();
                                        } catch (_) {
                                          toastEvent.trigger('Failed to pause suggestion', 'error');
                                        }
                                      }}
                                      className="text-left px-2.5 py-1 text-[10px] text-amber-400 hover:bg-glass-bg cursor-pointer font-medium"
                                    >
                                      Pause 6 Months (Seasonal)
                                    </button>
                                  </div>
                                </div>

                                <button
                                  onClick={() => handleReaddSingleSentItem({ productName: sug.medicineName, qty: sug.suggestedQty, ptr: sug.ptr, mrp: sug.mrp, company: sug.company, packaging: sug.packaging })}
                                  className="shrink-0 text-[10px] font-bold bg-primary text-text hover:bg-primary/90 px-2.5 py-1 rounded-lg shadow-sm transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                  title={`Add ${sug.suggestedQty} units of ${sug.medicineName} to Pharmarack Cart`}
                                >
                                  <Plus size={11} />
                                  <span>Add ({sug.suggestedQty})</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {(sidebarTab === 'all' || sidebarTab === ('missing_phone' as any)) && (() => {
                    const missingPhoneDistributors = distributors.filter(dist => !isDistributorMapped(dist));

                    if (sidebarTab === ('missing_phone' as any) && missingPhoneDistributors.length === 0) {
                      return (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          All cart distributors have valid saved phone numbers!
                        </div>
                      );
                    }

                    if (missingPhoneDistributors.length === 0 && sidebarTab === 'all') return null;

                    return (
                      <div className="space-y-2">
                        {sidebarTab === 'all' && (
                          <div className="text-[10px] font-black uppercase text-amber-400 tracking-wider px-1 pt-2 pb-1 border-b border-glass-border/30 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Phone size={11} />
                              Missing Contact Numbers ({missingPhoneDistributors.length})
                            </span>
                          </div>
                        )}
                        {missingPhoneDistributors.map(dist => (
                          <div key={dist.storeId} className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2 shadow-sm">
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-extrabold text-amber-400 truncate" title={dist.storeName}>
                                  {dist.storeName}
                                </span>
                                <span className="text-[9px] text-muted mt-0.5">
                                  Phone Number Missing / Invalid
                                </span>
                              </div>
                            </div>

                            <div className="flex gap-1.5 mt-1">
                              <input
                                type="text"
                                placeholder="10-digit mobile..."
                                value={customDistributorPhones[dist.storeId] || ''}
                                onChange={(e) => setCustomDistributorPhones(prev => ({ ...prev, [dist.storeId]: e.target.value }))}
                                className="flex-1 text-xs px-2.5 py-1.5 rounded-lg bg-bg border border-glass-border text-text focus:outline-none focus:border-primary font-mono"
                              />
                              <button
                                onClick={() => {
                                  const val = customDistributorPhones[dist.storeId];
                                  if (val) {
                                    api.addDistributor({ name: dist.storeName, contact: val }).then(() => {
                                      toastEvent.trigger(`Saved phone for ${dist.storeName}!`, 'success');
                                    }).catch(() => {
                                      toastEvent.trigger('Failed to save phone', 'error');
                                    });
                                  }
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 text-[10px] font-extrabold transition-all active:scale-95 shrink-0 shadow-sm cursor-pointer"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Right Panel: Main live cart contents */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-glass-bg/20">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                  <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                  <p className="text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                    Fetching Live Cart…
                  </p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 max-w-md mx-auto text-center py-12">
                  <AlertCircle size={32} className="text-red/80" />
                  <div>
                    <p className="text-sm font-bold text-text">Failed to fetch cart</p>
                    <p className="text-xs text-muted mt-1">{error}</p>
                  </div>
                  {(error.toLowerCase().includes('login') || error.toLowerCase().includes('session') || error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('token')) ? (
                    <div className="flex flex-col gap-2 w-full max-w-xs">
                      <button
                        onClick={async () => {
                          try {
                            toastEvent.trigger('Opening Pharmarack Login window...', 'info');
                            await api.launchPharmarackLoginWindow();
                          } catch (err: any) {
                            toastEvent.trigger(err?.response?.data?.error || 'Failed to launch login window', 'error');
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
                      >
                        <ExternalLink size={13} />
                        <span>Link Pharmarack Account</span>
                      </button>
                      <button
                        onClick={fetchCart}
                        className="w-full px-4 py-2 rounded-xl bg-bg2 border border-glass-border text-muted hover:text-text hover:bg-bg3 text-xs font-bold transition-all"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={fetchCart}
                      className="premium-btn bg-primary text-text px-4 py-2 hover:bg-primary/80 text-xs font-bold"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : distributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                  <ShoppingCart size={48} className="text-muted/30" />
                  <div>
                    <p className="text-sm font-bold text-text">Your cart is empty</p>
                    <p className="text-xs text-muted mt-1">Add items using the Live Cart Add feature or from Pharmarack directly.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── Sticky Sub-Filter Toggle Bar (Unsent Cart Orders / Sent Orders / All / Failed / Missing Phone) ── */}
                  <div className="sticky top-0 z-10 bg-bg2/80 backdrop-blur-md px-6 py-3 border-b border-glass-border/40 shrink-0 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 bg-bg2/60 p-1 rounded-xl border border-glass-border/40 text-xs font-bold select-none overflow-x-auto">
                      <button
                        onClick={() => setDistributorFilterTab('active')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          distributorFilterTab === 'active' || distributorFilterTab === 'unsent'
                            ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm font-extrabold'
                            : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                        }`}
                      >
                        <ShoppingCart size={13} />
                        <span>Unsent Cart Orders</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/20 font-mono font-bold">
                          {unsentCartDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('success')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          distributorFilterTab === 'success' || distributorFilterTab === 'sent'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm font-extrabold'
                            : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                        }`}
                      >
                        <Check size={13} className="text-emerald-400" />
                        <span>Sent Orders</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold">
                          {sentCartDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('all')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          distributorFilterTab === 'all'
                            ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm font-extrabold'
                            : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                        }`}
                      >
                        <Building2 size={13} />
                        <span>All Items ({distributors.length})</span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('failed')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          distributorFilterTab === 'failed'
                            ? 'bg-red/20 text-red border border-red/30 shadow-sm font-extrabold'
                            : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                        }`}
                      >
                        <AlertCircle size={13} className="text-red" />
                        <span>Failed</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red/10 text-red border border-red/20 font-mono font-bold">
                          {failedDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('unmapped')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                          distributorFilterTab === 'unmapped'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm font-extrabold'
                            : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                        }`}
                      >
                        <Phone size={13} className="text-amber-400" />
                        <span>Missing Phone</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-bold">
                          {unmappedDistributors.length}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* ── Scrollable Distributor Cards Panel ── */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0 custom-scrollbar">

                  {/* ── Previous Orders Reorder Banner ── */}
                  {previousOrderItemsInfo.length > 0 && (distributorFilterTab === 'active' || distributorFilterTab === 'unsent' || distributorFilterTab === 'all') && (() => {
                    const checkedCount = previousOrderItemsInfo.filter(x => x.isChecked).length;
                    const totalCount = previousOrderItemsInfo.length;
                    const allChecked = checkedCount === totalCount;
                    const noneChecked = checkedCount === 0;

                    // Group by distributor for expanded view
                    const byDist = new Map<number, { distName: string; items: typeof previousOrderItemsInfo }>();
                    for (const entry of previousOrderItemsInfo) {
                      const existing = byDist.get(entry.dist.storeId);
                      if (existing) existing.items.push(entry);
                      else byDist.set(entry.dist.storeId, { distName: entry.dist.storeName, items: [entry] });
                    }

                    return (
                      <div className={`rounded-xl border transition-all mb-1 ${noneChecked ? 'border-amber-500/40 bg-amber-500/[0.06]' : checkedCount > 0 ? 'border-amber-500/60 bg-amber-500/[0.10]' : 'border-amber-500/30 bg-amber-500/[0.04]'}`}>
                        {/* Header row */}
                        <div className="flex items-center justify-between px-4 py-3 gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Clock size={14} className="text-amber-400 shrink-0" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-[11px] font-extrabold text-amber-400 leading-tight">
                                Previous Order — {totalCount} {totalCount === 1 ? 'Medicine' : 'Medicines'} to Reorder
                              </span>
                              <span className="text-[10px] text-muted">
                                {noneChecked
                                  ? 'None selected — tick checkboxes to include in today\'s order'
                                  : `${checkedCount} of ${totalCount} selected for reorder`}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Select All */}
                            <button
                              onClick={() => handleToggleAllPreviousItems(true)}
                              disabled={allChecked}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
                              title="Select all previous order medicines for reorder"
                            >
                              Select All
                            </button>
                            {/* Deselect All */}
                            <button
                              onClick={() => handleToggleAllPreviousItems(false)}
                              disabled={noneChecked}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-bg2 text-muted border border-border hover:bg-bg3 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
                              title="Deselect all — exclude previous order medicines from today's order"
                            >
                              Deselect All
                            </button>
                            {/* Expand / Collapse */}
                            <button
                              onClick={() => setReorderBannerCollapsed(v => !v)}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-bg2 text-muted border border-border hover:bg-bg3 transition-all active:scale-95 cursor-pointer"
                              title={reorderBannerCollapsed ? 'Show medicine list' : 'Collapse'}
                            >
                              {reorderBannerCollapsed ? '▸ Show' : '▾ Hide'}
                            </button>
                          </div>
                        </div>

                        {/* Expandable medicine list grouped by distributor */}
                        {!reorderBannerCollapsed && (
                          <div className="border-t border-amber-500/20 px-4 py-3 space-y-3">
                            {Array.from(byDist.entries()).map(([storeId, group]) => (
                              <div key={storeId}>
                                <div className="text-[10px] font-extrabold text-amber-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                  <Building2 size={10} />
                                  {group.distName}
                                </div>
                                <div className="space-y-1">
                                  {group.items.map(({ item, isChecked, placedDateStr }) => (
                                    <div
                                      key={item.productCode || item.productName}
                                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all cursor-pointer hover:bg-amber-500/10 ${isChecked ? 'bg-amber-500/10' : 'bg-bg2/30'}`}
                                      onClick={() => handleToggleItemCheck(storeId, item, !isChecked)}
                                      title={isChecked ? 'Click to exclude from today\'s order' : 'Click to include in today\'s order'}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={e => handleToggleItemCheck(storeId, item, e.target.checked)}
                                        onClick={e => e.stopPropagation()}
                                        className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500 shrink-0"
                                      />
                                      <span className={`text-[11px] font-semibold flex-1 truncate ${isChecked ? 'text-text' : 'text-muted line-through opacity-70'}`}>
                                        {item.productName}
                                      </span>
                                      <span className="text-[10px] font-mono text-muted shrink-0">×{item.qty}</span>
                                      {isChecked ? (
                                        <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 flex items-center gap-0.5">
                                          <Check size={8} />
                                          Reordering
                                        </span>
                                      ) : (
                                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-bg3/70 text-muted/70 border border-border/30 shrink-0">
                                          {placedDateStr}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {filteredDistributorList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                      {distributorFilterTab === 'active' ? (
                        <>
                          <Check size={36} className="text-emerald-400/50" />
                          <p className="text-sm font-bold text-emerald-400">All Cart Orders Sent! 🎉</p>
                          <p className="text-xs text-muted max-w-sm">All items in your cart have been sent to distributors and saved in Sent Orders History.</p>
                          <button
                            onClick={() => setSearchParams({ tab: 'sent-history' })}
                            className="mt-2 px-4 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            <Send size={13} />
                            <span>View Sent Orders History</span>
                          </button>
                        </>
                      ) : distributorFilterTab === 'success' ? (
                        <>
                          <MessageSquare size={36} className="text-muted/30" />
                          <p className="text-xs font-bold text-text">No Messages Sent Yet</p>
                          <p className="text-[11px] text-muted">Click "Send All via WhatsApp" to share orders automatically!</p>
                        </>
                      ) : distributorFilterTab === 'failed' ? (
                        <>
                          <Check size={36} className="text-emerald-400/40" />
                          <p className="text-xs font-bold text-emerald-400">No Failed Messages! 🎉</p>
                          <p className="text-[11px] text-muted">All sent WhatsApp messages completed without errors.</p>
                        </>
                      ) : distributorFilterTab === 'unmapped' ? (
                        <>
                          <Check size={36} className="text-emerald-400/40" />
                          <p className="text-xs font-bold text-emerald-400">All Distributors Have Linked Numbers! 🎉</p>
                          <p className="text-[11px] text-muted">Every store in your cart is linked with a confirmed WhatsApp number.</p>
                        </>
                      ) : (
                        <>
                          <Building2 size={36} className="text-muted/30" />
                          <p className="text-xs font-bold text-text">No Distributors Found</p>
                        </>
                      )}
                    </div>
                  ) : (
                    filteredDistributorList.map((dist) => (
                      <div key={dist.storeId} className="bg-bg2/30 border border-glass-border rounded-xl overflow-hidden shadow-sm">
                        {/* Distributor header */}
                        <div className="bg-bg3/60 px-4 py-2.5 border-b border-glass-border flex items-center justify-between">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <h4 className="text-xs font-extrabold text-text tracking-wide uppercase flex items-center gap-2">
                              <Package size={14} className="text-sky" />
                              {dist.storeName}
                            </h4>

                            {/* Status Badge (Sent Successfully vs Failed) */}
                            {sentWaStatusMap[dist.storeId] === 'success' && (
                              <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                <Check size={11} />
                                <span>WhatsApp Sent</span>
                              </span>
                            )}
                            {sentWaStatusMap[dist.storeId] === 'error' && (
                              <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-red/20 text-red border border-red/40 flex items-center gap-1">
                                <AlertCircle size={11} />
                                <span>Send Failed</span>
                              </span>
                            )}

                            {/* Phone Badge & Contact Search/Edit trigger */}
                            {(() => {
                              const activePhone = getDistributorPhoneNumber(dist);

                              return (
                                <button
                                  onClick={() => handleOpenEditModal(dist)}
                                  className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border transition-all active:scale-95 ${activePhone
                                    ? 'bg-bg2 text-text border-border hover:bg-bg3'
                                    : 'bg-bg2 text-muted border-border hover:bg-bg3'
                                    }`}
                                  title="Search saved distributors & edit WhatsApp phone number"
                                >
                                  <Phone size={10} />
                                  <span>{activePhone || '+ Add Phone'}</span>
                                  <Edit2 size={9} className="opacity-70" />
                                </button>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {dist.deliveryPersons.length > 0 && (
                              <span className="text-[10px] text-muted flex items-center gap-1">
                                <Truck size={11} />
                                {dist.deliveryPersons[0].name}
                              </span>
                            )}
                            {(() => {
                              const totalCount = dist.items.length;
                              const includedCount = dist.items.filter(i => isItemIncludedInDispatch(i, dist)).length;
                              const yesterdayItems = dist.items.filter(i => {
                                const p = getPastOrderedInfo(i, dist);
                                return p.isPastOrdered && !p.isToday;
                              });
                              const yesterdayCount = yesterdayItems.length;
                              const checkedYesterdayCount = yesterdayItems.filter(i => isItemIncludedInDispatch(i, dist)).length;
                              const checkedTotal = getDistributorCheckedTotal(dist);

                              return (
                                <span className="text-[10px] font-bold px-2.5 py-0.5 bg-bg/60 rounded-full border border-glass-border/40 flex items-center gap-1.5 shrink-0">
                                  <span className="text-text font-mono font-black">
                                    ₹{checkedTotal.toFixed(2)}
                                  </span>
                                  <span className="text-muted/40">•</span>
                                  <span className={includedCount > 0 ? "text-primary font-bold" : "text-muted"}>
                                    {includedCount}/{totalCount} to send
                                  </span>
                                  {yesterdayCount > 0 && (
                                    <>
                                      <span className="text-muted/40">•</span>
                                      <span className="text-amber-400 font-extrabold flex items-center gap-0.5" title={`${checkedYesterdayCount} of ${yesterdayCount} past items reordered`}>
                                        <Clock size={10} />
                                        {checkedYesterdayCount > 0 ? `${checkedYesterdayCount}/${yesterdayCount} reordered` : `${yesterdayCount} past (tick to reorder)`}
                                      </span>
                                    </>
                                  )}
                                </span>
                              );
                            })()}

                            {/* Button 1: Send to Delivery Boy via WhatsApp */}
                            <button
                              onClick={() => handleSendDeliveryBoyNotification(dist)}
                              disabled={sendingDeliveryBoyNotifId === dist.storeId}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg2 text-text border border-border hover:bg-bg3 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
                              title="Manually trigger and send WhatsApp order notification to assigned Delivery Boy anytime"
                            >
                              {sendingDeliveryBoyNotifId === dist.storeId ? (
                                <span className="w-2.5 h-2.5 border border-muted/30 border-t-text rounded-full animate-spin" />
                              ) : (
                                <Truck size={11} className="text-muted" />
                              )}
                              <span>Send to Delivery Boy</span>
                            </button>

                            {/* Button 2: Send to Pharmarack Order */}
                            <button
                              onClick={() => handleSendManualNotification(dist)}
                              disabled={sendingNotifId === dist.storeId}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg2 text-text border border-border hover:bg-bg3 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
                              title="Send notification / place order in Pharmarack"
                            >
                              {sendingNotifId === dist.storeId ? (
                                <span className="w-2.5 h-2.5 border border-muted/30 border-t-text rounded-full animate-spin" />
                              ) : (
                                <Send size={10} />
                              )}
                              <span>Send to Pharmarack</span>
                            </button>

                            {/* Button 2: WhatsApp Send & Resend Controls */}
                            {(() => {
                              const isSending = sendingWaDistributorId === dist.storeId;
                              const status = sentWaStatusMap[dist.storeId];
                              const isAlreadySent = status === 'success' || Boolean(lastSentWaTimeMap[dist.storeId]) || (dist.items.length > 0 && dist.items.every(i => isItemAlreadySent(i, dist)));

                              // User styling requirement: WHITE background, GREEN text & GREEN border only. NO solid green fill background.
                              const whiteGreenBtnClass = "bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 font-extrabold shadow-sm";

                              if (isAlreadySent) {
                                return (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {/* Resend to Distributor Only Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleSendWhatsAppOrder(dist, false, true, 'distributor_only')}
                                      disabled={isSending}
                                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${whiteGreenBtnClass}`}
                                      title="Resend WhatsApp order message to Distributor Only"
                                    >
                                      {isSending ? (
                                        <span className="w-2.5 h-2.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                                      ) : (
                                        <RotateCcw size={11} className="text-emerald-600" />
                                      )}
                                      <span>Resend (Distributor Only)</span>
                                    </button>

                                    {/* Resend to Both (Distributor & Delivery Boy) Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleSendWhatsAppOrder(dist, false, true, 'both')}
                                      disabled={isSending}
                                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${whiteGreenBtnClass}`}
                                      title="Resend WhatsApp order message to BOTH Distributor and Delivery Boy"
                                    >
                                      <Send size={10} className="text-emerald-600" />
                                      <span>Resend Both</span>
                                    </button>
                                  </div>
                                );
                              }

                              let btnClass = "bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 font-bold";
                              if (status === 'queued') btnClass = "bg-white text-amber-600 border border-amber-500 hover:bg-amber-50";
                              if (status === 'error') btnClass = "bg-white text-rose-600 border border-rose-500 hover:bg-rose-50";

                              return (
                                <button
                                  type="button"
                                  onClick={() => handleSendWhatsAppOrder(dist, false, false, 'both')}
                                  disabled={isSending}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 ${btnClass}`}
                                  title="Send formatted order message directly to Distributor via WhatsApp"
                                >
                                  {isSending ? (
                                    <span className="w-2.5 h-2.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                                  ) : status === 'queued' ? (
                                    <Clock size={11} className="text-amber-500" />
                                  ) : status === 'error' ? (
                                    <AlertCircle size={11} className="text-rose-500" />
                                  ) : (
                                    <MessageSquare size={10} className="text-emerald-500" />
                                  )}
                                  <span>
                                    {isSending
                                      ? 'Sending...'
                                      : status === 'queued'
                                        ? 'Queued'
                                        : status === 'error'
                                          ? 'Retry WhatsApp'
                                          : 'Send via WhatsApp'}
                                  </span>
                                </button>
                              );
                            })()}

                            {lastSentWaTimeMap[dist.storeId] && (
                              <span className="text-[9px] text-emerald-400 font-mono font-extrabold flex items-center gap-1 shrink-0 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
                                <Clock size={10} />
                                Sent at {lastSentWaTimeMap[dist.storeId]}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Line items table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-glass-border/30 text-muted font-bold uppercase tracking-wider text-[10px]">
                                <th className="text-center px-2 py-2 w-12 text-[9px] font-extrabold text-muted" title="Check old medicines if you want to re-order them">
                                  Reorder
                                </th>
                                <th className="text-left px-3 py-2">Product</th>
                                <th className="text-left px-3 py-2">Company</th>
                                <th className="text-center px-3 py-2">Pack</th>
                                <th className="text-center px-3 py-2">Qty</th>
                                <th className="text-right px-3 py-2">PTR</th>
                                <th className="text-right px-3 py-2">MRP</th>
                                <th className="text-center px-3 py-2">Scheme</th>
                                <th className="text-center px-3 py-2">Stock</th>
                                <th className="text-right px-4 py-2">Amount</th>
                                <th className="text-center px-3 py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-glass-border/15">
                              {dist.items.map((item, idx) => {
                                const isSent = isItemAlreadySent(item, dist);
                                const pastInfo = getPastOrderedInfo(item, dist);
                                const isYesterdayOrPast = pastInfo.isPastOrdered && !pastInfo.isToday;
                                const isIncluded = isItemIncludedInDispatch(item, dist);
                                const isDeleting = updatingItemId === (item.productCode || String(item.productId || item.productName));

                                return (
                                  <tr
                                    key={`${item.productCode}-${idx}`}
                                    className={`transition-colors ${
                                      isYesterdayOrPast
                                        ? isIncluded
                                          ? 'bg-amber-500/[0.08] hover:bg-amber-500/[0.14] border-l-2 border-l-amber-500'
                                          : 'bg-amber-500/[0.03] hover:bg-amber-500/[0.07] border-l-2 border-l-amber-500/40 text-muted'
                                        : isSent
                                          ? 'bg-bg3/20 opacity-75 hover:opacity-100 text-muted'
                                          : 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.09]'
                                    }`}
                                  >
                                    <td className="px-2 py-2.5 text-center w-12">
                                      {isYesterdayOrPast ? (
                                        <input
                                          type="checkbox"
                                          checked={isIncluded}
                                          onChange={(e) => handleToggleItemCheck(dist.storeId, item, e.target.checked)}
                                          className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500 shadow-sm"
                                          title={`Ordered previously on ${pastInfo.placedDateStr}. Check box to include in today's order.`}
                                        />
                                      ) : isSent ? (
                                        <input
                                          type="checkbox"
                                          checked={false}
                                          onChange={() => handleTransferSentItemToUnsent(dist, item)}
                                          className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500 shadow-sm"
                                          title="Sent today. Tick checkbox to re-add / transfer to Unsent Cart Orders"
                                        />
                                      ) : (
                                        <span className="inline-flex items-center justify-center text-emerald-400/80 font-bold select-none text-xs" title="New medicine (included in order)">
                                          ●
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`font-bold text-[11px] ${isYesterdayOrPast && !isIncluded ? 'text-muted line-through opacity-80' : isSent ? 'text-muted' : 'text-text'}`}>
                                            {item.productName}
                                          </span>
                                          {isYesterdayOrPast && (
                                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0 select-none flex items-center gap-1" title={`Ordered previously on ${pastInfo.placedDateStr}. Check box to include in today's order.`}>
                                              <Clock size={9} />
                                              <span>⚡ {pastInfo.isYesterday ? 'ORDERED YESTERDAY' : `ORDERED ON ${pastInfo.placedDateStr.toUpperCase()}`}</span>
                                            </span>
                                          )}
                                          {isYesterdayOrPast && (
                                            isIncluded ? (
                                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 select-none flex items-center gap-0.5">
                                                <Check size={8} />
                                                <span>REORDERING</span>
                                              </span>
                                            ) : (
                                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-bg3/70 text-muted border border-border/40 shrink-0 select-none">
                                                Excluded
                                              </span>
                                            )
                                          )}
                                          {!isYesterdayOrPast && isSent && (
                                            <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-bg3 text-muted border border-border/40 shrink-0 select-none flex items-center gap-0.5">
                                              <Check size={8} />
                                              <span>SENT TODAY</span>
                                            </span>
                                          )}
                                          {!isYesterdayOrPast && !isSent && (
                                            <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 select-none flex items-center gap-0.5">
                                              <span>✨ NEW</span>
                                            </span>
                                          )}
                                        </div>

                                      {/* Duplicate Distributor Warning */}
                                      {(() => {
                                        const dup = getDuplicateItemInCart(item);
                                        if (dup) {
                                          return (
                                            <div className="flex items-center gap-1 text-[9px] font-extrabold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 w-fit">
                                              <AlertCircle size={10} className="shrink-0" />
                                              <span>Also in cart under {dup.storeName} ({dup.qty} qty)</span>
                                            </div>
                                          );
                                        }
                                        return null;
                                      })()}

                                      {/* Alternative Distributor Suggestion */}
                                      {(() => {
                                        const history = priceHistoryCache[item.productName] || [];
                                        const matchingMrpHistory = history.filter(h => Math.abs(h.mrp - item.mrp) < 0.1);
                                        if (matchingMrpHistory.length > 0) {
                                          const best = matchingMrpHistory.reduce((prev, curr) => (curr.net_rate < prev.net_rate) ? curr : prev, matchingMrpHistory[0]);
                                          if (best.net_rate < item.ptr) {
                                            return (
                                              <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 w-fit mt-0.5" title={`Rate: ₹${best.rate.toFixed(2)}, Free: ${best.free_qty}, Disc: ₹${best.cd_rs.toFixed(2)}`}>
                                                <Clock size={10} className="shrink-0" />
                                                <span>Cheapest historic: ₹{best.net_rate.toFixed(2)} from {best.distributor_name}</span>
                                              </div>
                                            );
                                          }
                                        }
                                        return null;
                                      })()}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-muted text-[10px] max-w-[120px] truncate">{item.company}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    {item.packaging && (
                                      <span className="text-[9px] text-muted bg-bg3/50 px-1.5 py-0.5 rounded border border-glass-border/40 font-mono">
                                        {item.packaging}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 text-center min-w-[110px] whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1 flex-nowrap shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateQty(item, item.qty - 1)}
                                        disabled={updatingItemId === item.productCode || item.qty <= 1}
                                        className="w-5 h-5 rounded bg-bg3 border border-glass-border hover:bg-bg2 hover:text-text text-muted flex items-center justify-center font-bold text-xs disabled:opacity-40 transition-all shrink-0"
                                      >
                                        -
                                      </button>
                                      <input
                                        type="text"
                                        pattern="[0-9]*"
                                        value={item.qty}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value.replace(/\D/g, ''), 10);
                                          if (!isNaN(val) && val >= 1) {
                                            handleUpdateQty(item, val);
                                          }
                                        }}
                                        disabled={updatingItemId === item.productCode}
                                        className="w-10 text-center font-black text-text font-mono bg-bg border border-glass-border rounded py-0.5 text-xs focus:outline-none focus:border-primary disabled:opacity-50 shrink-0"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateQty(item, item.qty + 1)}
                                        disabled={updatingItemId === item.productCode}
                                        className="w-5 h-5 rounded bg-bg3 border border-glass-border hover:bg-bg2 hover:text-text text-muted flex items-center justify-center font-bold text-xs disabled:opacity-40 transition-all shrink-0"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono text-text text-[11px]">
                                    {item.ptr > 0 ? `₹${item.ptr.toFixed(2)}` : '—'}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono text-muted text-[11px]">
                                    {item.mrp > 0 ? `₹${item.mrp.toFixed(2)}` : '—'}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    {item.scheme ? (
                                      <span className="text-[9px] font-bold text-green bg-green/10 px-1.5 py-0.5 rounded border border-green/20">
                                        {item.scheme}
                                      </span>
                                    ) : (
                                      <span className="text-muted/40">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 text-center font-mono text-[10px]">
                                    {item.stock !== null ? (
                                      <span className={item.stock > 10 ? 'text-emerald-400' : item.stock > 0 ? 'text-amber-400' : 'text-red'}>
                                        {item.stock}
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono font-black text-emerald-400 text-[11px]">
                                    ₹{getCartItemAmount(item).toFixed(2)}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteItem(item)}
                                      disabled={isDeleting}
                                      className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 hover:text-rose-300 transition-all active:scale-95 disabled:opacity-40 flex items-center gap-1 font-bold text-[10px] mx-auto cursor-pointer"
                                      title={`Delete ${item.productName} from Pharmarack live cart`}
                                    >
                                      {isDeleting ? (
                                        <span className="w-2.5 h-2.5 border border-rose-400/30 border-t-rose-400 rounded-full animate-spin" />
                                      ) : (
                                        <Trash2 size={12} />
                                      )}
                                      <span>Delete</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                        {dist.lineTotal > 0 && (
                          <div className="border-t border-glass-border/30 px-4 py-2 bg-bg3/30 flex justify-end">
                            <span className="text-[10px] text-muted font-bold uppercase tracking-wider mr-3">Subtotal</span>
                            <span className="text-xs font-black text-emerald-400 font-mono">₹{dist.lineTotal.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Footer / Total Summary ── */}
          {distributors.length > 0 && !loading && (
            <div className="border-t border-glass-border bg-bg2/40 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 shadow-lg">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Distributors</span>
                  <span className="text-base font-black text-text font-mono">{distributors.length}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Products</span>
                  <span className="text-base font-black text-text font-mono">{totalProducts}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Qty</span>
                  <span className="text-base font-black text-text font-mono">{totalQty}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Estimated Total</span>
                  <span className="text-lg font-black text-emerald-400 font-mono">₹{totalAmount.toFixed(2)}</span>
                </div>
              </div>

              <a
                href="https://retailers.pharmarack.com/cart"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto premium-btn bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 active:scale-95 shadow-[0_4px_14px_rgba(16,185,129,0.4)] transition-all"
              >
                <ExternalLink size={14} />
                <span>Proceed to Checkout</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Edit Distributor Contact Modal ── */}
      {editingDistributor && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg2 border border-glass-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-bg3/80 px-6 py-4 border-b border-glass-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Phone className="text-emerald-400" size={18} />
                <div>
                  <h3 className="font-extrabold text-text text-sm">Distributor WhatsApp Contact</h3>
                  <p className="text-[11px] text-muted truncate max-w-[240px]">{editingDistributor.storeName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingDistributor(null);
                  setIsSavingContact(false);
                }}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {/* Select Saved Directory Distributor or Create New */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-muted">
                    {isAddingNewDistributor ? 'Create New AI Learning Distributor' : 'Link to Saved Directory Distributor'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewDistributor(!isAddingNewDistributor);
                      if (!isAddingNewDistributor) {
                        setNewDistNameInput(editingDistributor.storeName || '');
                        setSelectedSavedDistId(null);
                      }
                    }}
                    className="text-[11px] font-extrabold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/20 transition-all active:scale-95"
                  >
                    {isAddingNewDistributor ? (
                      <>
                        <X size={12} /> Use Directory List
                      </>
                    ) : (
                      <>
                        <Plus size={12} /> Create New
                      </>
                    )}
                  </button>
                </div>

                {isAddingNewDistributor ? (
                  <div className="space-y-2.5 bg-bg3/50 p-3 rounded-xl border border-emerald-500/30 animate-in fade-in zoom-in-95 duration-150">
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                        Distributor Name (AI Learning Page)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. BHIKSHU DISTRIBUTORS"
                        value={newDistNameInput}
                        onChange={(e) => setNewDistNameInput(e.target.value)}
                        className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-emerald-500 font-bold"
                      />
                    </div>
                    <p className="text-[10px] text-muted leading-tight">
                      This will automatically create a new distributor profile in the <strong className="text-text">AI Learning page</strong>.
                    </p>
                  </div>
                ) : (
                  <select
                    value={selectedSavedDistId || ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setSelectedSavedDistId(val);
                      if (val) {
                        const found = savedDistributorsList.find((d: any) => d.id === val);
                        if (found && (found.phone || found.mobile || found.whatsapp)) {
                          setModalPhoneInput(found.phone || found.mobile || found.whatsapp || '');
                        }
                      }
                    }}
                    className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-emerald-500 font-medium"
                  >
                    <option value="">-- Direct Mobile Number Only --</option>
                    {savedDistributorsList.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.phone ? `(${d.phone})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* WhatsApp Mobile Number Input */}
              <div>
                <label className="block text-xs font-bold text-muted mb-1.5">
                  WhatsApp Phone Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9822012345"
                  value={modalPhoneInput}
                  onChange={(e) => setModalPhoneInput(sanitizePhoneInput(e.target.value))}
                  maxLength={10}
                  className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text font-mono focus:outline-none focus:border-emerald-500 font-bold"
                />
                <p className="text-[10px] text-muted mt-1 font-medium">
                  10-digit mobile numbers will be formatted with +91 country code automatically.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="bg-bg3/40 px-6 py-3.5 border-t border-glass-border flex items-center justify-between gap-2">
              <a
                href={`/learning?tab=distributor_layouts${editingDistributor?.storeId ? `&id=${editingDistributor.storeId}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[11px] font-bold text-sky hover:bg-sky-500/20 transition-all"
                title="Open full distributor profile & OCR rules in AI Learning page"
              >
                <ExternalLink size={12} />
                <span>Open in AI Learning</span>
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingDistributor(null);
                    setIsSavingContact(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDistributorContact}
                  disabled={isSavingContact}
                  className="premium-btn bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-5 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all shadow-md active:scale-95"
                >
                  {isSavingContact ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>Save Contact</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Missing Delivery Boy Confirmation Modal */}
      {showMissingBoyModal && createPortal(
        <div className="fixed inset-0 z-submodal flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-bg2 border border-glass-border rounded-2xl w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-scale-up">
            <div className="px-6 py-4 border-b border-glass-border flex items-center justify-between bg-bg3/40">
              <div className="flex items-center gap-2.5">
                <Truck className="text-amber-400" size={20} />
                <div>
                  <h3 className="font-extrabold text-text text-sm">Delivery Boy Details Missing</h3>
                  <p className="text-[11px] text-muted">No delivery boy contacts found in database</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMissingBoyModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
                <p className="font-semibold mb-1 font-bold">Notice:</p>
                No delivery boy phone numbers were found in your database. Would you like to fill in the Delivery Boy details now, or proceed using the <strong>Admin Contact Number ({storeInfo.adminPhone || storeInfo.phone || 'Admin'})</strong> as the delivery contact so distributors can reach you directly?
              </div>

              {/* Form to add quick delivery boy */}
              <div className="space-y-3 pt-1">
                <p className="text-xs font-bold text-text">Fill Delivery Boy Details:</p>
                <div>
                  <label className="block text-[11px] font-bold text-muted mb-1">Delivery Boy Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Dinesh"
                    value={quickBoyName}
                    onChange={(e) => setQuickBoyName(e.target.value)}
                    className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-amber-500 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted mb-1">WhatsApp Phone Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={quickBoyPhone}
                    onChange={(e) => setQuickBoyPhone(sanitizePhoneInput(e.target.value))}
                    maxLength={10}
                    className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text font-mono focus:outline-none focus:border-amber-500 font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="bg-bg3/40 px-6 py-3.5 border-t border-glass-border flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveQuickDeliveryBoy}
                disabled={isSavingQuickBoy || !quickBoyName.trim() || !quickBoyPhone.trim()}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all shadow-md active:scale-95"
              >
                {isSavingQuickBoy ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                <span>Save Delivery Boy & Send Order</span>
              </button>

              <button
                type="button"
                onClick={handleSkipMissingBoyAndUseAdmin}
                className="w-full bg-bg border border-glass-border hover:bg-bg3 text-muted hover:text-text text-xs font-bold py-2.5 rounded-xl transition-all"
              >
                Skip & Use Admin Number ({storeInfo.adminPhone || storeInfo.phone || 'Admin'})
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
