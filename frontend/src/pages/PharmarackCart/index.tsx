import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, ExternalLink, ShoppingCart, Package, AlertCircle, Truck, Clock, Send, Building2, MessageSquare, Phone, UserCheck, Search, Edit2, X, Plus, Check } from 'lucide-react';
import { formatDisplayDate } from '../../utils/date';
import { api, apiClient, type SpecialOrder, type Refill } from '../../services/api';
import { toastEvent, liveCartAddEvent, specialOrdersEvent } from '../../services/events';

import { useSearchParams } from 'react-router-dom';
import NonMappedDistributors from '../NonMappedDistributors';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { findBestCartMatchForOrder, evaluateOrderCartMatch } from '../../utils/orderFuzzyMatcher';

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
  const currentTab = searchParams.get('tab') || 'cart';
  const [distributors, setDistributors] = useState<Distributor[]>(() => cachedDistributors);
  const [loading, setLoading] = useState(() => cachedDistributors.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(() => cachedLastFetched);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [priceHistoryCache, setPriceHistoryCache] = useState<Record<string, any[]>>(() => cachedPriceHistory);
  const [sendingNotifId, setSendingNotifId] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>(() => cachedPendingOrders);
  const [addingOrderId, setAddingOrderId] = useState<number | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'requests' | 'refills' | 'history'>('requests');
  const [pendingRefills, setPendingRefills] = useState<Refill[]>(() => cachedPendingRefills);
  const [addingRefillId, setAddingRefillId] = useState<number | null>(null);
  const [showAddedItems, setShowAddedItems] = useState<boolean>(false);

  const [sentDates, setSentDates] = useState<string[]>([]);
  const [selectedSentDate, setSelectedSentDate] = useState<string>('');
  const [sentOrders, setSentOrders] = useState<any[]>([]);
  const [sentOrdersLoading, setSentOrdersLoading] = useState<boolean>(false);
  const [readdingSentItems, setReaddingSentItems] = useState<boolean>(false);

  const loadSentDates = async () => {
    try {
      const res = await api.getPharmarackSentDates();
      if (res && res.success && Array.isArray(res.dates)) {
        setSentDates(res.dates);
        if (res.dates.length > 0 && !selectedSentDate) {
          setSelectedSentDate(res.dates[0]);
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
    if (sidebarTab === 'history') {
      loadSentDates();
    }
  }, [sidebarTab]);

  useEffect(() => {
    if (sidebarTab === 'history' && selectedSentDate) {
      loadSentOrdersForDate(selectedSentDate);
    }
  }, [sidebarTab, selectedSentDate]);

  const handleCopySentItemsToCart = async (items: any[]) => {
    if (!items || items.length === 0) return;
    setReaddingSentItems(true);
    let addedCount = 0;
    try {
      for (const item of items) {
        const prodName = item.productName || item.product || item.name;
        const qty = item.qty || item.quantity || 1;
        if (!prodName) continue;
        await apiClient.post('/pharmarack/cart/add', {
          productName: prodName,
          qty,
          productCode: item.productCode || '',
          company: item.company || '',
          packaging: item.packaging || '',
          ptr: item.ptr || 0,
          mrp: item.mrp || 0
        });
        addedCount++;
      }
      toastEvent.trigger(`Successfully re-added ${addedCount} item(s) to active cart!`, 'success');
      fetchCart();
    } catch (err: any) {
      console.error('Error re-adding sent items to cart:', err);
      toastEvent.trigger('Failed to re-add items: ' + (err.message || 'Server error'), 'error');
    } finally {
      setReaddingSentItems(false);
    }
  };

  const [isSendingBatchWhatsApp, setIsSendingBatchWhatsApp] = useState(false);
  const [sendingWaDistributorId, setSendingWaDistributorId] = useState<number | null>(null);

  // Persistent WhatsApp sent status map by storeId (preserves history across reloads & sessions)
  const [sentWaStatusMap, setSentWaStatusMap] = useState<Record<number, 'success' | 'queued' | 'sending' | 'error'>>(() => {
    try {
      const saved = localStorage.getItem('pharmacart_sent_wa_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.data === 'object') {
          return parsed.data;
        }
      }
    } catch (_) { }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('pharmacart_sent_wa_history', JSON.stringify({
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

          const matchingItem = recentItems.find((item: any) => {
            const itemPhone = (item.number || '').replace(/\D/g, '');
            const matchPhone = itemPhone.length >= 7 && cleanPhone.length >= 7 && (itemPhone.endsWith(cleanPhone.slice(-10)) || cleanPhone.endsWith(itemPhone.slice(-10)));
            const matchName = item.target_name && dist.storeName && item.target_name.toLowerCase().trim() === dist.storeName.toLowerCase().trim();
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
              if (sentWaStatusMap[dist.storeId] !== 'error') {
                toastEvent.trigger(`❌ WhatsApp order to ${dist.storeName} failed: ${matchingItem.error_message || 'Could not deliver message'}`, 'error');
              }
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
    const interval = setInterval(syncQueueStatus, 3500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [distributors, sentWaStatusMap, pageActive]);

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
        setDeliveryBoysList(res.data.filter((b: any) => b.is_active !== 0));
      }
    } catch (err) {
      console.warn('Failed to load delivery boys list for WhatsApp template:', err);
    }
  };

  const fetchStoreInfo = async () => {
    try {
      const res = await apiClient.get('/settings');
      if (res.data) {
        const s = res.data;
        setStoreInfo({
          name: s.pharmacy_name || s.shop_name || s.store_name || s.name || 'AI Pharmacy',
          phone: s.phone || s.shop_phone || s.store_phone || s.whatsapp_number || s.owner_whatsapp_number || '',
          address: s.address || s.shop_address || s.store_address || '',
          email: s.email || '',
          adminPhone: s.admin_whatsapp || s.admin_phone || s.owner_whatsapp_number || '',
          deliveryBoyName1: deliveryBoysList[0]?.name || '',
          deliveryBoyPhone: deliveryBoysList[0]?.whatsapp_number || '',
          deliveryBoyName2: deliveryBoysList[1]?.name || '',
          deliveryBoyPhone2: deliveryBoysList[1]?.whatsapp_number || '',
          invoiceFileFormat: s.distributor_invoice_file_format || 'CSV File Format'
        });
      }
    } catch (err) {
      console.warn('Failed to load store settings for WhatsApp template:', err);
    }
  };

  useEffect(() => {
    fetchSavedDistributors();
    fetchDistributorMappings();
    fetchStoreInfo();
    fetchDeliveryBoys();

    // Listen to global phone-numbers-updated event to update contacts instantly without page reload
    const handlePhoneUpdate = () => {
      fetchSavedDistributors();
      fetchDistributorMappings();
      fetchStoreInfo();
      fetchDeliveryBoys();
    };
    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    return () => window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
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

  const [batchCountdownSec, setBatchCountdownSec] = useState<number | null>(null);

  // Distributor filter sub-tab state ('all' | 'success' | 'failed' | 'unmapped')
  const [distributorFilterTab, setDistributorFilterTab] = useState<'all' | 'success' | 'failed' | 'unmapped'>('all');

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

    // 1. First priority: Exact or noise-cleaned match WITH a valid phone number
    const matchWithPhone = savedDistributorsList.find((d: any) => {
      if (!d || !d.name || !getPhone(d)) return false;

      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');

      return (
        (rawCartNorm && rawCartNorm === rawSavedNorm) ||
        (normCart && normSaved && normCart === normSaved) ||
        (normCart && normSaved && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });

    if (matchWithPhone) return matchWithPhone;

    // 2. Second priority: Any matching distributor record (fallback)
    return savedDistributorsList.find((d: any) => {
      if (!d || !d.name) return false;

      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');

      return (
        (rawCartNorm && rawCartNorm === rawSavedNorm) ||
        (normCart && normSaved && normCart === normSaved) ||
        (normCart && normSaved && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });
  };

  const getDistributorPhoneNumber = (dist: Distributor): string => {
    // 1. Primary source: Stored persistent store-to-distributor mapping from SQLite DB
    const normName = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
    if (normName && distributorMappings[normName]) {
      const mappedPhone = distributorMappings[normName].phone;
      if (mappedPhone && mappedPhone.trim().length > 0) {
        return mappedPhone.trim();
      }
    }

    // 2. Central Database (distributors table) match
    const matched = findSavedDistributorMatch(dist.storeName);
    const dbPhone = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
    if (dbPhone && dbPhone.trim().length > 0) return dbPhone.trim();

    // 3. Fallback to transient memory session override
    const custom = customDistributorPhones[dist.storeId];
    if (custom && custom.trim().length > 0) return custom.trim();

    return '';
  };

  const isDistributorMapped = (dist: Distributor) => {
    const phone = getDistributorPhoneNumber(dist);
    return Boolean(phone && phone.trim().length > 0);
  };

  const mappedDistributors = React.useMemo(() => {
    return distributors.filter(d => isDistributorMapped(d));
  }, [distributors, customDistributorPhones, savedDistributorsList]);

  const successDistributors = React.useMemo(() => {
    return distributors.filter(d => sentWaStatusMap[d.storeId] === 'success');
  }, [distributors, sentWaStatusMap]);

  const failedDistributors = React.useMemo(() => {
    return distributors.filter(d => sentWaStatusMap[d.storeId] === 'error');
  }, [distributors, sentWaStatusMap]);

  const unmappedDistributors = React.useMemo(() => {
    return distributors.filter(d => !isDistributorMapped(d));
  }, [distributors, customDistributorPhones, savedDistributorsList]);

  const filteredDistributorList = React.useMemo(() => {
    if (distributorFilterTab === 'success') return successDistributors;
    if (distributorFilterTab === 'failed') return failedDistributors;
    if (distributorFilterTab === 'unmapped') return unmappedDistributors;
    return distributors;
  }, [distributorFilterTab, successDistributors, failedDistributors, unmappedDistributors, distributors]);

  // ponytail: delivery boy data comes exclusively from /dispatch/delivery-boys (delivery_boys table)
  // Store info (name, phone, address) comes from /settings. No delivery boy keys read from app_settings.

  const fetchPendingRefills = async () => {
    try {
      const data = await api.getRefills();
      if (Array.isArray(data)) {
        const filtered = data.filter(r =>
          r.is_active === 1 &&
          r.status === 'pending' &&
          r.hold_for_stock === 1
        );
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
        pharmarack_mapped: 1
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
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: dist.items
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
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: dist.items
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

  const buildDistributorOrderMessage = (dist: Distributor) => {
    const deliveryStaff = dist.deliveryPersons.length > 0 ? dist.deliveryPersons[0] : null;

    const formatPhone = (raw: string) => {
      if (!raw) return '';
      let clean = raw.replace(/\D/g, '');
      if (clean.length === 10) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
      if (clean.startsWith('91') && clean.length === 12) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
      return raw;
    };

    let msg = `🏬 *NEW STOCK ORDER — ${storeInfo.name.toUpperCase()}*\n\n`;
    msg += `📋 *Pharmacy Details:*\n`;
    msg += `• Store: *${storeInfo.name}*\n`;
    msg += `• Phone: *${storeInfo.phone ? formatPhone(storeInfo.phone) : 'N/A'}*\n`;
    if (storeInfo.adminPhone && storeInfo.adminPhone !== storeInfo.phone) {
      msg += `• Admin Contact: *${formatPhone(storeInfo.adminPhone)}*\n`;
    }
    msg += `• Address: *${storeInfo.address || 'N/A'}*\n`;
    if (storeInfo.email) msg += `• Email: *${storeInfo.email}*\n`;
    msg += `• Requested File Format: *${storeInfo.invoiceFileFormat || 'CSV File Format'}*\n`;

    // Dynamic Delivery Boy & Pickup Staff Contacts section
    msg += `\n🛵 *Delivery & Pickup Contacts:*\n`;

    // Set to avoid duplicate entries
    const addedContacts = new Set<string>();

    if (deliveryStaff?.name) {
      const staffPhone = formatPhone((deliveryStaff as any)?.phone || (deliveryStaff as any)?.code || '');
      msg += `• Staff: *${deliveryStaff.name}*${staffPhone ? ` (${staffPhone})` : ''}\n`;
      if (staffPhone) addedContacts.add(staffPhone);
    }

    // Dynamic rendering of ALL registered delivery boys with actual names and numbers from DB
    if (deliveryBoysList.length > 0) {
      deliveryBoysList.forEach(boy => {
        if (boy.name && boy.whatsapp_number) {
          const formatted = formatPhone(boy.whatsapp_number);
          if (!addedContacts.has(formatted)) {
            msg += `• ${boy.name}: *${formatted}*\n`;
            addedContacts.add(formatted);
          }
        }
      });
    }

    // ponytail: no app_settings fallback — delivery boys come exclusively from delivery_boys table

    // Fallback to Admin contact if user skipped or no delivery boys exist
    if (addedContacts.size === 0) {
      const adminNum = formatPhone(storeInfo.adminPhone || storeInfo.phone);
      if (adminNum) {
        msg += `• Delivery Contact (Admin): *${adminNum}* (Call directly for delivery info)\n`;
      } else {
        msg += `• Contact Phone: *N/A*\n`;
      }
    }

    msg += `\n----------------------------------\n`;
    msg += `📦 *ORDERED MEDICINES:*\n`;
    dist.items.forEach((item, idx) => {
      const pack = item.packaging ? ` (${item.packaging})` : '';
      const rateText = item.ptr > 0 ? ` @ ₹${item.ptr.toFixed(2)}` : '';
      msg += `${idx + 1}. *${item.productName}*${pack} — Qty: *${item.qty}*${rateText}\n`;
    });
    msg += `----------------------------------\n`;
    msg += `📊 *Total Items:* ${dist.items.length}\n`;
    if (dist.lineTotal > 0) {
      msg += `💰 *Subtotal:* ₹${dist.lineTotal.toFixed(2)}\n`;
    }
    msg += `🕒 *Time:* ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n`;
    msg += `*Please confirm order receipt & dispatch.*`;
    return msg;
  };

  const handleSaveQuickDeliveryBoy = async () => {
    if (!quickBoyName.trim()) {
      toastEvent.trigger('Delivery boy name is required.', 'error');
      return;
    }
    if (!quickBoyPhone.trim() || !isValidPhoneNumber(quickBoyPhone)) {
      toastEvent.trigger('Please enter a valid 10-digit WhatsApp phone number.', 'error');
      return;
    }

    setIsSavingQuickBoy(true);
    try {
      await apiClient.post('/dispatch/delivery-boys', {
        name: quickBoyName.trim(),
        whatsapp_number: quickBoyPhone.trim(),
        is_active: 1
      });
      // ponytail: no dual-write to app_settings — delivery_boys table is single source of truth
      toastEvent.trigger(`Added delivery boy "${quickBoyName.trim()}"!`, 'success');
      await Promise.all([fetchDeliveryBoys(), fetchStoreInfo()]);
      setShowMissingBoyModal(false);
      const distTarget = pendingTargetDistributor;
      setQuickBoyName('');
      setQuickBoyPhone('');

      if (distTarget === 'ALL') {
        handleSendAllWhatsAppOrders(true);
      } else if (distTarget) {
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

  const handleSendWhatsAppOrder = async (dist: Distributor, bypassMissingBoyCheck = false) => {
    if (!bypassMissingBoyCheck && !hasDeliveryBoyContacts()) {
      setPendingTargetDistributor(dist);
      setShowMissingBoyModal(true);
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
        message: msg
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
        toastEvent.trigger(`WhatsApp order sent and verified for ${dist.storeName}!`, 'success');
      } else {
        throw new Error(res?.data?.error || 'Silent send failed');
      }

      // Also trigger backend notification to Delivery Boys
      try {
        await apiClient.post('/pharmarack/cart/notify-manual', {
          storeId: dist.storeId,
          storeName: dist.storeName,
          deliveryPersons: dist.deliveryPersons,
          items: dist.items
        });
      } catch (distErr) {
        console.warn('Could not notify delivery boys via backend route:', distErr);
      }

      // Log placed order to DB history
      try {
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: dist.items,
          delivery_persons: dist.deliveryPersons
        });
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
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: dist.items,
          delivery_persons: dist.deliveryPersons
        });
      } catch (logErr) {
        console.warn('Could not log placed order:', logErr);
      }
    } finally {
      setSendingWaDistributorId(null);
    }
  };

  const handleSendAllWhatsAppOrders = async (bypassMissingBoyCheck = false) => {
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

    setIsSendingBatchWhatsApp(true);

    try {
      const ordersPayload: { storeName: string; storeId: number; phone: string; message: string; lineTotal?: number; items: any[] }[] = [];

      for (const dist of mapped) {
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

        const msg = buildDistributorOrderMessage(dist);
        ordersPayload.push({
          storeName: dist.storeName,
          storeId: dist.storeId,
          phone: cleanPhone,
          message: msg,
          lineTotal: dist.lineTotal,
          items: dist.items
        });
      }

      if (ordersPayload.length === 0) {
        toastEvent.trigger('No valid distributor phone numbers found to enqueue.', 'error');
        return;
      }

      // Resolve primary delivery boy details
      const primaryBoy = deliveryBoysList.find(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0);
      const deliveryBoyPhone = primaryBoy?.whatsapp_number || storeInfo.deliveryBoyPhone || storeInfo.adminPhone || '';
      const deliveryBoyName = primaryBoy?.name || 'Delivery Staff';

      // ENQUEUE ALL MESSAGES INSTANTLY TO BACKGROUND QUEUE WORKER
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
      setIsSendingBatchWhatsApp(false);
      setBatchCountdownSec(null);
    }
  };

  const handleOpenEditModal = (dist: Distributor) => {
    setEditingDistributor(dist);
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
    if (!editingDistributor) return;
    setIsSavingContact(true);
    const cleanPhone = modalPhoneInput.trim();
    const storeId = editingDistributor.storeId;
    const distName = editingDistributor.storeName;

    // 1. Immediately update UI state & close modal for instant zero-latency feedback
    setCustomDistributorPhones(prev => ({
      ...prev,
      [storeId]: cleanPhone
    }));
    toastEvent.trigger(`Saved WhatsApp contact for ${distName}`, 'success');
    setEditingDistributor(null);

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
          await apiClient.put(`/distributors/${selectedSavedDistId}`, {
            name: foundSaved?.name || distName,
            phone: cleanPhone
          });
        } catch (e) {
          console.warn('PUT distributor by ID failed, falling back to name upsert:', e);
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

      // 3. Broadcast real-time update events & refresh saved distributors list and mappings
      window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
      window.dispatchEvent(new CustomEvent('contacts-updated'));
      await fetchSavedDistributors();
      await fetchDistributorMappings();
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
        Promise.all(
          namesToFetch.map(async (name) => {
            try {
              const res = await api.getMedicinePriceHistory(name);
              return { name, data: res?.data || [] };
            } catch (e) {
              return { name, data: [] };
            }
          })
        ).then(results => {
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

  const fetchCart = async () => {
    // Only show loading spinner on cold cache (first visit)
    if (cachedDistributors.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        const list = data.distributors || [];
        setDistributors(list);
        cachedDistributors = list;
        const now = new Date();
        setLastFetched(now);
        cachedLastFetched = now;
        fetchPriceHistories(list);
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

  const fetchCartSilent = async () => {
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        const list = data.distributors || [];
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
    if (newQty < 1) return;

    // 1. Optimistic Update (Immediate UI state update)
    setDistributors(prev => prev.map(dist => {
      if (dist.storeId !== item.storeId) return dist;

      const updatedItems = dist.items.map(i => {
        if (i.productCode !== item.productCode) return i;
        const oldQty = i.qty;
        // Recalculate amount using PTR rate
        const rateVal = i.ptr || 0;
        const newAmount = rateVal * newQty;
        return {
          ...i,
          qty: newQty,
          amount: newAmount
        };
      });

      const newlineTotal = updatedItems.reduce((sum, it) => sum + it.amount, 0);

      return {
        ...dist,
        items: updatedItems,
        lineTotal: newlineTotal
      };
    }));

    setUpdatingItemId(item.productCode);
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
        toastEvent.trigger('Quantity updated successfully', 'success');
        // Silent background refresh to verify final state without showing a full screen loading spinner
        await fetchCartSilent();
      } else {
        toastEvent.trigger(res?.error || 'Failed to update quantity', 'error');
        await fetchCart(); // Revert to server state on error
      }
    } catch (err: any) {
      console.error('Failed to update quantity:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to update quantity', 'error');
      await fetchCart(); // Revert to server state on error
    } finally {
      setUpdatingItemId(null);
    }
  };

  useEffect(() => {
    fetchCart();
    fetchPendingOrders();
    fetchPendingRefills();
  }, []);

  // Re-fetch pending special orders whenever any page creates/updates an order.
  // This clears the module-level cache so stale data is never shown.
  useEffect(() => {
    const unsub = specialOrdersEvent.subscribeUpdated(() => {
      cachedPendingOrders = [];
      fetchPendingOrders();
    });
    return unsub;
  }, []);


  const totalProducts = distributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = distributors.reduce((s, d) => s + d.items.reduce((q, i) => q + i.qty, 0), 0);
  const totalAmount = distributors.reduce((s, d) => s + d.items.reduce((a, i) => a + i.amount, 0), 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg text-text gap-3 p-6 pb-4">
      {/* Page Tabs */}
      <div className="flex border-b border-glass-border bg-glass-bg backdrop-blur-xl shrink-0 rounded-xl overflow-hidden p-1 gap-1">
        <button
          onClick={() => setSearchParams({ tab: 'cart' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${currentTab === 'cart' || !currentTab
            ? 'bg-primary/10 border border-primary/20 text-text shadow-[0_0_10px_rgba(var(--primary-rgb),0.15)]'
            : 'border border-transparent text-muted hover:text-text hover:bg-white/[0.02]'
            }`}
        >
          <ShoppingCart size={14} />
          Pharmarack Cart
        </button>

        <button
          onClick={() => setSearchParams({ tab: 'sent-history' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${currentTab === 'sent-history'
            ? 'bg-primary/10 border border-primary/20 text-text shadow-[0_0_10px_rgba(var(--primary-rgb),0.15)]'
            : 'border border-transparent text-muted hover:text-text hover:bg-white/[0.02]'
            }`}
        >
          <Send size={14} />
          Sent Orders History
        </button>

        <button
          onClick={() => setSearchParams({ tab: 'non-mapped' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${currentTab === 'non-mapped'
            ? 'bg-primary/10 border border-primary/20 text-text shadow-[0_0_10px_rgba(var(--primary-rgb),0.15)]'
            : 'border border-transparent text-muted hover:text-text hover:bg-white/[0.02]'
            }`}
        >
          <Building2 size={14} />
          Non-Mapped Distributors
        </button>
      </div>

      {currentTab === 'non-mapped' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0 bg-glass-bg border border-glass-border rounded-3xl p-6">
          <NonMappedDistributors />
        </div>
      ) : currentTab === 'sent-history' ? (
        /* ── Full-Width Sent Orders History View ── */
        <div className="flex-1 flex flex-col overflow-hidden bg-glass-bg border border-glass-border rounded-3xl p-6 space-y-5 min-h-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-glass-border/40 pb-4">
            <div>
              <h3 className="text-base font-bold text-text uppercase tracking-wide flex items-center gap-2">
                <Send size={18} className="text-primary" />
                Sent Orders History
              </h3>
              <p className="text-xs text-muted mt-1">
                View all historical order dispatches grouped by date and distributor store
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs font-extrabold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={14} className="text-primary" /> Order Date:
              </label>
              <select
                value={selectedSentDate}
                onChange={(e) => setSelectedSentDate(e.target.value)}
                className="text-xs font-bold px-4 py-2 rounded-xl bg-bg border border-glass-border text-text focus:outline-none focus:border-primary shadow-sm min-w-[180px]"
              >
                {sentDates.length === 0 ? (
                  <option value="">No past sent orders found</option>
                ) : (
                  sentDates.map(d => (
                    <option key={d} value={d}>
                      {d} {d === new Date().toISOString().split('T')[0] ? '(Today)' : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            {sentOrdersLoading ? (
              <div className="text-center py-12 text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                Loading sent order history for {selectedSentDate}…
              </div>
            ) : sentOrders.length === 0 ? (
              <div className="text-center py-16 text-xs text-muted italic select-none">
                No order dispatches found for date {selectedSentDate || 'selected'}.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sentOrders.map((order: any) => (
                  <div key={order.id} className="p-4 rounded-2xl border border-glass-border/60 bg-bg/40 flex flex-col justify-between gap-3 shadow-md">
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
                      <div className="space-y-1.5 mt-3">
                        {Array.isArray(order.items) && order.items.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-xs text-text bg-bg2/30 p-2 rounded-lg border border-glass-border/20">
                            <span className="truncate pr-2 font-semibold">{item.productName || item.product || item.name}</span>
                            <span className="font-mono font-bold shrink-0 text-primary">x{item.qty || item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Footer Info & Action */}
                    <div className="flex items-center justify-between mt-2 text-[10px] text-muted pt-2 border-t border-glass-border/20">
                      <span className="font-mono">
                        Sent at: {order.placed_at ? new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                      </span>
                      <button
                        onClick={() => handleCopySentItemsToCart(order.items)}
                        disabled={readdingSentItems}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                        title="Copy these items back into current active cart"
                      >
                        <Plus size={12} /> Re-add to Active Cart
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                onClick={fetchCart}
                disabled={loading}
                className="p-2 rounded-lg bg-bg2 border border-glass-border text-muted hover:text-text hover:bg-bg3 transition-all active:scale-95 flex items-center justify-center disabled:opacity-50"
                title="Refresh Cart Contents"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin text-primary' : ''} />
              </button>

              <button
                onClick={() => handleSendAllWhatsAppOrders()}
                disabled={isSendingBatchWhatsApp || distributors.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 font-bold transition-all active:scale-95 text-xs disabled:opacity-50 shadow-sm"
                title="Send order messages silently to all saved distributor WhatsApp numbers with 30-45s safe delay"
              >
                {isSendingBatchWhatsApp ? (
                  <span className="w-3.5 h-3.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                ) : (
                  <MessageSquare size={13} />
                )}
                <span>
                  {batchCountdownSec !== null
                    ? `Next send in ${batchCountdownSec}s…`
                    : isSendingBatchWhatsApp
                      ? 'Sending orders…'
                      : `Send All via WhatsApp (${mappedDistributors.length})`}
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
                <div className="flex border-b border-glass-border/40 bg-bg3/10 shrink-0 select-none">
                  <button
                    onClick={() => setSidebarTab('requests')}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 ${sidebarTab === 'requests'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <Clock size={11} />
                    Requests ({pendingOrders.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('refills')}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 ${sidebarTab === 'refills'
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <ShoppingCart size={11} />
                    Refills ({pendingRefills.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('missing_phone' as any)}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1 ${sidebarTab === ('missing_phone' as any)
                      ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                      : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <Phone size={11} />
                    Missing Phone
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
                  {sidebarTab === 'requests' ? (
                    (() => {
                      const displayOrders = pendingOrders.filter(order => {
                        const inCart = getOrderItemInCart(order);
                        if (inCart && !showAddedItems) return false;
                        return true;
                      });

                      return displayOrders.length === 0 ? (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          {pendingOrders.length > 0 && !showAddedItems
                            ? 'All special requests have been added to the Pharmarack cart!'
                            : 'No pending special requests found.'}
                        </div>
                      ) : (
                        displayOrders.map(order => {
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
                                          className="text-[9px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded transition-all flex items-center gap-1 shadow-sm"
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
                                        className="text-[9px] font-bold bg-amber-500 hover:bg-amber-400 text-black px-2 py-0.5 rounded transition-all flex items-center gap-1 shadow-sm cursor-pointer"
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
                        })

                      );
                    })()
                  ) : sidebarTab === 'refills' ? (
                    (() => {
                      const displayRefills = pendingRefills.filter(refill => {
                        const inCart = getRefillItemInCart(refill);
                        if (inCart && !showAddedItems) return false;
                        return true;
                      });

                      return displayRefills.length === 0 ? (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          {pendingRefills.length > 0 && !showAddedItems
                            ? 'All refill medicines have been added to the Pharmarack cart!'
                            : 'No pending out-of-stock refill medicines due.'}
                        </div>
                      ) : (
                        displayRefills.map(refill => {
                          const inCart = getRefillItemInCart(refill);
                          const medName = refill.medicine_name || `Medicine ID: ${refill.medicine_id}`;
                          return (
                            <div
                              key={refill.id}
                              className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${inCart
                                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                }`}
                            >
                              <div className="flex justify-between items-start">
                                <div 
                                  className="flex flex-col min-w-0 cursor-pointer group"
                                  onClick={() => liveCartAddEvent.triggerOpen(medName, 1, undefined, refill.id)}
                                  title="Click to search in Pharmarack and add to cart"
                                >
                                  <span className={`text-[11px] font-bold truncate group-hover:underline ${inCart ? 'line-through opacity-65 text-emerald-400' : 'text-text'}`}>
                                    {medName}
                                  </span>
                                  <span className="text-[9px] text-muted mt-0.5 truncate">
                                    Patient: {refill.patient_name}
                                  </span>
                                  <span className="text-[8px] text-muted/80 font-mono mt-0.2">
                                    Due Date: {formatDisplayDate(refill.next_refill_date)}
                                  </span>
                                </div>
                                {inCart ? (
                                  <span className="shrink-0 text-[8px] font-extrabold uppercase bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/20 text-emerald-400 select-none">
                                    Added
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen(medName, 1, undefined, refill.id)}
                                    className="shrink-0 text-[9px] font-bold bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/30 px-2 py-1 rounded-md transition-all active:scale-95 text-amber-400 font-sans flex items-center gap-1 cursor-pointer"
                                    title="Open Medicine Search & Add to Pharmarack Live Cart"
                                  >
                                    <Search size={10} />
                                    <span>Search & Add</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      );
                    })()
                  ) : (
                    /* ── Missing Phone Distributors in Cart ── */
                    (() => {
                      const missingPhoneDistributors = distributors.filter(dist => {
                        let phoneNum = customDistributorPhones[dist.storeId];
                        if (!phoneNum) {
                          const matched = findSavedDistributorMatch(dist.storeName);
                          phoneNum = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
                        }
                        const cleanPhone = (phoneNum || '').replace(/\D/g, '');
                        return !cleanPhone || !isValidPhoneNumber(cleanPhone);
                      });

                      return missingPhoneDistributors.length === 0 ? (
                        <div className="text-center py-8 text-[11px] text-muted italic select-none">
                          All cart distributors have valid saved phone numbers!
                        </div>
                      ) : (
                        missingPhoneDistributors.map(dist => (
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
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold transition-all active:scale-95 shrink-0"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ))
                      );
                    })()
                  )}
                </div>
              </div>
            )}

            {/* Right Panel: Main live cart contents */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
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
                  {/* ── Sub-Filter Toggle Bar (All / Sent Successfully / Failed / Missing Phone) ── */}
                  <div className="flex items-center justify-between pb-2 border-b border-glass-border/30 shrink-0">
                    <div className="flex items-center gap-1.5 bg-bg2/40 p-1 rounded-xl border border-glass-border/40 text-xs font-bold select-none overflow-x-auto">
                      <button
                        onClick={() => setDistributorFilterTab('all')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${distributorFilterTab === 'all'
                          ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Building2 size={13} />
                        <span>All</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-bg/50 border border-glass-border/30 font-mono">
                          {distributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('success')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${distributorFilterTab === 'success'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Check size={13} className="text-emerald-400" />
                        <span>Sent Successfully</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold">
                          {successDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('failed')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${distributorFilterTab === 'failed'
                          ? 'bg-red/20 text-red border border-red/30 shadow-sm'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <AlertCircle size={13} className="text-red" />
                        <span>Failed / Unsent</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red/10 text-red border border-red/20 font-mono font-bold">
                          {failedDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('unmapped')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${distributorFilterTab === 'unmapped'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Phone size={13} className="text-amber-400" />
                        <span>Missing Phone</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                          {unmappedDistributors.length}
                        </span>
                      </button>
                    </div>
                  </div>

                  {filteredDistributorList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                      {distributorFilterTab === 'success' ? (
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
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
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
                            <span className="text-[10px] text-muted font-bold px-2 py-0.5 bg-bg/50 rounded-full border border-glass-border/30">
                              {dist.items.length} item{dist.items.length !== 1 ? 's' : ''}
                            </span>

                            {/* Button 1: Send to Delivery Boy via WhatsApp */}
                            <button
                              onClick={() => handleSendDeliveryBoyNotification(dist)}
                              disabled={sendingDeliveryBoyNotifId === dist.storeId}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm"
                              title="Manually trigger and send WhatsApp order notification to assigned Delivery Boy anytime"
                            >
                              {sendingDeliveryBoyNotifId === dist.storeId ? (
                                <span className="w-2.5 h-2.5 border border-teal-300/30 border-t-teal-300 rounded-full animate-spin" />
                              ) : (
                                <Truck size={11} className="text-teal-300" />
                              )}
                              <span>Send to Delivery Boy</span>
                            </button>

                            {/* Button 2: Send to Pharmarack Order */}
                            <button
                              onClick={() => handleSendManualNotification(dist)}
                              disabled={sendingNotifId === dist.storeId}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-sky/10 hover:bg-sky/20 text-sky border border-sky/30 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm"
                              title="Send notification / place order in Pharmarack"
                            >
                              {sendingNotifId === dist.storeId ? (
                                <span className="w-2.5 h-2.5 border border-sky/20 border-t-sky rounded-full animate-spin" />
                              ) : (
                                <Send size={10} />
                              )}
                              <span>Send to Pharmarack</span>
                            </button>

                            {/* Button 2: Send via WhatsApp */}
                            {(() => {
                              const isSending = sendingWaDistributorId === dist.storeId;
                              const status = sentWaStatusMap[dist.storeId];
                              let btnClass = "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/40";
                              if (status === 'success') btnClass = "bg-emerald-500 text-white border-emerald-600 animate-pulse";
                              if (status === 'queued') btnClass = "bg-amber-500/20 text-amber-300 border-amber-500/40";
                              if (status === 'error') btnClass = "bg-rose-500/20 text-rose-400 border-rose-500/40";

                              return (
                                <button
                                  onClick={() => handleSendWhatsAppOrder(dist)}
                                  disabled={isSending}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 ${btnClass}`}
                                  title="Send formatted order message directly to Distributor via WhatsApp"
                                >
                                  {isSending ? (
                                    <span className="w-2.5 h-2.5 border border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                                  ) : status === 'success' ? (
                                    <Check size={11} className="text-white animate-bounce" />
                                  ) : status === 'queued' ? (
                                    <Clock size={11} className="text-amber-300" />
                                  ) : status === 'error' ? (
                                    <AlertCircle size={11} className="text-rose-400" />
                                  ) : (
                                    <MessageSquare size={10} />
                                  )}
                                  <span>
                                    {isSending
                                      ? 'Sending...'
                                      : status === 'success'
                                        ? 'Sent!'
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
                                <th className="text-left px-4 py-2">Product</th>
                                <th className="text-left px-3 py-2">Company</th>
                                <th className="text-center px-3 py-2">Pack</th>
                                <th className="text-center px-3 py-2">Qty</th>
                                <th className="text-right px-3 py-2">PTR</th>
                                <th className="text-right px-3 py-2">MRP</th>
                                <th className="text-center px-3 py-2">Scheme</th>
                                <th className="text-center px-3 py-2">Stock</th>
                                <th className="text-right px-4 py-2">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-glass-border/15">
                              {dist.items.map((item, idx) => (
                                <tr key={`${item.productCode}-${idx}`} className="hover:bg-bg3/10 transition-colors">
                                  <td className="px-4 py-2.5">
                                    <div className="flex flex-col gap-1">
                                      <span className="font-bold text-text text-[11px]">{item.productName}</span>

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
                                    {item.amount > 0 ? `₹${item.amount.toFixed(2)}` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Distributor subtotal */}
                        {dist.lineTotal > 0 && (
                          <div className="border-t border-glass-border/30 px-4 py-2 bg-bg3/30 flex justify-end">
                            <span className="text-[10px] text-muted font-bold uppercase tracking-wider mr-3">Subtotal</span>
                            <span className="text-xs font-black text-emerald-400 font-mono">₹{dist.lineTotal.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
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
                onClick={() => setEditingDistributor(null)}
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
                  placeholder="e.g. 9822012345 or +919822012345"
                  value={modalPhoneInput}
                  onChange={(e) => setModalPhoneInput(e.target.value)}
                  className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text font-mono focus:outline-none focus:border-emerald-500 font-bold"
                />
                <p className="text-[10px] text-muted mt-1 font-medium">
                  10-digit mobile numbers will be formatted with +91 country code automatically.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="bg-bg3/40 px-6 py-3.5 border-t border-glass-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingDistributor(null)}
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
      )}

      {/* Missing Delivery Boy Confirmation Modal */}
      {showMissingBoyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg2 border border-glass-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
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
                    onChange={(e) => setQuickBoyPhone(e.target.value)}
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
        </div>
      )}
    </div>
  );
}
