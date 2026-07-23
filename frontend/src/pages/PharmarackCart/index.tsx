import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, ExternalLink, ShoppingCart, Package, AlertCircle, Truck, Clock, Send, Building2, MessageSquare, Phone, UserCheck, Search, Edit2, X, Plus, Check } from 'lucide-react';
import { formatDisplayDate } from '../../utils/date';
import { api, apiClient, type SpecialOrder, type Refill } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useSearchParams } from 'react-router-dom';
import NonMappedDistributors from '../NonMappedDistributors';

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
  // 1. Dispatch custom events and window.postMessage for Chrome / WhatsApp Web Extensions
  try {
    window.postMessage({
      type: 'WHATSAPP_WEB_EXTENSION_SEND',
      source: 'AI_PHARMACY',
      phone: phone || '',
      text: text || '',
      url
    }, '*');

    document.dispatchEvent(new CustomEvent('WHATSAPP_WEB_EXTENSION_SEND', {
      detail: { phone: phone || '', text: text || '', url }
    }));
  } catch (err) {
    console.warn('WhatsApp Extension dispatch warning:', err);
  }

  // 2. Reuse existing WhatsApp Web window or open a target tab
  try {
    if (waWindowRef && !waWindowRef.closed) {
      waWindowRef.location.href = url;
      waWindowRef.focus();
      return;
    }
  } catch (err) {
    console.warn('Could not navigate existing WhatsApp Web window handle:', err);
  }
  waWindowRef = window.open(url, 'whatsapp_web_tab');
  if (waWindowRef) {
    try {
      waWindowRef.focus();
    } catch (_) {}
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
  const [sidebarTab, setSidebarTab] = useState<'requests' | 'refills'>('requests');
  const [pendingRefills, setPendingRefills] = useState<Refill[]>(() => cachedPendingRefills);
  const [addingRefillId, setAddingRefillId] = useState<number | null>(null);

  const [isSendingBatchWhatsApp, setIsSendingBatchWhatsApp] = useState(false);
  const [sendingWaDistributorId, setSendingWaDistributorId] = useState<number | null>(null);
  
  // Persistent WhatsApp sent status map by storeId (preserves history across reloads & sessions)
  const [sentWaStatusMap, setSentWaStatusMap] = useState<Record<number, 'success' | 'queued' | 'error'>>(() => {
    try {
      const saved = localStorage.getItem('pharmacart_sent_wa_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.data === 'object') {
          return parsed.data;
        }
      }
    } catch (_) {}
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('pharmacart_sent_wa_history', JSON.stringify({
        timestamp: Date.now(),
        data: sentWaStatusMap
      }));
    } catch (_) {}
  }, [sentWaStatusMap]);

  // Saved distributor contacts and store settings
  const [savedDistributorsList, setSavedDistributorsList] = useState<any[]>([]);
  const [storeInfo, setStoreInfo] = useState<{ name: string; phone: string; address: string; email: string; deliveryBoyPhone: string; deliveryBoyPhone2: string }>({
    name: 'AI Pharmacy',
    phone: '',
    address: '',
    email: '',
    deliveryBoyPhone: '',
    deliveryBoyPhone2: ''
  });

  // Custom phone number override map by storeId (persisted to localStorage)
  const [customDistributorPhones, setCustomDistributorPhones] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('custom_distributor_phones');
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('custom_distributor_phones', JSON.stringify(customDistributorPhones));
    } catch (_) {}
  }, [customDistributorPhones]);

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

  const isDistributorMapped = (dist: Distributor) => {
    const custom = customDistributorPhones[dist.storeId];
    if (custom && custom.trim().length > 0) return true;

    const matched = findSavedDistributorMatch(dist.storeName);
    const phone = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
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

  useEffect(() => {
    // Fetch saved distributor directory (with phone numbers)
    api.getDistributors().then((res: any) => {
      if (Array.isArray(res)) {
        setSavedDistributorsList(res);
      } else if (Array.isArray(res?.data)) {
        setSavedDistributorsList(res.data);
      }
    }).catch(e => console.error('Failed to load saved distributors for WhatsApp matching:', e));

    // Fetch pharmacy settings (store name, phone, address, email, delivery boy whatsapp)
    apiClient.get('/settings').then(res => {
      if (res?.data) {
        setStoreInfo({
          name: res.data.shop_name || res.data.store_name || res.data.pharmacy_name || 'AI Pharmacy',
          phone: res.data.shop_phone || res.data.store_phone || res.data.pharmacy_phone || res.data.phone || '',
          address: res.data.shop_address || res.data.store_address || res.data.address || '',
          email: res.data.email || '',
          deliveryBoyPhone: res.data.delivery_boy_whatsapp || res.data.dinesh_whatsapp_number || '',
          deliveryBoyPhone2: res.data.delivery_boy_whatsapp_2 || res.data.admin_whatsapp || ''
        });
      }
    }).catch(e => console.error('Failed to load store info:', e));
  }, []);

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

  const getOrderItemInCart = (order: SpecialOrder) => {
    const orderNameNorm = order.product.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of distributors) {
      for (const item of dist.items) {
        const cartNameNorm = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cartNameNorm.includes(orderNameNorm) || orderNameNorm.includes(cartNameNorm)) {
          return item;
        }
      }
    }
    return null;
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

    const del1 = formatPhone((deliveryStaff as any)?.phone || (deliveryStaff as any)?.code || storeInfo.deliveryBoyPhone);
    const del2 = formatPhone(storeInfo.deliveryBoyPhone2);

    let msg = `🏬 *NEW STOCK ORDER — AI PHARMACY*\n\n`;
    msg += `📋 *Pharmacy Details:*\n`;
    msg += `• Store: *${storeInfo.name}*\n`;
    msg += `• Phone: *${storeInfo.phone || 'N/A'}*\n`;
    msg += `• Address: *${storeInfo.address || 'N/A'}*\n`;
    if (storeInfo.email) msg += `• Email: *${storeInfo.email}*\n`;

    // Delivery Boy Contacts section
    msg += `\n🛵 *Delivery Contact:*\n`;
    if (deliveryStaff?.name) {
      msg += `• Staff: *${deliveryStaff.name}*\n`;
    }
    if (del1) {
      msg += `• Delivery Boy 1: *${del1}*\n`;
    }
    if (del2) {
      msg += `• Delivery Boy 2: *${del2}*\n`;
    }
    if (!del1 && !del2) {
      msg += `• Phone: *${storeInfo.phone ? formatPhone(storeInfo.phone) : 'N/A'}*\n`;
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

  const handleSendWhatsAppOrder = async (dist: Distributor) => {
    let phoneNum = customDistributorPhones[dist.storeId];
    if (!phoneNum) {
      const matched = findSavedDistributorMatch(dist.storeName);
      phoneNum = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
    }

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

      if (res?.data?.success) {
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
        toastEvent.trigger(`WhatsApp order sent silently for ${dist.storeName}!`, 'success');
      } else {
        throw new Error(res?.data?.error || 'Silent send failed');
      }
    } catch (err: any) {
      console.warn('Silent WhatsApp send failed, using tab fallback:', err);
      // Fallback: reuse WhatsApp Web tab if silent send is unavailable
      const encodedMsg = encodeURIComponent(msg);
      const waWebUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
      openOrReuseWhatsappTab(waWebUrl, cleanPhone, msg);
      setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      toastEvent.trigger(`Opening WhatsApp Web for ${dist.storeName}...`, 'info');
    } finally {
      setSendingWaDistributorId(null);
    }
  };

  const handleSendAllWhatsAppOrders = async () => {
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
    let sentCount = 0;

    try {
      toastEvent.trigger(`Starting WhatsApp batch delivery for ${mapped.length} distributor(s) with 30-45s safe delay...`, 'info');
      
      for (let i = 0; i < mapped.length; i++) {
        const dist = mapped[i];
        let phoneNum = customDistributorPhones[dist.storeId];
        if (!phoneNum) {
          const matched = findSavedDistributorMatch(dist.storeName);
          phoneNum = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
        }
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
        setSendingWaDistributorId(dist.storeId);

        try {
          // Send silently via backend API
          const res = await apiClient.post('/messaging/send', {
            number: cleanPhone,
            message: msg
          });

          if (res?.data?.success) {
            setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
            toastEvent.trigger(`[${i + 1}/${mapped.length}] WhatsApp order sent for ${dist.storeName}!`, 'success');
            sentCount++;
          } else {
            throw new Error(res?.data?.error || 'Silent send failed');
          }
        } catch (e: any) {
          console.warn(`Batch silent send failed for ${dist.storeName}, trying tab fallback:`, e);
          try {
            const encodedMsg = encodeURIComponent(msg);
            const waWebUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
            openOrReuseWhatsappTab(waWebUrl, cleanPhone, msg);
            setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
            toastEvent.trigger(`[${i + 1}/${mapped.length}] Opened WhatsApp Web tab for ${dist.storeName}`, 'info');
            sentCount++;
          } catch (tabErr) {
            setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'error' }));
            toastEvent.trigger(`Failed to send order for ${dist.storeName}`, 'error');
          }
        } finally {
          setSendingWaDistributorId(null);
        }

        // 30–45 second safe randomized delay between distributor orders
        if (i < mapped.length - 1) {
          const delaySec = Math.floor(Math.random() * 16) + 30; // Random 30 to 45 seconds
          for (let sec = delaySec; sec > 0; sec--) {
            setBatchCountdownSec(sec);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          setBatchCountdownSec(null);
        }
      }

      if (sentCount > 0) {
        toastEvent.trigger(`Batch complete! Successfully sent ${sentCount} distributor order(s) via WhatsApp!`, 'success');
      }

      if (unmapped.length > 0) {
        toastEvent.trigger(`${unmapped.length} distributor(s) missing WhatsApp numbers. Please add phone numbers.`, 'info');
      }
    } catch (err: any) {
      console.error('Batch WhatsApp send error:', err);
      toastEvent.trigger(err?.message || 'Failed to send WhatsApp orders', 'error');
    } finally {
      setIsSendingBatchWhatsApp(false);
      setBatchCountdownSec(null);
    }
  };

  const handleOpenEditModal = (dist: Distributor) => {
    setEditingDistributor(dist);
    setModalSearchTerm(dist.storeName || '');

    // Check if phone override exists or find matched saved distributor
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
  };

  const handleSaveDistributorContact = async () => {
    if (!editingDistributor) return;
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

    // 2. Persist to database in background without blocking UI thread
    try {
      if (cleanPhone || selectedSavedDistId) {
        let saveSuccess = false;
        if (selectedSavedDistId) {
          try {
            await apiClient.put(`/settings/distributors/${selectedSavedDistId}`, {
              name: distName,
              phone: cleanPhone
            });
            saveSuccess = true;
          } catch (e) {
            console.warn('PUT distributor by ID failed, falling back to name upsert:', e);
          }
        }
        if (!saveSuccess) {
          await apiClient.post('/settings/distributors', {
            name: distName,
            phone: cleanPhone
          });
        }
      }

      // 3. Silently update saved distributors list in background
      try {
        const refreshList = await api.getDistributors();
        if (Array.isArray(refreshList)) {
          setSavedDistributorsList(refreshList);
        } else if (Array.isArray(refreshList?.data)) {
          setSavedDistributorsList(refreshList.data);
        }
      } catch (e) {
        console.warn('Silent refresh of saved distributors failed:', e);
      }
    } catch (err: any) {
      console.warn('Background save distributor contact error:', err);
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

  const totalProducts = distributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = distributors.reduce((s, d) => s + d.items.reduce((q, i) => q + i.qty, 0), 0);
  const totalAmount = distributors.reduce((s, d) => s + d.items.reduce((a, i) => a + i.amount, 0), 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg text-text gap-3 p-6 pb-4">
      {/* Page Tabs */}
      <div className="flex border-b border-glass-border bg-glass-bg backdrop-blur-xl shrink-0 rounded-xl overflow-hidden p-1 gap-1">
        <button
          onClick={() => setSearchParams({ tab: 'cart' })}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${currentTab === 'cart'
              ? 'bg-primary/10 border border-primary/20 text-text shadow-[0_0_10px_rgba(var(--primary-rgb),0.15)]'
              : 'border border-transparent text-muted hover:text-text hover:bg-white/[0.02]'
            }`}
        >
          <ShoppingCart size={14} />
          Pharmarack Cart
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
                onClick={handleSendAllWhatsAppOrders}
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
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 ${sidebarTab === 'requests'
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <Clock size={12} />
                    Requests ({pendingOrders.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab('refills')}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 ${sidebarTab === 'refills'
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                      }`}
                  >
                    <ShoppingCart size={12} />
                    Refills ({pendingRefills.length})
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {sidebarTab === 'requests' ? (
                    pendingOrders.length === 0 ? (
                      <div className="text-center py-8 text-[11px] text-muted italic select-none">
                        No pending special requests from yesterday or older.
                      </div>
                    ) : (
                      pendingOrders.map(order => {
                        const inCart = getOrderItemInCart(order);
                        return (
                          <div
                            key={order.id}
                            className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${inCart
                                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400'
                                : 'bg-red/10 border-red/20 text-red'
                              }`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col min-w-0">
                                <span className={`text-[11px] font-bold truncate ${inCart ? 'line-through opacity-65 text-emerald-400' : 'text-text'}`} title={order.product}>
                                  {order.product}
                                </span>
                                <span className="text-[9px] text-muted mt-0.5 truncate">
                                  Customer: {order.requester} (Qty: {order.qty})
                                </span>
                                <span className="text-[8px] text-muted/80 font-mono mt-0.2">
                                  Date: {formatDisplayDate(order.date)}
                                </span>
                              </div>
                              {inCart ? (
                                <span className="shrink-0 text-[8px] font-extrabold uppercase bg-emerald-500/25 px-1.5 py-0.5 rounded-md border border-emerald-500/20 text-emerald-400 select-none">
                                  Added
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleAddPendingToCart(order)}
                                  disabled={addingOrderId === order.id}
                                  className="shrink-0 text-[9px] font-bold bg-red/20 hover:bg-red/35 border border-red/30 px-2 py-0.5 rounded-md transition-all active:scale-95 text-red disabled:opacity-50 font-sans"
                                >
                                  {addingOrderId === order.id ? 'Adding...' : 'Add'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : (
                    pendingRefills.length === 0 ? (
                      <div className="text-center py-8 text-[11px] text-muted italic select-none">
                        No pending out-of-stock refill medicines due.
                      </div>
                    ) : (
                      pendingRefills.map(refill => {
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
                              <div className="flex flex-col min-w-0">
                                <span className={`text-[11px] font-bold truncate ${inCart ? 'line-through opacity-65 text-emerald-400' : 'text-text'}`} title={medName}>
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
                                  onClick={() => handleAddRefillToCart(refill)}
                                  disabled={addingRefillId === refill.id}
                                  className="shrink-0 text-[9px] font-bold bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/30 px-2 py-0.5 rounded-md transition-all active:scale-95 text-amber-500 disabled:opacity-50 font-sans"
                                >
                                  {addingRefillId === refill.id ? 'Adding...' : 'Add'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )
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
                              const custom = customDistributorPhones[dist.storeId];
                              const matched = savedDistributorsList.find(
                                (d: any) => d.name && dist.storeName && d.name.trim().toLowerCase() === dist.storeName.trim().toLowerCase()
                              );
                              const activePhone = custom || matched?.phone || matched?.mobile || matched?.whatsapp || '';

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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
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
              {/* Search / Select Saved Distributor Contact */}
              <div>
                <label className="block text-xs font-bold text-muted mb-1.5">
                  Link to Saved Directory Distributor
                </label>
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
    </div>
  );
}
