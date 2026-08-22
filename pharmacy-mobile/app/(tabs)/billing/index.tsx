import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { colors, spacing, typography, radius, shadows } from '../../../lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  searchMedicine,
  createSale,
  SearchMedicineResult,
  fetchCustomers,
  createCustomer,
  createSpecialOrder,
  CustomerData,
  getCachedInventory,
  getInventory,
  getOrders,
  updateOrderStatus,
  getOfflineOrderStatusQueue,
  SpecialOrder,
  fetchRecentSales,
  RecentSale,
  SalePayload,
  getOfflineSalesQueue,
  getDeviceIdentity,
} from '../../../lib/api';
import { useFocusEffect } from '@react-navigation/native';
import UpwardSearchDropdown from '../../../components/UpwardSearchDropdown';
import ProductListPanel from '../../../components/ProductListPanel';
import SwipeToDelete from '../../../components/SwipeToDelete';
import { sanitizePhoneInput } from '../../../lib/helpers';

const CART_STATE_KEY = 'billing_cart_state';
const PENDING_ORDERS_CACHE_KEY = 'cached_special_orders';

export interface EnhancedCartEntry extends SearchMedicineResult {
  strip_qty: number;
  loose_qty: number;
  selected_batch: string;
  available_batches: { batch_no: string; expiry_date?: string; stock: number; mrp: number }[];
  is_collapsed: boolean;
}

export default function BillingScreen() {
  const scrollViewRef = useRef<ScrollView>(null);
  const hydratedRef = useRef(false);

  // Mode selection: DIRECT | CREDIT | SPECIAL
  const [saleMode, setSaleMode] = useState<'DIRECT' | 'CREDIT' | 'SPECIAL'>('DIRECT');

  // Step toggle state
  const [skipSteps, setSkipSteps] = useState(true);

  // Customer & Doctor info
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [, setSelectedCustomer] = useState<CustomerData | null>(null);

  // Customer autocomplete dropdown state
  const [, setCustomerSearchQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerData[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Add new customer modal state
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  // Medicine search & Upward dropdown state
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState<SearchMedicineResult[]>([]);
  const [showMedicineDropdown, setShowMedicineDropdown] = useState(false);

  // Cart & Batch selection
  const [cart, setCart] = useState<EnhancedCartEntry[]>([]);
  const [batchPickerItem, setBatchPickerItem] = useState<EnhancedCartEntry | null>(null);

  // Product List panel state
  const [showProductList, setShowProductList] = useState(false);
  const [productCache, setProductCache] = useState<SearchMedicineResult[]>([]);
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>([]);
  const [refreshingPending, setRefreshingPending] = useState(false);
  const [offlineStatusCount, setOfflineStatusCount] = useState(0);

  // Sales History Drawer state
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loadingSalesHistory, setLoadingSalesHistory] = useState(false);
  // This-device bill tracking
  const [pendingBills, setPendingBills] = useState<SalePayload[]>([]);
  const [deviceLabel, setDeviceLabel] = useState('');

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Discount section
  const [discountType, setDiscountType] = useState<'percent' | 'flat'>('flat');
  const [discountValue, setDiscountValue] = useState('');

  // Special Request Mode form
  const [specialProduct, setSpecialProduct] = useState('');
  const [specialQty, setSpecialQty] = useState('1');
  const [specialPriority, setSpecialPriority] = useState<'NORMAL' | 'URGENT' | 'HIGH'>('NORMAL');

  // Submission & Success state
  const [submitting, setSubmitting] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<{
    invoice_no: string;
    total: number;
    mode: string;
    isOffline?: boolean;
  } | null>(null);

  // Load Sales History when opening drawer
  const handleOpenSalesHistory = async () => {
    setShowSalesHistory(true);
    setLoadingSalesHistory(true);
    try {
      const [sales, queue, identity] = await Promise.all([
        fetchRecentSales(25),
        getOfflineSalesQueue(),
        getDeviceIdentity(),
      ]);
      setRecentSales(sales);
      setPendingBills(queue);
      setDeviceLabel(identity.name);
    } catch {
      setRecentSales([]);
    } finally {
      setLoadingSalesHistory(false);
    }
  };

  // ─── Mount Hydration (instant paint from local caches) ───────────────────

  useEffect(() => {
    (async () => {
      // 1. Product list cache + silent server refresh
      const cached = await getCachedInventory();
      setProductCache(cached);
      getInventory()
        .then(() => getCachedInventory())
        .then(fresh => {
          if (fresh.length > 0) setProductCache(fresh);
        })
        .catch(() => {});

      // 2. Pending special orders cache + silent refresh
      try {
        const cachedOrders = await AsyncStorage.getItem(PENDING_ORDERS_CACHE_KEY);
        if (cachedOrders) setPendingOrders(JSON.parse(cachedOrders));
      } catch {}
      refreshPendingOrders().catch(() => {});

      // 3. Offline status queue count
      getOfflineOrderStatusQueue()
        .then(q => setOfflineStatusCount(q.length))
        .catch(() => {});

      // 4. Restore persisted bill (survives app kill mid-sale)
      try {
        const savedCartState = await AsyncStorage.getItem(CART_STATE_KEY);
        if (savedCartState) {
          const parsed = JSON.parse(savedCartState);
          if (Array.isArray(parsed.cart) && parsed.cart.length > 0) {
            setCart(parsed.cart);
            if (parsed.saleMode) setSaleMode(parsed.saleMode);
            if (parsed.patientName) setPatientName(parsed.patientName);
            if (parsed.patientPhone) setPatientPhone(parsed.patientPhone);
            if (parsed.discountType) setDiscountType(parsed.discountType);
            if (parsed.discountValue) setDiscountValue(parsed.discountValue);
          }
        }
      } catch {}
      hydratedRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPendingOrders = async () => {
    setRefreshingPending(true);
    try {
      const orders = await getOrders();
      setPendingOrders(orders);
      await AsyncStorage.setItem(PENDING_ORDERS_CACHE_KEY, JSON.stringify(orders));
    } catch {
      // keep cached orders on failure
    } finally {
      setRefreshingPending(false);
    }
  };

  const handleMarkReady = async (order: SpecialOrder) => {
    try {
      const res = await updateOrderStatus(order.id, 'Ready');
      if (res.isOffline) {
        showToast('Marked Ready (Offline) — will sync & send message on reconnect');
      } else if (res.whatsapp_queued) {
        showToast(`✅ ${order.product || 'Order'} marked Ready — arrival WhatsApp queued`);
      } else {
        showToast(`${order.product || 'Order'} marked Ready`);
      }
      getOfflineOrderStatusQueue()
        .then(q => setOfflineStatusCount(q.length))
        .catch(() => {});
      refreshPendingOrders();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to mark order Ready');
    }
  };

  // ─── Cart Persistence (auto-save on every change) ────────────────────────

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(
      CART_STATE_KEY,
      JSON.stringify({ cart, saleMode, patientName, patientPhone, discountType, discountValue })
    ).catch(() => {});
  }, [cart, saleMode, patientName, patientPhone, discountType, discountValue]);

  // ─── Refill "Sell Now" handoff: drain queued items when tab gains focus ──

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const queued = await AsyncStorage.getItem('billing_cart_add_queue');
          if (!queued) return;
          await AsyncStorage.removeItem('billing_cart_add_queue');
          const items: SearchMedicineResult[] = JSON.parse(queued);
          for (const item of items) {
            await addToCart(item);
          }
          if (items.length > 0) {
            showToast(`🧺 ${items.length} refill medicine${items.length !== 1 ? 's' : ''} added to bill`);
            setSaleMode('DIRECT');
          }
        } catch {}
      })();
    }, [])
  );

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // ─── Customer Search Handler ──────────────────────────────────────────────

  const handleCustomerSearch = async (text: string) => {
    setCustomerSearchQuery(text);
    setPatientName(text);
    if (text.trim().length >= 2) {
      try {
        const data = await fetchCustomers(text);
        setCustomerResults(data);
        setShowCustomerDropdown(true);
      } catch {
        setCustomerResults([]);
      }
    } else {
      setCustomerResults([]);
      setShowCustomerDropdown(false);
    }
  };

  const selectCustomerItem = (cust: CustomerData) => {
    setSelectedCustomer(cust);
    setPatientName(cust.name);
    setPatientPhone(cust.phone || '');
    setCustomerSearchQuery(cust.name);
    setShowCustomerDropdown(false);
  };

  const handleSaveNewCustomer = async () => {
    if (!newCustName.trim()) {
      Alert.alert('Required', 'Please enter customer name');
      return;
    }
    try {
      const created = await createCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
      });
      setSelectedCustomer(created);
      setPatientName(created.name);
      setPatientPhone(created.phone || '');
      setShowAddCustomerModal(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      showToast(`Customer ${created.name} registered.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to add customer');
    }
  };

  // ─── Medicine Search Handler ─────────────────────────────────────────────

  const handleMedicineSearch = useCallback(async (text: string) => {
    setMedicineQuery(text);
    if (text.length < 2) {
      setMedicineResults([]);
      setShowMedicineDropdown(false);
      return;
    }
    try {
      const data = await searchMedicine(text);
      setMedicineResults(data);
      setShowMedicineDropdown(data.length > 0);
    } catch {
      const cache = await getCachedInventory();
      const lower = text.toLowerCase();
      const filtered = cache.filter(c => c.medicine_name.toLowerCase().includes(lower));
      setMedicineResults(filtered);
      setShowMedicineDropdown(filtered.length > 0);
    }
  }, []);

  // ─── Cart Management ─────────────────────────────────────────────────────

  const addToCart = async (item: SearchMedicineResult) => {
    const isOutOfStock = (item.quantity || 0) <= 0;

    if (isOutOfStock) {
      Alert.alert(
        'Out of Stock',
        `"${item.medicine_name}" is currently out of physical stock. Would you like to log a Special Request Order for this medicine?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: '⚡ Create Special Request',
            onPress: () => {
              setSaleMode('SPECIAL');
              setSpecialProduct(item.medicine_name);
              setMedicineQuery('');
              setShowMedicineDropdown(false);
            },
          },
        ]
      );
      return;
    }

    const allInventory = await getCachedInventory();
    const sameMedicineBatches = allInventory.filter(
      b => b.medicine_name.toLowerCase() === item.medicine_name.toLowerCase() && b.quantity > 0
    );

    const availableBatches = sameMedicineBatches.length > 0
      ? sameMedicineBatches.map(b => ({
          batch_no: b.batch_no || '',
          expiry_date: b.expiry_date,
          stock: b.quantity,
          mrp: b.mrp || b.unit_price || 0,
        }))
      : [
          {
            batch_no: item.batch_no || '',
            expiry_date: item.expiry_date,
            stock: item.quantity,
            mrp: item.mrp || item.unit_price || 0,
          },
        ];

    setCart(currentCart => {
      // Mark existing items as collapsed so the view remains high-density
      const collapsedCurrent = currentCart.map(c => ({ ...c, is_collapsed: true }));
      const existing = collapsedCurrent.find(c => c.inventory_id === item.inventory_id);

      if (existing) {
        return collapsedCurrent.map(c =>
          c.inventory_id === item.inventory_id
            ? { ...c, strip_qty: c.strip_qty + 1, is_collapsed: false }
            : c
        );
      } else {
        return [
          ...collapsedCurrent,
          {
            ...item,
            strip_qty: 1,
            loose_qty: 0,
            selected_batch: item.batch_no || '',
            available_batches: availableBatches,
            is_collapsed: false, // newly added item starts open for quick fine-tuning
          },
        ];
      }
    });

    setMedicineQuery('');
    setShowMedicineDropdown(false);

    // Auto-scroll to bottom so the user sees the newly added item instantly!
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const updateCartStripQty = (inventoryId: number, qty: number) => {
    if (qty < 0) return;
    setCart(currentCart =>
      currentCart.map(c => {
        if (c.inventory_id === inventoryId) {
          const newStrip = Math.max(0, qty);
          if (newStrip === 0 && c.loose_qty === 0) return null; // remove if both 0
          return { ...c, strip_qty: newStrip };
        }
        return c;
      }).filter(Boolean) as EnhancedCartEntry[]
    );
  };

  const updateCartLooseQty = (inventoryId: number, qty: number) => {
    if (qty < 0) return;
    setCart(currentCart =>
      currentCart.map(c => {
        if (c.inventory_id === inventoryId) {
          const newLoose = Math.max(0, qty);
          if (newLoose === 0 && c.strip_qty === 0) return null; // remove if both 0
          return { ...c, loose_qty: newLoose };
        }
        return c;
      }).filter(Boolean) as EnhancedCartEntry[]
    );
  };

  const toggleCartCollapse = (inventoryId: number) => {
    setCart(currentCart =>
      currentCart.map(c =>
        c.inventory_id === inventoryId ? { ...c, is_collapsed: !c.is_collapsed } : c
      )
    );
  };

  const changeBatch = (inventoryId: number, newBatchNo: string) => {
    setCart(currentCart =>
      currentCart.map(c => {
        if (c.inventory_id === inventoryId) {
          const match = c.available_batches.find(b => b.batch_no === newBatchNo);
          return {
            ...c,
            selected_batch: newBatchNo,
            mrp: match ? match.mrp : c.mrp,
          };
        }
        return c;
      })
    );
    setBatchPickerItem(null);
  };

  const removeFromCart = (inventoryId: number) => {
    setCart(currentCart => currentCart.filter(c => c.inventory_id !== inventoryId));
  };

  // Calculate item total considering strips + loose doses
  const getItemTotal = (item: EnhancedCartEntry) => {
    const itemPackSize = (item as any).pack_size || (item as any).unit;
    const packMultiplier = itemPackSize ? parseInt(String(itemPackSize), 10) || 1 : 1;
    const fullMrp = item.mrp || item.unit_price || 0;
    const loosePrice = fullMrp / packMultiplier;

    return (item.strip_qty * fullMrp) + (item.loose_qty * loosePrice);
  };

  // Subtotal across all cart items
  const subtotal = cart.reduce((sum, item) => sum + getItemTotal(item), 0);

  const parsedDiscountVal = parseFloat(discountValue) || 0;
  const calculatedDiscount =
    discountType === 'percent'
      ? (subtotal * parsedDiscountVal) / 100
      : parsedDiscountVal;

  const cartTotal = Math.max(0, subtotal - calculatedDiscount);

  // ─── Checkout & Order Submit ─────────────────────────────────────────────

  const handleCheckout = async () => {
    if (saleMode === 'SPECIAL') {
      if (!specialProduct.trim()) {
        Alert.alert('Required', 'Please enter medicine name for special request.');
        return;
      }
      setSubmitting(true);
      try {
        const res = await createSpecialOrder({
          product: specialProduct.trim(),
          requester: patientName.trim() || 'Mobile App',
          phone: patientPhone.trim(),
          qty: parseInt(specialQty, 10) || 1,
          priority: specialPriority,
        });

        const reqTitle = `Special Request Logged (${res.isOffline ? 'Offline' : 'PC Synced'})`;
        showToast(reqTitle);

        setInvoiceResult({
          invoice_no: `SPEC-REQ-#${res.id || Math.floor(Math.random() * 9000 + 1000)}`,
          total: 0,
          mode: 'Special Request',
          isOffline: res.isOffline,
        });

        Notifications.scheduleNotificationAsync({
          content: {
            title: '⚡ Special Request Logged',
            body: `Order for "${specialProduct.trim()}" sent to PC Quick Assist panel.`,
          },
          trigger: null,
        }).catch(() => {});

        setSpecialProduct('');
        setSpecialQty('1');
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to submit special request order.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Direct / Credit Sale
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Please search and add medicines to the cart first.');
      return;
    }

    if (saleMode === 'CREDIT') {
      if (!patientName.trim()) {
        Alert.alert('Customer Required', 'Credit sales require a registered or entered customer name.');
        return;
      }
      if (sanitizePhoneInput(patientPhone).length !== 10) {
        Alert.alert('Phone Required', 'Credit sales require a valid 10-digit customer phone number.');
        return;
      }
    }

    for (const c of cart) {
      if (!c.inventory_id || !c.selected_batch || !c.selected_batch.trim()) {
        Alert.alert('Batch Required', `Please select a valid inventory batch for "${c.medicine_name}".`);
        return;
      }
      if (c.strip_qty <= 0 && c.loose_qty <= 0) {
        Alert.alert('Quantity Required', `Please specify a valid quantity for "${c.medicine_name}".`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Map items for backend: convert strip_qty and loose_qty into unit fraction if needed
      const itemsPayload = cart.map(c => {
        const itemPackSize = (c as any).pack_size || (c as any).unit;
        const packMultiplier = itemPackSize ? parseInt(String(itemPackSize), 10) || 1 : 1;
        const totalEquivalentStrips = c.strip_qty + (c.loose_qty / packMultiplier);

        return {
          inventory_id: c.inventory_id,
          quantity: Number(totalEquivalentStrips.toFixed(2)),
          unit_price: Number(c.mrp || c.unit_price || 0),
        };
      });

      const res = await createSale({
        items: itemsPayload,
        patient_name: patientName.trim() || undefined,
        patient_phone: patientPhone.trim() || undefined,
        discount: calculatedDiscount,
        payment_medium: saleMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        payment_status: saleMode === 'CREDIT' ? 'UNPAID' : 'PAID',
      });

      showToast(`⚡ Bill Saved! Invoice ${res.invoice_no} (₹${res.total.toFixed(2)})`);

      setInvoiceResult({
        invoice_no: res.invoice_no,
        total: res.total,
        mode: saleMode === 'CREDIT' ? 'Credit Sale' : 'Direct Cash Sale',
      });

      Notifications.scheduleNotificationAsync({
        content: {
          title: `⚡ Bill Completed (${saleMode === 'CREDIT' ? 'Credit' : 'Cash'})`,
          body: `Invoice ${res.invoice_no} created for ₹${res.total.toFixed(2)}.`,
        },
        trigger: null,
      }).catch(() => {});

      setCart([]);
      setPatientName('');
      setPatientPhone('');
      setDoctorName('');
      setSelectedCustomer(null);
      setDiscountValue('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create sale');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Success Screen Component ────────────────────────────────────────────

  if (invoiceResult) {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={68} color={colors.success} />
        </View>
        <Text style={typography.h2}>
          {invoiceResult.mode === 'Special Request'
            ? 'Request Sent to PC!'
            : 'Transaction Complete!'}
        </Text>
        <Text style={[typography.body, { marginTop: 4, color: colors.textSecondary }]}>
          Mode: <Text style={{ fontWeight: '700', color: colors.primary }}>{invoiceResult.mode}</Text>
        </Text>

        {invoiceResult.invoice_no ? (
          <Text style={[typography.body, { marginTop: 4 }]}>
            Reference: {invoiceResult.invoice_no}
          </Text>
        ) : null}

        {invoiceResult.total > 0 && (
          <Text style={[typography.h3, { color: colors.accent, marginTop: spacing.xs }]}>
            ₹{invoiceResult.total.toFixed(2)}
          </Text>
        )}

        {invoiceResult.isOffline && (
          <View style={styles.offlineAlertBadge}>
            <Ionicons name="cloud-offline" size={14} color={colors.warning} />
            <Text style={styles.offlineAlertText}>Saved Offline — Auto-syncing to PC</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <TouchableOpacity
            style={styles.historySecondaryBtn}
            onPress={() => {
              setInvoiceResult(null);
              handleOpenSalesHistory();
            }}
          >
            <Ionicons name="receipt-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.historySecondaryBtnText}>View Sales Log</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.newBillBtn} onPress={() => setInvoiceResult(null)}>
            <LinearGradient
              colors={[colors.primary, colors.primaryDark]}
              style={styles.newBillGradient}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.newBillText}>Start New Order</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Main View Render ─────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Toast Notification Header Banner */}
      {toastMessage && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.toastBannerText}>{toastMessage}</Text>
        </View>
      )}

      {/* Ultra-Compact Top Header Bar & Mode Selector */}
      <View style={styles.compactHeaderBar}>
        <View style={styles.modeSelectorBar}>
          <TouchableOpacity
            style={[styles.modeTab, saleMode === 'DIRECT' && styles.modeTabActive]}
            onPress={() => setSaleMode('DIRECT')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="cart"
              size={13}
              color={saleMode === 'DIRECT' ? '#fff' : colors.textMuted}
            />
            <Text style={[styles.modeTabText, saleMode === 'DIRECT' && styles.modeTabTextActive]}>
              Direct
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, saleMode === 'CREDIT' && styles.modeTabActiveCredit]}
            onPress={() => setSaleMode('CREDIT')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="card"
              size={13}
              color={saleMode === 'CREDIT' ? '#fff' : colors.textMuted}
            />
            <Text style={[styles.modeTabText, saleMode === 'CREDIT' && styles.modeTabTextActive]}>
              Credit
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeTab, saleMode === 'SPECIAL' && styles.modeTabActiveSpecial]}
            onPress={() => setSaleMode('SPECIAL')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="flash"
              size={13}
              color={saleMode === 'SPECIAL' ? '#fff' : colors.textMuted}
            />
            <Text style={[styles.modeTabText, saleMode === 'SPECIAL' && styles.modeTabTextActive]}>
              Shortage
            </Text>
          </TouchableOpacity>
        </View>

        {/* View Phone Bills + Product List Buttons */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity
            style={styles.salesHistoryHeaderBtn}
            onPress={() => setShowProductList(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="list" size={14} color={colors.primary} />
            <Text style={styles.salesHistoryHeaderText}>Products</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.salesHistoryHeaderBtn}
            onPress={handleOpenSalesHistory}
            activeOpacity={0.8}
          >
            <Ionicons name="receipt" size={14} color={colors.primary} />
            <Text style={styles.salesHistoryHeaderText}>Phone Bills</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* SPECIAL REQUEST ORDER FORM */}
        {saleMode === 'SPECIAL' ? (
          <View style={styles.specialOrderCard}>
            <View style={styles.specialCardHeader}>
              <Ionicons name="desktop" size={18} color={colors.accent} />
              <Text style={styles.specialCardTitle}>Sync Order to PC Quick Assist Panel</Text>
            </View>

            <Text style={styles.inputLabel}>MEDICINE NAME *</Text>
            <TextInput
              style={styles.textInputCompact}
              value={specialProduct}
              onChangeText={setSpecialProduct}
              placeholder="e.g. CROCIN 650 MG or ONDEM MD 4"
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.rowTwoCols}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>REQUESTER NAME</Text>
                <TextInput
                  style={styles.textInputCompact}
                  value={patientName}
                  onChangeText={setPatientName}
                  placeholder="Customer Name"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>QUANTITY</Text>
                <TextInput
                  style={styles.textInputCompact}
                  value={specialQty}
                  onChangeText={setSpecialQty}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
            </View>

            <Text style={styles.inputLabel}>PRIORITY</Text>
            <View style={styles.priorityRow}>
              {(['NORMAL', 'HIGH', 'URGENT'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityChip,
                    specialPriority === p && styles.priorityChipActive,
                  ]}
                  onPress={() => setSpecialPriority(p)}
                >
                  <Text
                    style={[
                      styles.priorityText,
                      specialPriority === p && styles.priorityTextActive,
                    ]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          /* REGULAR DIRECT OR CREDIT SALE FORM */
          <>
            {/* Step Header: Customer Details & Doctor with Skip Option */}
            <View style={styles.stepCardCompact}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepTitleCompact}>
                  1. CUSTOMER {saleMode === 'CREDIT' ? '*' : '(OPTIONAL)'}
                </Text>
                <TouchableOpacity
                  style={styles.skipToggleBtn}
                  onPress={() => setSkipSteps(!skipSteps)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={skipSteps ? 'eye-outline' : 'flash-outline'}
                    size={12}
                    color={colors.primary}
                  />
                  <Text style={styles.skipToggleText}>
                    {skipSteps ? 'Show Info' : '⚡ Quick Mode'}
                  </Text>
                </TouchableOpacity>
              </View>

              {!skipSteps && (
                <View style={styles.stepFieldsContainer}>
                  {/* Patient Name with Autocomplete */}
                  <View style={{ zIndex: 10 }}>
                    <View style={styles.inputWithIconRow}>
                      <TextInput
                        style={[styles.textInputCompact, { flex: 1 }]}
                        value={patientName}
                        onChangeText={handleCustomerSearch}
                        placeholder="Search or enter customer name..."
                        placeholderTextColor={colors.textMuted}
                      />
                      <TouchableOpacity
                        style={styles.addCustomerInlineBtn}
                        onPress={() => setShowAddCustomerModal(true)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="person-add" size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>

                    {/* Upward Customer Dropdown */}
                    <UpwardSearchDropdown
                      visible={showCustomerDropdown}
                      type="customer"
                      customerResults={customerResults}
                      onSelectCustomer={selectCustomerItem}
                      onAddNewCustomer={() => {
                        setShowCustomerDropdown(false);
                        setShowAddCustomerModal(true);
                      }}
                      onClose={() => setShowCustomerDropdown(false)}
                      maxHeight={180}
                    />
                  </View>

                  <View style={styles.rowTwoCols}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={styles.textInputCompact}
                        value={patientPhone}
                        onChangeText={setPatientPhone}
                        placeholder="Phone No."
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={styles.textInputCompact}
                        value={doctorName}
                        onChangeText={setDoctorName}
                        placeholder="Dr. Name"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Medicine Search Section with Upward Floating Scrollable Dropdown */}
            <View style={styles.searchSectionCompact}>
              {/* Upward Floating Dropdown Modal */}
              <UpwardSearchDropdown
                visible={showMedicineDropdown}
                type="medicine"
                medicineResults={medicineResults}
                onSelectMedicine={addToCart}
                onClose={() => setShowMedicineDropdown(false)}
                maxHeight={260}
              />

              <View style={styles.searchBarWrapperCompact}>
                <Ionicons name="search" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.searchInputCompact}
                  value={medicineQuery}
                  onChangeText={handleMedicineSearch}
                  placeholder="Search medicine by name, batch, MRP..."
                  placeholderTextColor={colors.textMuted}
                />
                {medicineQuery ? (
                  <TouchableOpacity onPress={() => handleMedicineSearch('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Cart Items List — High Density (4+ items fit on screen) */}
            <View style={styles.cartSectionCompact}>
              <View style={styles.cartHeaderRow}>
                <Text style={styles.cartSectionTitle}>
                  BILL ITEMS ({cart.length})
                </Text>
                {cart.length > 0 && (
                  <Text style={styles.subtotalHintText}>
                    Subtotal: ₹{subtotal.toFixed(2)}
                  </Text>
                )}
              </View>

              {cart.length === 0 ? (
                <View style={styles.emptyCartCompact}>
                  <Ionicons name="medkit-outline" size={32} color={colors.textMuted} />
                  <Text style={styles.emptyCartTextCompact}>
                    Search medicine above to add to bill
                  </Text>
                </View>
              ) : (
                cart.map((item, index) => {
                  const itemPackSize = (item as any).pack_size || (item as any).unit;
                  const packMultiplier = itemPackSize
                    ? parseInt(String(itemPackSize), 10) || 1
                    : 1;
                  const fullMrp = item.mrp || item.unit_price || 0;
                  const looseUnitPrice = fullMrp / packMultiplier;
                  const itemTotal = getItemTotal(item);

                  // Render COLLAPSED item strip for ultra high screen density
                  if (item.is_collapsed) {
                    return (
                      <SwipeToDelete
                        key={`cart-${item.inventory_id}-${index}`}
                        onDelete={() => removeFromCart(item.inventory_id)}
                      >
                        <TouchableOpacity
                          style={styles.collapsedCartRow}
                          onPress={() => toggleCartCollapse(item.inventory_id)}
                          activeOpacity={0.8}
                        >
                          <View style={{ flex: 1, paddingRight: 6 }}>
                            <Text style={styles.collapsedMedName} numberOfLines={1}>
                              {item.medicine_name}
                            </Text>
                            <Text style={styles.collapsedQtyMeta}>
                              📦 {item.strip_qty} strip{item.strip_qty !== 1 ? 's' : ''}
                              {item.loose_qty > 0 ? ` + 💊 ${item.loose_qty} loose` : ''} | Batch: {item.selected_batch}
                            </Text>
                          </View>

                          <Text style={styles.collapsedPriceText}>₹{itemTotal.toFixed(2)}</Text>

                          <TouchableOpacity
                            onPress={() => removeFromCart(item.inventory_id)}
                            style={{ paddingHorizontal: 10, paddingVertical: 12 }}
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.danger} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      </SwipeToDelete>
                    );
                  }

                  // Render EXPANDED item card for editing strips & loose dose quantities side-by-side
                  return (
                    <SwipeToDelete
                      key={`cart-${item.inventory_id}-${index}`}
                      onDelete={() => removeFromCart(item.inventory_id)}
                    >
                    <View style={styles.expandedCartCard}>
                      <View style={styles.cartCardHeader}>
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => toggleCartCollapse(item.inventory_id)}
                        >
                          <Text style={styles.cartMedicineName} numberOfLines={1}>
                            {item.medicine_name}
                          </Text>
                          <Text style={styles.cartMedicineMeta}>
                            Box MRP: ₹{fullMrp.toFixed(2)} | Loose: ₹{looseUnitPrice.toFixed(2)}/tab | Pack: {packMultiplier}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => setBatchPickerItem(item)}
                          style={styles.batchBadgeBtn}
                        >
                          <Text style={styles.batchBadgeText}>Batch: {item.selected_batch}</Text>
                          <Ionicons name="chevron-down" size={10} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => removeFromCart(item.inventory_id)}
                          style={{ paddingHorizontal: 10, paddingVertical: 12 }}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      </View>

                      {/* Side-by-Side Dual Steppers: Strips Column vs Loose Tablets Column */}
                      <View style={styles.sideBySideSteppersRow}>
                        {/* Column 1: STRIP QUANTITY */}
                        <View style={styles.stepperCol}>
                          <Text style={styles.stepperColLabel}>📦 STRIPS</Text>
                          <View style={styles.stepperControlContainer}>
                            <TouchableOpacity
                              style={styles.stepperBtn}
                              onPress={() => updateCartStripQty(item.inventory_id, item.strip_qty - 1)}
                            >
                              <Ionicons name="remove" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                            <TextInput
                              style={styles.stepperInputText}
                              value={String(item.strip_qty)}
                              onChangeText={v => updateCartStripQty(item.inventory_id, parseInt(v, 10) || 0)}
                              keyboardType="numeric"
                            />
                            <TouchableOpacity
                              style={styles.stepperBtn}
                              onPress={() => updateCartStripQty(item.inventory_id, item.strip_qty + 1)}
                            >
                              <Ionicons name="add" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Column 2: LOOSE TABLETS (DOSE) QUANTITY */}
                        <View style={styles.stepperCol}>
                          <Text style={styles.stepperColLabel}>💊 LOOSE (TABS)</Text>
                          <View style={styles.stepperControlContainer}>
                            <TouchableOpacity
                              style={styles.stepperBtn}
                              onPress={() => updateCartLooseQty(item.inventory_id, item.loose_qty - 1)}
                            >
                              <Ionicons name="remove" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                            <TextInput
                              style={styles.stepperInputText}
                              value={String(item.loose_qty)}
                              onChangeText={v => updateCartLooseQty(item.inventory_id, parseInt(v, 10) || 0)}
                              keyboardType="numeric"
                            />
                            <TouchableOpacity
                              style={styles.stepperBtn}
                              onPress={() => updateCartLooseQty(item.inventory_id, item.loose_qty + 1)}
                            >
                              <Ionicons name="add" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* Column 3: Item Total */}
                        <View style={styles.itemTotalCol}>
                          <Text style={styles.stepperColLabel}>ITEM TOTAL</Text>
                          <Text style={styles.itemTotalPriceText}>₹{itemTotal.toFixed(2)}</Text>
                        </View>
                      </View>
                    </View>
                    </SwipeToDelete>
                  );
                })
              )}
            </View>

            {/* Discount Section */}
            {cart.length > 0 && (
              <View style={styles.discountCardCompact}>
                <View style={styles.discountHeaderRow}>
                  <Ionicons name="pricetags" size={14} color={colors.primary} />
                  <Text style={styles.discountTitleCompact}>Apply Discount</Text>
                </View>

                <View style={styles.discountInputRow}>
                  <View style={styles.discountTypeToggle}>
                    <TouchableOpacity
                      style={[
                        styles.discTypeBtn,
                        discountType === 'flat' && styles.discTypeBtnActive,
                      ]}
                      onPress={() => setDiscountType('flat')}
                    >
                      <Text
                        style={[
                          styles.discTypeText,
                          discountType === 'flat' && styles.discTypeTextActive,
                        ]}
                      >
                        ₹ Flat
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.discTypeBtn,
                        discountType === 'percent' && styles.discTypeBtnActive,
                      ]}
                      onPress={() => setDiscountType('percent')}
                    >
                      <Text
                        style={[
                          styles.discTypeText,
                          discountType === 'percent' && styles.discTypeTextActive,
                        ]}
                      >
                        % Percent
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    style={styles.discountTextInputCompact}
                    value={discountValue}
                    onChangeText={setDiscountValue}
                    placeholder={discountType === 'flat' ? 'Discount ₹' : 'Discount %'}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Checkout Bottom Bar */}
      <View style={styles.checkoutBarCompact}>
        {saleMode === 'SPECIAL' ? (
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={handleCheckout}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[colors.accent, colors.accentDark || '#00B88A']}
              style={styles.checkoutBtnCompact}
            >
              <Ionicons name="paper-plane" size={16} color="#fff" />
              <Text style={styles.checkoutBtnText}>
                {submitting ? 'Sending...' : 'Send Shortage Order to PC'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <>
            <View>
              <Text style={styles.totalLabel}>
                NET TOTAL ({saleMode === 'CREDIT' ? 'CREDIT' : 'CASH'})
              </Text>
              <Text style={styles.totalValueText}>₹{cartTotal.toFixed(2)}</Text>
            </View>

            <TouchableOpacity
              onPress={handleCheckout}
              disabled={submitting || cart.length === 0}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={
                  saleMode === 'CREDIT'
                    ? [colors.warning, '#d35400']
                    : [colors.primary, colors.primaryDark]
                }
                style={[
                  styles.checkoutBtnCompact,
                  cart.length === 0 && { opacity: 0.5 },
                ]}
              >
                <Ionicons
                  name={saleMode === 'CREDIT' ? 'card' : 'checkmark-circle'}
                  size={18}
                  color="#fff"
                />
                <Text style={styles.checkoutBtnText}>
                  {submitting
                    ? 'Saving...'
                    : saleMode === 'CREDIT'
                    ? 'Save Credit'
                    : 'Checkout'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* MODAL: PRODUCT LIST + PENDING SIDE PANEL */}
      <ProductListPanel
        visible={showProductList}
        onClose={() => setShowProductList(false)}
        products={productCache}
        onAddProduct={item => {
          addToCart(item);
          setShowProductList(false);
        }}
        pendingOrders={pendingOrders}
        offlinePendingCount={offlineStatusCount}
        onMarkReady={handleMarkReady}
        refreshingPending={refreshingPending}
        onRefreshPending={refreshPendingOrders}
      />

      {/* MODAL: SALES HISTORY DRAWER */}
      <Modal
        visible={showSalesHistory}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSalesHistory(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="receipt" size={18} color={colors.primary} />
                <Text style={styles.modalTitle}>Phone & PC Sales History</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSalesHistory(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {deviceLabel ? (
              <Text style={styles.drawerDeviceNote}>
                📱 Selling as <Text style={{ fontWeight: '800', color: colors.primary }}>{deviceLabel}</Text>
              </Text>
            ) : null}

            {/* Pending sync bills saved on THIS phone */}
            {pendingBills.length > 0 && (
              <View style={styles.pendingSyncBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <Ionicons name="cloud-upload-outline" size={12} color={colors.warning} />
                  <Text style={styles.pendingSyncTitle}>
                    PENDING SYNC ({pendingBills.length}) — saved on this phone
                  </Text>
                </View>
                {pendingBills.map((b, i) => (
                  <View key={`pend-${i}`} style={styles.pendingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendingTitle} numberOfLines={1}>
                        {b.patient_name || 'Walk-in'} · {b.items?.length || 0} item{(b.items?.length || 0) !== 1 ? 's' : ''}
                      </Text>
                      <Text style={styles.pendingMeta}>
                        {b.sale_date ? new Date(b.sale_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                    </View>
                    <View style={styles.pendingChip}>
                      <Text style={styles.pendingChipText}>WAITING</Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.pendingHint}>Auto-syncs to PC Phone Sales when WiFi reconnects</Text>
              </View>
            )}

            {loadingSalesHistory ? (
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <Text style={{ color: colors.textMuted }}>Fetching sales history...</Text>
              </View>
            ) : recentSales.length === 0 ? (
              <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                <Ionicons name="document-text-outline" size={36} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, marginTop: spacing.xs }}>No recent sales found</Text>
              </View>
            ) : (
              <FlatList
                data={recentSales}
                keyExtractor={item => `sale-${item.id}-${item.invoice_no}`}
                renderItem={({ item }) => (
                  <View style={styles.salesHistoryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyInvoiceNo}>{item.invoice_no}</Text>
                      <Text style={styles.historyMeta}>
                        Customer: {item.customer_name || 'Walk-in'} | {item.payment_medium || 'CASH'}
                      </Text>
                      <Text style={styles.historyDate}>{item.date}</Text>
                    </View>
                    <Text style={styles.historyTotalAmount}>₹{(item.total_amount || 0).toFixed(2)}</Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL: ADD NEW CUSTOMER */}
      <Modal
        visible={showAddCustomerModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAddCustomerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>+ Register New Customer</Text>
              <TouchableOpacity onPress={() => setShowAddCustomerModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>FULL NAME *</Text>
            <TextInput
              style={styles.textInputCompact}
              value={newCustName}
              onChangeText={setNewCustName}
              placeholder="Customer Full Name"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.inputLabel}>PHONE NUMBER</Text>
            <TextInput
              style={styles.textInputCompact}
              value={newCustPhone}
              onChangeText={(text) => setNewCustPhone(sanitizePhoneInput(text))}
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
            />

            <Text style={styles.inputLabel}>ADDRESS / NOTES</Text>
            <TextInput
              style={styles.textInputCompact}
              value={newCustAddress}
              onChangeText={setNewCustAddress}
              placeholder="Address / locality"
              placeholderTextColor={colors.textMuted}
            />

            <TouchableOpacity
              style={styles.saveCustModalBtn}
              onPress={handleSaveNewCustomer}
            >
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                style={styles.saveCustGradient}
              >
                <Ionicons name="save" size={16} color="#fff" />
                <Text style={styles.saveCustText}>Save Customer</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL: BATCH PICKER */}
      <Modal
        visible={!!batchPickerItem}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setBatchPickerItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Inventory Batch</Text>
              <TouchableOpacity onPress={() => setBatchPickerItem(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { marginBottom: spacing.xs }]}>
              {batchPickerItem?.medicine_name}
            </Text>

            {batchPickerItem?.available_batches.map(b => (
              <TouchableOpacity
                key={`b-${b.batch_no}`}
                style={[
                  styles.batchOptionRow,
                  batchPickerItem.selected_batch === b.batch_no &&
                    styles.batchOptionRowActive,
                ]}
                onPress={() => changeBatch(batchPickerItem.inventory_id, b.batch_no)}
              >
                <View>
                  <Text style={styles.batchNoText}>Batch: {b.batch_no}</Text>
                  <Text style={styles.batchMetaText}>
                    Exp: {b.expiry_date || 'N/A'} | Stock: {b.stock}
                  </Text>
                </View>
                <Text style={styles.batchMrpText}>₹{b.mrp.toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  contentContainer: { padding: spacing.xs + 2, paddingBottom: 90 },

  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  toastBannerText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  compactHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  modeSelectorBar: {
    flexDirection: 'row',
    gap: 4,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    gap: 4,
  },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabActiveCredit: { backgroundColor: colors.warning },
  modeTabActiveSpecial: { backgroundColor: colors.accent },
  modeTabText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  modeTabTextActive: { color: '#fff' },

  salesHistoryHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  salesHistoryHeaderText: { fontSize: 11, fontWeight: '700', color: colors.primary },

  stepCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.xs + 2,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepTitleCompact: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  skipToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  skipToggleText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  stepFieldsContainer: { marginTop: 4 },

  inputLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  inputWithIconRow: { flexDirection: 'row', gap: 4 },
  textInputCompact: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 4,
  },
  addCustomerInlineBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
  },
  rowTwoCols: { flexDirection: 'row', gap: 4 },

  searchSectionCompact: { marginBottom: 6 },
  searchBarWrapperCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  searchInputCompact: { flex: 1, height: 36, fontSize: 13, color: colors.textPrimary },

  cartSectionCompact: { marginBottom: 6 },
  cartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  cartSectionTitle: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
  subtotalHintText: { fontSize: 11, fontWeight: '700', color: colors.accent },

  emptyCartCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderStyle: 'dashed',
  },
  emptyCartTextCompact: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },

  // Collapsed High-Density Cart Strip (36px height)
  collapsedCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  collapsedMedName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  collapsedQtyMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  collapsedPriceText: { fontSize: 14, fontWeight: '800', color: colors.accent },

  // Expanded Cart Card for editing strips & loose dose
  expandedCartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.xs + 4,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.primary + '50',
  },
  cartCardHeader: { flexDirection: 'row', alignItems: 'center' },
  cartMedicineName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cartMedicineMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  batchBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  batchBadgeText: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },

  sideBySideSteppersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  stepperCol: { flex: 1 },
  stepperColLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, marginBottom: 2 },
  stepperControlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  stepperInputText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    paddingVertical: 4,
    minWidth: 34,
  },
  itemTotalCol: { alignItems: 'flex-end', justifyContent: 'center' },
  itemTotalPriceText: { fontSize: 15, fontWeight: '900', color: colors.accent },

  discountCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  discountHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  discountTitleCompact: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  discountInputRow: { flexDirection: 'row', gap: 4 },
  discountTypeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  discTypeBtn: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.sm },
  discTypeBtnActive: { backgroundColor: colors.primary },
  discTypeText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  discTypeTextActive: { color: '#fff' },
  discountTextInputCompact: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 4,
    fontSize: 13,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },

  specialOrderCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent + '50',
  },
  specialCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  specialCardTitle: { fontSize: 13, fontWeight: '700', color: colors.accent },

  priorityRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
  priorityChip: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  priorityChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  priorityText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  priorityTextActive: { color: '#fff' },

  checkoutBarCompact: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : 8,
    ...shadows.card,
  },
  totalLabel: { fontSize: 9, fontWeight: '700', color: colors.textMuted },
  totalValueText: { fontSize: 18, fontWeight: '900', color: colors.accent },
  checkoutBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  checkoutBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  successContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successIcon: { marginBottom: spacing.xs },
  offlineAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warning + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  offlineAlertText: { fontSize: 11, fontWeight: '700', color: colors.warning },
  newBillBtn: { marginTop: spacing.md },
  newBillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
  },
  newBillText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  historySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceLight,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  historySecondaryBtnText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  saveCustModalBtn: { marginTop: spacing.sm },
  saveCustGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  saveCustText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  batchOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  batchOptionRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  batchNoText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  batchMetaText: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  batchMrpText: { fontSize: 14, fontWeight: '700', color: colors.accent },

  salesHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  drawerDeviceNote: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    paddingHorizontal: 2,
  },
  pendingSyncBlock: {
    backgroundColor: colors.warning + '12',
    borderColor: colors.warning + '44',
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  pendingSyncTitle: { fontSize: 10, fontWeight: '800', color: colors.warning, letterSpacing: 0.4 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pendingTitle: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  pendingMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  pendingChip: {
    backgroundColor: colors.warning + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  pendingChipText: { fontSize: 8, fontWeight: '800', color: colors.warning, letterSpacing: 0.5 },
  pendingHint: { fontSize: 9, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },
  historyInvoiceNo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  historyMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  historyDate: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  historyTotalAmount: { fontSize: 15, fontWeight: '800', color: colors.accent },
});
