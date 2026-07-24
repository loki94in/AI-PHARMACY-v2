import { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { createPortal } from 'react-dom';
import { Search, ShoppingCart, Trash2, CheckCircle, Camera, Plus, X, Phone, Calendar, UserCheck, Edit, Loader2, Send, Zap, Printer, MessageSquare, FileText } from 'lucide-react';
import AICamera from '../../components/AICamera';
import BrandBanner from '../../components/POS/BrandBanner';
import { api, apiClient, getCompactInventoryCache, isCompactInventoryCacheReady } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { toastEvent } from '../../services/events';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useFetchMode } from '../../hooks/useFetchMode';

const getLocalDateString = (d: Date = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parsePackSizeFromPackaging = (packaging: string | null | undefined): number | null => {
  if (!packaging) return null;
  const trimmed = packaging.trim();
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }
  const match = trimmed.match(/^(\d+)/);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  return size > 0 ? size : null;
};

const UniversalMedicineEditModal = lazy(() => import('../../components/UniversalMedicineEditModal').then(m => ({ default: m.UniversalMedicineEditModal })));

const ModalSkeleton = () => (
  <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden slide-up">
      <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary animate-pulse" />
          <div className="space-y-1">
            <div className="h-5 w-48 bg-bg2/50 rounded animate-pulse" />
            <div className="h-3 w-32 bg-bg2/50 rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    </div>
  </div>
);

// We will fetch common combinations dynamically instead of using hardcoded constants

const getInitialPOSTabs = () => {
  const saved = localStorage.getItem('pos_draft_tabs');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.error('Failed to parse saved POS tabs:', e);
    }
  }
  return [
    {
      id: 'default',
      name: 'Cart 1',
      items: [],
      patientName: '',
      patientPhone: '',
      refillEnabled: false,
      refillDays: 30,
      doctor: '',
      isManualDoctor: false,
      discount: 0,
      sendWhatsApp: false,
      paymentMedium: 'CASH'
    }
  ];
};

const getInitialPOSActiveTabId = (initialTabs: any[]) => {
  const saved = localStorage.getItem('pos_active_tab_id');
  if (saved && initialTabs.some(t => t.id === saved)) return saved;
  return initialTabs[0]?.id || 'default';
};

let cachedDoctors: any[] | null = null;
let cachedCommonCombinations: any[] | null = null;
let cachedSpecialOrders: any[] | null = null;

const groupBatches = (items: any[]): any[] => {
  const grouped: any[] = [];
  const map = new Map<number, any>();

  // FEFO rank for choosing which batch the sale will actually target:
  // batches that still have strips beat loose-only batches; among those, earliest expiry wins.
  const fefoRank = (stripQty: number, exp?: string) =>
    `${Number(stripQty) > 0 ? 0 : 1}|${exp || '9999-12'}`;

  for (const item of items) {
    const medId = item.medicine_id || item.inventory_id || Math.random();
    const stripQty = item.quantity || 0;
    if (!map.has(medId)) {
      const copy = {
        ...item,
        quantity: stripQty, // running total across batches (display only)
        batch_quantity: stripQty, // stock of the chosen batch — what the sale can actually use
        loose_quantity: item.loose_quantity || 0,
        __fefoRank: fefoRank(stripQty, item.expiry_date)
      };
      if (item.alternatives && Array.isArray(item.alternatives)) {
        copy.alternatives = groupBatches(item.alternatives);
      } else {
        copy.alternatives = [];
      }
      map.set(medId, copy);
      grouped.push(copy);
    } else {
      const existing = map.get(medId);
      existing.quantity = (existing.quantity || 0) + stripQty;

      // FEFO (First Expiry, First Out): adopt this batch if it ranks better,
      // keeping its OWN stock figures so the cart never mixes one batch's id with another's quantity.
      const rank = fefoRank(stripQty, item.expiry_date);
      if (rank < existing.__fefoRank) {
        existing.__fefoRank = rank;
        existing.inventory_id = item.inventory_id;
        existing.batch_no = item.batch_no;
        existing.expiry_date = item.expiry_date;
        existing.mrp = item.mrp;
        existing.cost_price = item.cost_price;
        existing.unit_price = item.unit_price;
        existing.batch_quantity = stripQty;
        existing.loose_quantity = item.loose_quantity || 0;
      }

      if (item.alternatives && Array.isArray(item.alternatives) && item.alternatives.length > 0) {
        existing.alternatives = groupBatches([...existing.alternatives, ...item.alternatives]);
      }
    }
  }
  return grouped;
};

// Stable empty array reference to prevent reference-mismatch state updates
const EMPTY_ARRAY: any[] = [];


const filterLocalInventory = (query: string, inventory: any[]): any[] => {
  if (!query || query.trim().length < 2) return [];
  const term = query.trim().toLowerCase();
  
  // Prefix matches first
  const prefixes = inventory.filter(item => 
    (item.medicine_name && item.medicine_name.toLowerCase().startsWith(term)) ||
    (item.item_code && item.item_code.toLowerCase().startsWith(term)) ||
    (item.batch_no && item.batch_no.toLowerCase().startsWith(term))
  );
  
  if (prefixes.length >= 15) {
    return prefixes.slice(0, 30);
  }
  
  // Infix matches second
  const infixes = inventory.filter(item => 
    ((item.medicine_name && item.medicine_name.toLowerCase().includes(term)) ||
    (item.item_code && item.item_code.toLowerCase().includes(term)) ||
    (item.batch_no && item.batch_no.toLowerCase().includes(term))) &&
    !(item.medicine_name && item.medicine_name.toLowerCase().startsWith(term)) &&
    !(item.item_code && item.item_code.toLowerCase().startsWith(term)) &&
    !(item.batch_no && item.batch_no.toLowerCase().startsWith(term))
  );
  
  return [...prefixes, ...infixes].slice(0, 30);
};

const POS = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialTabs = getInitialPOSTabs();
  const initialActiveTabId = getInitialPOSActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [searchTerm, setSearchTerm] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [patientName, setPatientName] = useState(initialActiveTab.patientName || '');
  const [patientPhone, setPatientPhone] = useState(initialActiveTab.patientPhone || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialActiveTab.selectedCustomerId || null);
  const [patientId] = useState('P-' + Math.floor(100000 + Math.random() * 900000));
  const [refillEnabled, setRefillEnabled] = useState(initialActiveTab.refillEnabled || false);
  const [refillDays, setRefillDays] = useState(initialActiveTab.refillDays || 30);
  const [activeRefillId, setActiveRefillId] = useState<number | null>(null);
  const [matchedRefill, setMatchedRefill] = useState<any | null>(null);
  const [dismissedRefillId, setDismissedRefillId] = useState<number | null>(null);

  // Hydrate POS cart from URL parameters for automatic refill checkouts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refillPatientName = params.get('refillPatientName');
    const refillPatientPhone = params.get('refillPatientPhone');
    const refillMedicineId = params.get('refillMedicineId');
    const refillMedicineName = params.get('refillMedicineName');
    const refillId = params.get('refillId');
    const refillQty = params.get('refillQty') || '10';
    const refillDaysParam = params.get('refillDays') || '30';

    if (refillPatientName && refillMedicineId && refillMedicineName && refillId) {
      setPatientName(refillPatientName);
      setPatientPhone(refillPatientPhone || '');
      setRefillEnabled(true);
      setRefillDays(Number(refillDaysParam));
      setActiveRefillId(Number(refillId));

      const fetchAndAddMedicine = async () => {
        try {
          const results = await api.searchMedicine(refillMedicineName);
          if (results && results.length > 0) {
            const matched = results[0];
            const cartItem = {
              id: matched.id,
              name: matched.name,
              batch: matched.batch_no || matched.batch_number || 'AUTO',
              expiry: matched.expiry_date || '12/28',
              mrp: matched.mrp || 100,
              qty: Number(refillQty),
              quantity: Number(refillQty),
              unitPrice: matched.unit_price || matched.mrp || 100,
              looseQty: 0,
              discount: 0,
              packSize: parsePackSizeFromPackaging(matched.packaging) || matched.pack_size || 10
            };
            setCart([cartItem]);
          } else {
            setCart([{
              id: Number(refillMedicineId),
              name: refillMedicineName,
              batch: 'AUTO',
              expiry: '12/28',
              mrp: 100,
              qty: Number(refillQty),
              quantity: Number(refillQty),
              unitPrice: 100,
              looseQty: 0,
              discount: 0,
              packSize: 10
            }]);
          }
        } catch (err) {
          console.error('Failed to resolve refill medicine in POS:', err);
        }
      };
      fetchAndAddMedicine();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Hydrate POS cart from router state parameter for refills panel handoff
  useEffect(() => {
    if (location.state && (location.state as any).prefill) {
      const prefill = (location.state as any).prefill;
      const { patientName: name, patientPhone: phone } = prefill;
      if (name) setPatientName(name);
      if (phone) setPatientPhone(phone);

      const fetchAndAdd = async () => {
        try {
          // Multi-medicine array from CRM "Bill Now → POS"
          if (Array.isArray(prefill.medicines) && prefill.medicines.length > 0) {
            const cartItems: any[] = [];
            for (const med of prefill.medicines) {
              try {
                const matched = await api.searchMedicine(med.medicineName || med.medicine_name || '');
                if (matched && matched.length > 0) {
                  const m = matched[0];
                  cartItems.push({
                    id: m.id,
                    name: m.name,
                    batch: m.batch_no || m.batch_number || 'AUTO',
                    expiry: m.expiry_date || '12/28',
                    mrp: m.mrp || 100,
                    qty: Number(med.quantity_needed) || 10,
                    quantity: Number(med.quantity_needed) || 10,
                    unitPrice: m.unit_price || m.mrp || 100,
                    looseQty: 0,
                    discount: 0,
                    packSize: parsePackSizeFromPackaging(m.packaging) || m.pack_size || 10
                  });
                }
              } catch { /* skip individual medicine resolution errors */ }
            }
            if (cartItems.length > 0) setCart(cartItems);
          } else if (prefill.medicineId) {
            // Legacy single-medicine path
            const matched = await api.getQuickEditMedicine(Number(prefill.medicineId));
            if (matched) {
              setCart([{
                id: matched.id,
                name: matched.name,
                batch: matched.batch_no || matched.batch_number || 'AUTO',
                expiry: matched.expiry_date || '12/28',
                mrp: matched.mrp || 100,
                qty: Number(prefill.quantity) || 10,
                quantity: Number(prefill.quantity) || 10,
                unitPrice: matched.unit_price || matched.mrp || 100,
                looseQty: 0,
                discount: 0,
                packSize: matched.pack_size || 10
              }]);
            }
          }
        } catch (err) {
          console.error('Failed to prefill POS from state:', err);
        }
      };
      fetchAndAdd();
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState('');
  const [lastSavedItems, setLastSavedItems] = useState<any[]>([]);
  const [lastSavedPatientName, setLastSavedPatientName] = useState('');
  const [lastSavedPatientPhone, setLastSavedPatientPhone] = useState('');
  const [lastSavedGrandTotal, setLastSavedGrandTotal] = useState(0);
  const [lastSavedPaymentMedium, setLastSavedPaymentMedium] = useState('CASH');
  const [lastSavedWasWhatsAppSent, setLastSavedWasWhatsAppSent] = useState(false);
  const pendingDirectSaveRef = useRef<boolean>(false);
  const [doctor, setDoctor] = useState(initialActiveTab.doctor || '');
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const [doctorHighlightIndex, setDoctorHighlightIndex] = useState(-1);
  const [isManualDoctor, setIsManualDoctor] = useState(initialActiveTab.isManualDoctor || false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(initialActiveTab.selectedDoctorId || null);
  const [doctorSuggestions, setDoctorSuggestions] = useState<any[]>([]);
  const [doctorComboSuggestions, setDoctorComboSuggestions] = useState<any[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  
  // Doctor Modal state
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [newDoctorName, setNewDoctorName] = useState('');
  const [newDoctorSpecialty, setNewDoctorSpecialty] = useState('');
  const [newDoctorPhone, setNewDoctorPhone] = useState('');
  const [newDoctorClinic, setNewDoctorClinic] = useState('');
  const [newDoctorRegNo, setNewDoctorRegNo] = useState('');
  // Patient autocomplete
  const [patientSuggestions, setPatientSuggestions] = useState<any[]>([]);
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
  const [patientHighlightIndex, setPatientHighlightIndex] = useState(-1);
  const [discount, setDiscount] = useState(initialActiveTab.discount || 0);
  const [date, setDate] = useState(getLocalDateString());
  const [cart, setCart] = useState<any[]>(initialActiveTab.items || []);
  const [sendWhatsApp, setSendWhatsApp] = useState(initialActiveTab.sendWhatsApp || false); // DEFAULT: OFF
  const [paymentMedium, setPaymentMedium] = useState<string>(initialActiveTab.paymentMedium || 'CASH'); // DEFAULT: CASH
  const queryClient = useQueryClient();

  const specialOrdersControl = useFetchMode('pos.specialOrders');
  const combinationsControl = useFetchMode('pos.combinations');
  const doctorsControl = useFetchMode('pos.doctors');

  const { data: specialOrders = [] } = useApiQuery<any[]>(
    'pos-special-orders',
    () => api.getOrders().then(data => Array.isArray(data) ? data.filter(o => o.status === 'Pending' || o.status === 'Ordered') : []),
    { enabled: specialOrdersControl.shouldFetch }
  );

  const { data: commonCombinations = [] } = useApiQuery<any[]>(
    'pos-common-combinations',
    async () => {
      const data = await api.getInventory({ limit: 12 });
      if (!Array.isArray(data)) return [];
      const topItems = data.slice(0, 12).map(med => ({
        id: med.id,
        name: med.name,
        batch: med.batch_number || 'B-GEN',
        expiry: med.expiry_date || '12/28',
        mrp: med.mrp || 0,
        costPrice: med.purchase_price || ((med.mrp || 0) * 0.7),
        salts: med.hsn || 'Generic',
        packSize: parseInt(med.pack_size || '10', 10) || 10,
        recommendedQty: 1,
        recommendedLooseQty: 0,
        recommendationMsg: '',
        quantity: med.stock_quantity
      }));

      try {
        const medNames = topItems.map(m => m.name).join(',');
        const response = await apiClient.get('/sales/recommend-quantity/batch', { params: { medicineNames: medNames } });
        const recommendations = response.data || {};

        return topItems.map(med => {
          const rec = recommendations[med.name];
          if (rec) {
            return {
              ...med,
              recommendedQty: rec.type === 'strip' ? (rec.recommendedQty || 1) : 0,
              recommendedLooseQty: rec.type === 'loose' ? (rec.recommendedQty || 1) : 0,
              recommendationMsg: rec.message || ''
            };
          }
          return med;
        });
      } catch (err) {
        console.error('Batch quantity enrichment failed:', err);
        return topItems;
      }
    },
    { enabled: combinationsControl.shouldFetch }
  );

  const [rowBatchesList, setRowBatchesList] = useState<any[]>([]);
  const [activeBatchRowId, setActiveBatchRowId] = useState<number | null>(null);

  // Multi-cart tab states
  const [tabs, setTabs] = useState<any[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  // Synchronize active states with the active tab in the tabs list
  useEffect(() => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      if (idx === -1) return prev;
      const t = prev[idx];
      if (
        t.items !== cart ||
        t.patientName !== patientName ||
        t.patientPhone !== patientPhone ||
        t.refillEnabled !== refillEnabled ||
        t.refillDays !== refillDays ||
        t.doctor !== doctor ||
        t.isManualDoctor !== isManualDoctor ||
        t.discount !== discount ||
        t.sendWhatsApp !== sendWhatsApp ||
        t.paymentMedium !== paymentMedium ||
        t.selectedDoctorId !== selectedDoctorId
      ) {
        const next = [...prev];
        next[idx] = {
          ...t,
          items: cart,
          patientName,
          patientPhone,
          refillEnabled,
          refillDays,
          doctor,
          isManualDoctor,
          discount,
          sendWhatsApp,
          paymentMedium,
          selectedDoctorId
        };
        return next;
      }
      return prev;
    });
  }, [cart, patientName, patientPhone, refillEnabled, refillDays, doctor, isManualDoctor, discount, sendWhatsApp, paymentMedium, selectedDoctorId, activeTabId]);

  // Save tabs and activeTabId to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('pos_draft_tabs', JSON.stringify(tabs));
  }, [tabs]);

  // Auto-initialize with an empty row if the cart is completely empty
  useEffect(() => {
    const validItems = cart.filter(item => !item.isEmptyRow);
    if (validItems.length === 0 && (cart.length !== 1 || !cart[0].isEmptyRow)) {
      setCart([{
        id: 'empty_row_' + Date.now(),
        name: '',
        batch: '',
        expiry: '',
        mrp: 0,
        qty: 1,
        looseQty: 0,
        discount: 0,
        packSize: 10,
        isEmptyRow: true
      }]);
    }
  }, [cart]);

  // Automatically append a new empty row at the bottom if the last row is filled
  useEffect(() => {
    if (cart.length > 0) {
      const lastItem = cart[cart.length - 1];
      if (!lastItem.isEmptyRow && lastItem.name) {
        setCart(prev => [
          ...prev,
          {
            id: 'empty_row_' + Date.now(),
            name: '',
            batch: '',
            expiry: '',
            mrp: 0,
            qty: 1,
            looseQty: 0,
            discount: 0,
            packSize: 10,
            isEmptyRow: true
          }
        ]);
      }
    }
  }, [cart]);

  // Autofocus the next empty row's medicine input when cart length increases or changes
  useEffect(() => {
    if (skipEmptyRowAutofocusRef.current) {
      skipEmptyRowAutofocusRef.current = false;
      return;
    }
    if (cart.length > 0) {
      const lastIndex = cart.length - 1;
      const lastItem = cart[lastIndex];
      if (lastItem && lastItem.isEmptyRow) {
        setTimeout(() => {
          const input = document.getElementById(`row-med-input-${lastIndex}`);
          if (input) {
            input.focus();
          }
        }, 80);
      }
    }
  }, [cart.length]);

  // Clean up any potential legacy conflicting local storage keys to ensure robust cache
  useEffect(() => {
    localStorage.removeItem('pos_tabs');
    localStorage.removeItem('pos_active_tab');
    localStorage.removeItem('pos_draft_tab_id');
  }, []);

  useEffect(() => {
    localStorage.setItem('pos_active_tab_id', activeTabId);
  }, [activeTabId]);

  const switchTab = (newTabId: string) => {
    if (newTabId === activeTabId) return;
    const target = tabs.find(t => t.id === newTabId);
    if (target) {
      setCart(target.items || []);
      setPatientName(target.patientName || '');
      setPatientPhone(target.patientPhone || '');
      setRefillEnabled(target.refillEnabled || false);
      setRefillDays(target.refillDays || 30);
      setDoctor(target.doctor || '');
      setIsManualDoctor(target.isManualDoctor || false);
      setSelectedDoctorId(target.selectedDoctorId || null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(target.discount || 0);
      setSendWhatsApp(target.sendWhatsApp || false);
      setPaymentMedium(target.paymentMedium || 'CASH');
      setActiveTabId(newTabId);
    }
  };

  const addNewTab = () => {
    const nextNum = tabs.length + 1;
    const newId = 'cart_' + Date.now();
    const newTab = {
      id: newId,
      name: `Cart ${nextNum}`,
      items: [],
      patientName: '',
      patientPhone: '',
      refillEnabled: false,
      refillDays: 30,
      doctor: '',
      isManualDoctor: false,
      discount: 0,
      sendWhatsApp: false,
      paymentMedium: 'CASH',
      selectedDoctorId: null
    };

    setCart([]);
    setPatientName('');
    setPatientPhone('');
    setRefillEnabled(false);
    setRefillDays(30);
    setDoctor('');
    setIsManualDoctor(false);
    setSelectedDoctorId(null);
    setDoctorSuggestions([]);
    setDoctorComboSuggestions([]);
    setDiscount(0);
    setSendWhatsApp(false);
    setPaymentMedium('CASH');
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    const filtered = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
      const fallback = filtered[filtered.length - 1];
      setCart(fallback.items || []);
      setPatientName(fallback.patientName || '');
      setPatientPhone(fallback.patientPhone || '');
      setRefillEnabled(fallback.refillEnabled || false);
      setRefillDays(fallback.refillDays || 30);
      setDoctor(fallback.doctor || '');
      setIsManualDoctor(fallback.isManualDoctor || false);
      setSelectedDoctorId(fallback.selectedDoctorId || null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(fallback.discount || 0);
      setSendWhatsApp(fallback.sendWhatsApp || false);
      setPaymentMedium(fallback.paymentMedium || 'CASH');
      setActiveTabId(fallback.id);
    }
    setTabs(filtered.map((t, idx) => ({
      ...t,
      name: t.name.startsWith('Cart ') ? `Cart ${idx + 1}` : t.name
    })));
  };

  const getTabItemsCount = (tab: any) => {
    if (tab.id === activeTabId) {
      return cart.filter(item => !item.isEmptyRow).length;
    }
    const items = tab.items || [];
    return items.filter((item: any) => !item.isEmptyRow).length;
  };

  const updateCart = (newCartOrFn: any[] | ((prev: any[]) => any[])) => {
    setCart(prev => {
      const next = typeof newCartOrFn === 'function' ? newCartOrFn(prev) : newCartOrFn;
      return next;
    });
  };

  const updatePatientName = (name: string) => {
    setPatientName(name);
  };
  
  const { data: doctorsList } = useApiQuery<any[]>(
    'crm-doctors',
    () => api.getDoctors(),
    { enabled: doctorsControl.shouldFetch }
  );

  const defaultDoctors = useMemo(() => [
    { id: 901, name: 'Dr. Priya Mehta (Cardiologist)' },
    { id: 902, name: 'Dr. Raj Sharma (GP)' },
    { id: 903, name: 'Dr. Anita Patel (Pediatrician)' }
  ], []);

  const allDoctors = useMemo(() => [
    ...defaultDoctors,
    ...(doctorsList || EMPTY_ARRAY).filter(d => !defaultDoctors.some(dd => dd.name === d.name))
  ], [doctorsList, defaultDoctors]);

  const filteredDoctors = useMemo(() => allDoctors.filter(doc => 
    doc.name.toLowerCase().includes(doctor.toLowerCase())
  ), [allDoctors, doctor]);

  // Handle auto-resolving doctor ID from typed or selected name
  useEffect(() => {
    if (doctor.trim() === '') {
      setSelectedDoctorId(null);
      setDoctorSuggestions(EMPTY_ARRAY);
      setDoctorComboSuggestions(EMPTY_ARRAY);
      return;
    }
    const match = allDoctors.find(d => d.name.toLowerCase().trim() === doctor.toLowerCase().trim());
    if (match) {
      setSelectedDoctorId(match.id);
    } else {
      setSelectedDoctorId(null);
      setDoctorSuggestions(EMPTY_ARRAY);
      setDoctorComboSuggestions(EMPTY_ARRAY);
    }
  }, [doctor, allDoctors]);

  // Load doctor suggestions when doctor ID changes
  useEffect(() => {
    if (selectedDoctorId) {
      api.getDoctorSuggestions(selectedDoctorId)
        .then((data: any[]) => {
          if (Array.isArray(data)) {
            setDoctorSuggestions(data);
          }
        })
        .catch(err => {
          console.error('Failed to fetch doctor suggestions:', err);
          setDoctorSuggestions(EMPTY_ARRAY);
        });
    } else {
      setDoctorSuggestions(EMPTY_ARRAY);
    }
  }, [selectedDoctorId]);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [onlineResults, setOnlineResults] = useState<any[]>([]);
  const [searchingOnline, setSearchingOnline] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const [activeRowSearchIndex, setActiveRowSearchIndex] = useState<number | null>(null);
  const [rowSearchTerm, setRowSearchTerm] = useState('');
  const [rowSearchResults, setRowSearchResults] = useState<any[]>([]);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  const [rowSearchHighlightIndex, setRowSearchHighlightIndex] = useState(-1);

  const productSearchRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const skipEmptyRowAutofocusRef = useRef(false);
  const patientSuggestionsRef = useRef<HTMLDivElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const rowSearchResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (patientHighlightIndex >= 0 && patientSuggestionsRef.current) {
      const highlighted = patientSuggestionsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [patientHighlightIndex]);

  useEffect(() => {
    if (searchHighlightIndex >= 0 && searchResultsRef.current) {
      const highlighted = searchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [searchHighlightIndex]);

  useEffect(() => {
    if (rowSearchHighlightIndex >= 0 && rowSearchResultsRef.current) {
      const highlighted = rowSearchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [rowSearchHighlightIndex]);

  useOnClickOutside(productSearchRef, () => {
    setSearchResults([]);
    setSuggestions([]);
    setShowSearchDropdown(false);
  });

  useOnClickOutside(activeRowRef, () => {
    setRowSearchResults([]);
    setActiveRowSearchIndex(null);
  });

  // Local row search autocomplete
  useEffect(() => {
    const term = rowSearchTerm.trim();
    if (activeRowSearchIndex === null || term.length < 2) {
      setRowSearchResults([]);
      setRowSearchHighlightIndex(-1);
      return;
    }

    const compactInventory = getCompactInventoryCache();
    const mapped = compactInventory.map(item => ({
      ...item,
      medicine_name: item.name,
      quantity: item.stock_qty,
      alternatives: []
    }));

    const filtered = filterLocalInventory(term, mapped);
    const grouped = groupBatches(filtered);
    setRowSearchResults(grouped);
    setRowSearchHighlightIndex(-1);
  }, [rowSearchTerm, activeRowSearchIndex]);

  // Fetch customer suggestions for patient autocomplete (P2)
  useEffect(() => {
    if (patientName.trim().length < 2) {
      setPatientSuggestions([]);
      setShowPatientSuggestions(false);
      return;
    }

    const delayDebounce = setTimeout(() => {
      api.getPatients({ q: patientName.trim(), limit: 8 })
        .then((data: any[]) => {
          if (Array.isArray(data)) {
            setPatientSuggestions(data);
            const isFocused = document.activeElement && document.activeElement.getAttribute('aria-label') === 'Patient Name';
            if (isFocused) {
              setShowPatientSuggestions(data.length > 0);
            }
          }
        })
        .catch(() => {});
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounce);
  }, [patientName]);

  // Search for pending refills matching the patient's name to display the name-match alert banner
  useEffect(() => {
    if (patientName.trim().length < 2) {
      setMatchedRefill(null);
      return;
    }
    const delayCheck = setTimeout(async () => {
      try {
        const response = await apiClient.get('/refills/panel');
        if (response.data && Array.isArray(response.data)) {
          const match = response.data.find((group: any) => 
            group.patient_name.toLowerCase().trim() === patientName.toLowerCase().trim()
          );
          if (match && match.medicines.length > 0) {
            // Find a medicine in the group that is ready (or override set) and not checked out
            const med = match.medicines.find((m: any) => m.is_ready === 1 || m.stock_verified_override === 1);
            if (med && med.id !== dismissedRefillId) {
              setMatchedRefill({
                id: med.id,
                patient_name: match.patient_name,
                patient_phone: match.patient_phone,
                medicine_id: med.medicine_id,
                medicine_name: med.medicine_name,
                quantity: med.quantity_needed || 10
              });
              return;
            }
          }
        }
        setMatchedRefill(null);
      } catch (err) {
        console.error('Failed to search for refill match:', err);
      }
    }, 450);
    return () => clearTimeout(delayCheck);
  }, [patientName, dismissedRefillId]);

  const handleAcceptRefill = async () => {
    if (!matchedRefill) return;
    try {
      const results = await api.searchMedicine(matchedRefill.medicine_name);
      const matched = (results && results.length > 0) ? results[0] : null;
      const cartItem = {
        id: matched ? matched.id : matchedRefill.medicine_id,
        name: matchedRefill.medicine_name,
        batch: matched ? (matched.batch_no || matched.batch_number || 'AUTO') : 'AUTO',
        expiry: matched ? (matched.expiry_date || '12/28') : '12/28',
        mrp: matched ? (matched.mrp || 100) : 100,
        qty: Number(matchedRefill.quantity),
        quantity: Number(matchedRefill.quantity),
        unitPrice: matched ? (matched.unit_price || matched.mrp || 100) : 100,
        looseQty: 0,
        discount: 0,
        packSize: matched ? (parsePackSizeFromPackaging(matched.packaging) || matched.pack_size || 10) : 10
      };

      setCart(prev => {
        const clean = prev.filter(item => !item.isEmptyRow);
        return [...clean, cartItem];
      });

      if (matchedRefill.patient_phone) {
        setPatientPhone(matchedRefill.patient_phone);
      }

      setActiveRefillId(matchedRefill.id);
      toastEvent.trigger(`Added refill medication: ${matchedRefill.medicine_name}`, 'success', '/pos');
    } catch (err) {
      console.error('Failed to accept refill:', err);
    }
    setMatchedRefill(null);
  };

  const handleSavePatientProfile = async () => {
    if (patientName.trim()) {
      try {
        await api.addPatient({ name: patientName.trim(), phone: patientPhone.trim() });
      } catch (e) {
        // Patient may already exist, ignore duplicate errors
      }
    }
    setShowPatientModal(false);
  };

  const handleCompleteSaleRef = useRef<any>(null);
  const handleSavePatientProfileRef = useRef<any>(null);
  const showPatientModalRef = useRef<boolean>(false);

  useEffect(() => {
    handleCompleteSaleRef.current = handleCompleteSale;
    handleSavePatientProfileRef.current = handleSavePatientProfile;
    showPatientModalRef.current = showPatientModal;
  });

  // Keyboard shortcut listeners (e.g. 'X' for camera, 'Alt+E' or 'F8' for quick edit medicine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;

      // Ctrl + S: Save Bill or Save Profile
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (showPatientModalRef.current) {
          handleSavePatientProfileRef.current();
        } else {
          handleCompleteSaleRef.current();
        }
        return;
      }

      // Ctrl + 1: Focus Patient/Customer Input
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        const input = document.getElementById('patient-name-input');
        if (input) {
          input.focus();
          (input as HTMLInputElement).select();
        }
        return;
      }

      // Alt + P: Open Patient Modal
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPatientModal(true);
        return;
      }

      // Escape: Close Modals / Overlays
      if (e.key === 'Escape') {
        setShowPatientModal(false);
        setShowDoctorModal(false);
        setShowCamera(false);
        setZoomedImage(null);
      }

      // F8 or Alt+E: Universal Medicine Edit for focused row
      if (e.key === 'F8' || (e.altKey && e.key.toLowerCase() === 'e')) {
        if (active) {
          const tr = active.closest('tr');
          if (tr) {
            const medicineIdAttr = tr.getAttribute('data-medicine-id');
            if (medicineIdAttr) {
              const medId = parseInt(medicineIdAttr, 10);
              if (medId && !isNaN(medId)) {
                e.preventDefault();
                setEditMedicineId(medId);
                return;
              }
            }
          }
        }
      }

      if (active && (
        active.tagName === 'INPUT' || 
        active.tagName === 'SELECT' || 
        active.tagName === 'TEXTAREA' || 
        active.isContentEditable
      )) return;

      if (e.key.toLowerCase() === 'x') {
        e.preventDefault();
        setShowCamera(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchTerm.trim().length < 3) {
      setSearchResults([]);
      setSearchHighlightIndex(-1);
      setOnlineResults([]);
      setSearchingOnline(false);
      setSuggestions([]);
      return;
    }
  }, [searchTerm]);

  // Fetch fuzzy did-you-mean suggestions when results are thin
  useEffect(() => {
    if (searchTerm.trim().length < 3 || searchResults.length >= 5) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await api.suggestMedicine(searchTerm.trim());
        if (Array.isArray(data)) {
          const filtered = data.filter(sug => !searchResults.some(r => r.medicine_name.toLowerCase() === sug.name.toLowerCase()));
          setSuggestions(filtered);
        }
      } catch (err) {
        console.error('Failed to load suggestions in POS:', err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm, searchResults]);

  // Local autocomplete (replaces React Query useApiQuery to eliminate layout shift and latency)
  const isSearchLoading = false;

  const [inventoryIndexReady, setInventoryIndexReady] = useState(() => isCompactInventoryCacheReady());
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    const handler = () => {
      setInventoryIndexReady(true);
      setCacheVersion(prev => prev + 1);
    };
    window.addEventListener('inventory-cache-ready', handler);
    return () => window.removeEventListener('inventory-cache-ready', handler);
  }, []);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchHighlightIndex(-1);
      return;
    }

    const compactInventory = getCompactInventoryCache();
    const mapped = compactInventory.map(item => ({
      ...item,
      medicine_name: item.name,
      quantity: item.stock_qty,
      alternatives: []
    }));

    const filtered = filterLocalInventory(term, mapped);
    const groupedData = groupBatches(filtered);

    // Premium Barcode Auto-Add Feature:
    const barcodeTerm = term.toUpperCase();
    if (groupedData.length === 1) {
      const matched = groupedData[0];
      const barcode = (matched.item_code || '').toUpperCase().trim();
      if (barcode === barcodeTerm && matched.inventory_id && !matched.is_out_of_stock) {
        fetchDetailsAndAddToCart(matched);
        setSearchTerm('');
        setSearchResults([]);
        setSearchHighlightIndex(-1);
        return;
      }
    }
    setSearchResults(groupedData);
    setSearchHighlightIndex(-1);
    setOnlineResults([]);
    setSearchingOnline(false);
  }, [searchTerm, cacheVersion]);

  // Universal Edit state
  const [editMedicineId, setEditMedicineId] = useState<number | null>(null);

  const rebalanceCartMedicine = (prevCart: any[], medicineId: number, targetItemId: number, updatedFields: { qty?: number; looseQty?: number }) => {
    // 1. Find all cart items of this medicine
    const medicineItems = prevCart.filter(item => !item.isEmptyRow && item.medicine_id === medicineId);
    if (medicineItems.length === 0) return prevCart;

    // 2. Determine the new total requested quantity for this medicine.
    let totalRequestedTablets = 0;
    const packSize = medicineItems[0].packSize || 10;

    for (const item of medicineItems) {
      let itemQty = item.qty || 0;
      let itemLoose = item.looseQty || 0;
      if (item.id === targetItemId) {
        if (updatedFields.qty !== undefined) itemQty = updatedFields.qty;
        if (updatedFields.looseQty !== undefined) itemLoose = updatedFields.looseQty;
      }
      totalRequestedTablets += (itemQty * packSize) + itemLoose;
    }

    // 3. Fetch all active batches for this medicine from the local inventory cache
    const compactInventory = getCompactInventoryCache();
    const activeBatches = compactInventory
      .filter(item => item.medicine_id === medicineId && (item.stock_qty > 0 || item.loose_quantity > 0))
      .map(item => {
        const expiryStr = item.expiry_date || '';
        let isExpired = false;
        if (expiryStr) {
          let expDate: Date;
          if (expiryStr.includes('/')) {
            const parts = expiryStr.split('/');
            let year = parseInt(parts[1], 10);
            const month = parseInt(parts[0], 10) - 1;
            if (year < 100) year += 2000;
            expDate = new Date(year, month + 1, 0);
          } else {
            expDate = new Date(expiryStr);
          }
          if (expDate < new Date()) isExpired = true;
        }
        return { ...item, isExpired };
      })
      .filter(item => !item.isExpired);

    if (activeBatches.length === 0) {
      toastEvent.trigger("This medicine is completely out of stock or expired", "error");
      return prevCart.map(item => {
        if (item.id === targetItemId) {
          return { ...item, qty: 0, looseQty: 0 };
        }
        return item;
      }).filter(item => item.id === targetItemId || item.medicine_id !== medicineId);
    }

    // Sort batches by FEFO (First Expiry, First Out):
    // Active batches that have full strips first, then loose-only. Earliest expiry first.
    activeBatches.sort((a, b) => {
      const aHasStrips = (a.stock_qty || 0) > 0 ? 0 : 1;
      const bHasStrips = (b.stock_qty || 0) > 0 ? 0 : 1;
      if (aHasStrips !== bHasStrips) return aHasStrips - bHasStrips;
      
      const aExp = a.expiry_date || '9999-12-31';
      const bExp = b.expiry_date || '9999-12-31';
      return aExp.localeCompare(bExp);
    });

    // 4. Distribute the total requested quantity across batches
    let remainingTablets = totalRequestedTablets;
    const allocations: { batch: any; qty: number; looseQty: number }[] = [];
    let totalAvailableTablets = 0;

    for (const batch of activeBatches) {
      const batchStockTablets = (batch.stock_qty || 0) * packSize + (batch.loose_quantity || 0);
      totalAvailableTablets += batchStockTablets;
      
      if (remainingTablets > 0 && batchStockTablets > 0) {
        const takenTablets = Math.min(remainingTablets, batchStockTablets);
        const qty = Math.floor(takenTablets / packSize);
        const looseQty = takenTablets % packSize;

        allocations.push({
          batch,
          qty,
          looseQty
        });
        remainingTablets -= takenTablets;
      }
    }

    // 5. If requested exceeds available stock, alert the user and cap the allocations
    if (totalRequestedTablets > totalAvailableTablets) {
      toastEvent.trigger(`Only ${totalAvailableTablets} units available in stock. Capped to maximum.`, "info");
      
      remainingTablets = totalAvailableTablets;
      allocations.length = 0;
      for (const batch of activeBatches) {
        const batchStockTablets = (batch.stock_qty || 0) * packSize + (batch.loose_quantity || 0);
        if (remainingTablets > 0 && batchStockTablets > 0) {
          const takenTablets = Math.min(remainingTablets, batchStockTablets);
          const qty = Math.floor(takenTablets / packSize);
          const looseQty = takenTablets % packSize;
          allocations.push({ batch, qty, looseQty });
          remainingTablets -= takenTablets;
        }
      }
    }

    if (allocations.length === 0) {
      allocations.push({
        batch: activeBatches[0],
        qty: 0,
        looseQty: 0
      });
    }

    // 6. Build the new cart rows for this medicine
    const firstMedItem = medicineItems[0];
    const newMedRows = allocations.map((alloc) => {
      return {
        ...firstMedItem,
        id: alloc.batch.inventory_id,
        batch: alloc.batch.batch_no,
        expiry: alloc.batch.expiry_date,
        qty: alloc.qty,
        looseQty: alloc.looseQty,
        mrp: alloc.batch.mrp,
        costPrice: alloc.batch.cost_price || (alloc.batch.mrp * 0.7),
        unitPrice: alloc.batch.unit_price || alloc.batch.mrp,
        availableStock: alloc.batch.stock_qty,
        availableLooseStock: alloc.batch.loose_quantity,
        alternative_batches: activeBatches.filter(b => b.inventory_id !== alloc.batch.inventory_id)
      };
    });

    // 7. Replace all old rows of this medicine in the cart with the new rows
    const newCart: any[] = [];
    let inserted = false;
    for (const item of prevCart) {
      if (item.medicine_id === medicineId) {
        if (!inserted) {
          newCart.push(...newMedRows);
          inserted = true;
        }
      } else {
        newCart.push(item);
      }
    }
    if (!inserted) {
      newCart.push(...newMedRows);
    }
    return newCart;
  };

  const addToCart = (med: any) => {
    // Expiry check
    const expiryStr = med.expiry || med.expiry_date || '';
    if (expiryStr) {
      let expDate: Date;
      if (expiryStr.includes('/')) {
        const parts = expiryStr.split('/');
        let year = parseInt(parts[1], 10);
        const month = parseInt(parts[0], 10) - 1;
        if (year < 100) year += 2000;
        expDate = new Date(year, month + 1, 0);
      } else {
        expDate = new Date(expiryStr);
      }
      if (expDate < new Date()) {
        alert(`❌ CANNOT ADD EXPIRED PRODUCT!\n\n${med.name} expired on ${expiryStr}.\nPlease remove it from physical inventory.`);
        return;
      }
    }

    // Check if added item has special order request
    const pendingMatches = specialOrders.filter(
      o => o.product.toLowerCase().trim() === med.name.toLowerCase().trim() ||
           med.name.toLowerCase().includes(o.product.toLowerCase().trim())
    );
    if (pendingMatches.length > 0) {
      alert(`🔔 Pending Out-of-Stock Request:\nCustomer "${pendingMatches[0].requester}" requested ${pendingMatches[0].qty} unit(s) of "${med.name}". Please ensure it is reserved or reconciled if needed!`);
    }

    const cleanCart = cart.filter(item => !item.isEmptyRow);
    const existingIndex = cleanCart.findIndex(item => {
      const isDbId = (id: any) => typeof id === 'number' && id < 1000000;
      const idMatches = isDbId(item.id) && isDbId(med.id) && item.id === med.id;
      const medicineIdMatch = item.medicine_id !== undefined && med.medicine_id !== undefined && item.medicine_id === med.medicine_id;
      const nameMatch = item.name.toLowerCase().trim() === med.name.toLowerCase().trim();
      return idMatches || medicineIdMatch || nameMatch;
    });

    const targetIndex = existingIndex !== -1 ? existingIndex : cleanCart.length;
    skipEmptyRowAutofocusRef.current = true;

    updateCart(prevCart => {
      const cleanPrev = prevCart.filter(item => !item.isEmptyRow);
      let incQty = 1;
      if (med.recommendedQty !== undefined) {
        incQty = med.recommendedQty;
      } else if (med.last_qty !== undefined && med.last_qty !== null) {
        incQty = Number(med.last_qty) || 1;
      }
      const incLooseQty = med.recommendedLooseQty || 0;
      
      if (existingIndex !== -1) {
        const existingItem = cleanPrev[existingIndex];
        const newQty = existingItem.qty + incQty;
        const newLoose = (existingItem.looseQty || 0) + incLooseQty;
        return rebalanceCartMedicine(cleanPrev, existingItem.medicine_id, existingItem.id, { qty: newQty, looseQty: newLoose });
      }
      
      const newItem = { 
        id: med.id, 
        medicine_id: med.medicine_id || med.id,
        name: med.name, 
        batch: med.batch || 'B-GEN', 
        expiry: med.expiry || '12/28', 
        qty: incQty, 
        looseQty: incLooseQty,
        discount: med.discount !== undefined ? med.discount : 0,
        packSize: med.packSize || 10,
        mrp: med.mrp, 
        costPrice: med.costPrice || (med.mrp * 0.7),
        salts: med.salts || '',
        availableStock: med.batch_quantity !== undefined ? med.batch_quantity : (med.quantity !== undefined ? med.quantity : (med.availableStock !== undefined ? med.availableStock : 0)),
        availableLooseStock: med.loose_quantity !== undefined ? med.loose_quantity : (med.availableLooseStock !== undefined ? med.availableLooseStock : 0),
        alternative_batches: med.alternative_batches || []
      };
      
      const nextCart = [...cleanPrev, newItem];
      return rebalanceCartMedicine(nextCart, newItem.medicine_id, newItem.id, { qty: incQty, looseQty: incLooseQty });
    });

    // Fetch doctor combination recommendations
    const medId = med.medicine_id || med.id;
    if (selectedDoctorId && medId) {
      api.getDoctorCombinations(selectedDoctorId, medId)
        .then((data: any[]) => {
          if (Array.isArray(data)) {
            setDoctorComboSuggestions(data);
          }
        })
        .catch(err => {
          console.error('Failed to fetch doctor combinations:', err);
          setDoctorComboSuggestions([]);
        });
    }

    setTimeout(() => {
      const qtyInput = document.getElementById(`row-qty-input-${targetIndex}`);
      if (qtyInput) {
        qtyInput.focus();
        (qtyInput as HTMLInputElement).select();
      }
    }, 120);
  };

  const addMedicineById = async (medicineId: number, lastQty?: number) => {
    const compactInventory = getCompactInventoryCache();
    const batches = compactInventory.filter(item => item.medicine_id === medicineId);
    if (batches.length > 0) {
      const grouped = groupBatches(batches.map(item => ({
        ...item,
        medicine_name: item.name,
        quantity: item.stock_qty,
        alternatives: []
      })));
      if (grouped.length > 0) {
        const item = {
          ...grouped[0],
          recommendedQty: lastQty !== undefined && lastQty !== null ? lastQty : 1
        };
        fetchDetailsAndAddToCart(item);
        return;
      }
    }

    try {
      const details = await api.getMedicineQuickDetails(medicineId);
      addToCart({
        id: Date.now(),
        medicine_id: medicineId,
        name: details.name,
        batch: 'B-GEN',
        expiry: '12/28',
        mrp: details.mrp || 0,
        costPrice: details.mrp ? details.mrp * 0.7 : 0,
        salts: details.api_reference || 'Generic',
        packSize: parsePackSizeFromPackaging(details.packaging) || details.pack_size || 10,
        quantity: 0,
        recommendedQty: lastQty !== undefined && lastQty !== null ? lastQty : 1
      });
    } catch (err) {
      console.error('Failed to add medicine by ID:', err);
    }
  };

  const fetchDetailsAndAddToCart = async (item: any) => {
    try {
      const details = await api.getMedicineQuickDetails(item.medicine_id);
      addToCart({
        id: item.inventory_id,
        medicine_id: item.medicine_id,
        name: item.medicine_name,
        batch: item.batch_no,
        expiry: item.expiry_date,
        mrp: item.mrp,
        costPrice: item.cost_price,
        salts: details.api_reference || details.hsn_code || 'Generic',
        packSize: parsePackSizeFromPackaging(details.packaging) || details.pack_size || parsePackSizeFromPackaging(item.packaging) || item.pack_size || 10,
        quantity: item.quantity,
        batch_quantity: item.batch_quantity,
        loose_quantity: item.loose_quantity,
        alternatives: details.alternatives,
        recommendedQty: item.recommendedQty
      });
    } catch (error) {
      console.warn('Failed to load quick details, adding with fallback values:', error);
      addToCart({
        id: item.inventory_id,
        medicine_id: item.medicine_id,
        name: item.medicine_name,
        batch: item.batch_no,
        expiry: item.expiry_date,
        mrp: item.mrp,
        costPrice: item.cost_price,
        salts: item.salts || item.hsn_code || 'Generic',
        packSize: parsePackSizeFromPackaging(item.packaging) || item.pack_size || 10,
        quantity: item.quantity,
        batch_quantity: item.batch_quantity,
        loose_quantity: item.loose_quantity,
        recommendedQty: item.recommendedQty
      });
    }
  };

  const handleSelectOnlineSuggestion = async (sug: any) => {
    try {
      const res = await api.autoEnrich({
        name: sug.name,
        api_reference: sug.api_reference,
        manufacturer: sug.manufacturer
      });
      
      const newMed = res.data;
      
      addToCart({
        id: Date.now(),
        medicine_id: newMed.id,
        name: newMed.name,
        batch: 'B-GEN',
        expiry: '12/28',
        mrp: 0,
        costPrice: 0,
        salts: newMed.api_reference || 'Generic',
        packSize: 10
      });
      
      setSearchTerm('');
      setOnlineResults([]);
      setSearchResults([]);
    } catch (err: any) {
      alert(`Failed to auto-enrich medicine: ${err.message || 'Unknown error'}`);
    }
  };

  const removeFromCart = (id: number) => {
    updateCart(prevCart => prevCart.filter(item => item.id !== id));
  };

  const changeRowMedicine = (index: number, med: any) => {
    const originalItem = cart[index];
    if (originalItem && originalItem.rawOcrText && originalItem.name.toLowerCase().trim() !== med.medicine_name.toLowerCase().trim()) {
      apiClient.post('/aicamera/learn', {
        ocrText: originalItem.rawOcrText,
        correctName: med.medicine_name
      }).catch(err => console.error('Failed to post correction learning:', err));
    }

    const existingIndex = cart.findIndex((item, idx) => 
      idx !== index && 
      !item.isEmptyRow && 
      ((item.medicine_id !== undefined && med.medicine_id !== undefined && item.medicine_id === med.medicine_id) ||
       (item.name.toLowerCase().trim() === med.medicine_name.toLowerCase().trim()))
    );

    if (existingIndex !== -1) {
      updateCart(prev => {
        const next = prev.map((item, idx) => {
          if (idx === existingIndex) {
            return {
              ...item,
              qty: item.qty + 1
            };
          }
          return item;
        });
        if (originalItem && originalItem.isEmptyRow) {
          return next;
        } else {
          return next.filter((_, idx) => idx !== index);
        }
      });
    } else {
      updateCart(prev => prev.map((item, idx) => {
        if (idx !== index) return item;
        return {
          ...item,
          id: med.inventory_id,
          medicine_id: med.medicine_id,
          name: med.medicine_name,
          batch: med.batch_no,
          expiry: med.expiry_date,
          mrp: med.mrp,
          costPrice: med.cost_price,
          salts: med.salts || med.hsn_code || 'Generic',
          packSize: med.pack_size || 10,
          availableStock: med.batch_quantity !== undefined ? med.batch_quantity : (med.quantity !== undefined ? med.quantity : 0),
          availableLooseStock: med.loose_quantity !== undefined ? med.loose_quantity : 0,
          isEmptyRow: false
        };
      }));
    }

    setActiveRowSearchIndex(null);
    setRowSearchTerm('');
    setRowSearchResults([]);
    setRowSearchHighlightIndex(-1);
  };

  const fetchDetailsAndChangeRowMedicine = async (index: number, med: any) => {
    skipEmptyRowAutofocusRef.current = true;
    try {
      const details = await api.getMedicineQuickDetails(med.medicine_id);
      changeRowMedicine(index, {
        ...med,
        salts: details.api_reference || details.hsn_code || 'Generic',
        alternatives: details.alternatives
      });
    } catch (error) {
      console.warn('Failed to load quick details for row change, falling back:', error);
      changeRowMedicine(index, med);
    }

    setTimeout(() => {
      const qtyInput = document.getElementById(`row-qty-input-${index}`);
      if (qtyInput) {
        qtyInput.focus();
        (qtyInput as HTMLInputElement).select();
      }
    }, 120);
  };

  const updateCartItem = (id: number, field: string, value: any) => {
    updateCart(prevCart => {
      const item = prevCart.find(i => i.id === id);
      if (!item) return prevCart;

      if (field === 'qty' || field === 'looseQty') {
        let updatedQty = item.qty;
        let updatedLoose = item.looseQty;

        if (field === 'qty') {
          updatedQty = Math.max(0, Number(value));
        } else if (field === 'looseQty') {
          const looseVal = Math.max(0, Number(value));
          const pSize = item.packSize || 10;
          if (looseVal >= pSize) {
            const extraStrips = Math.floor(looseVal / pSize);
            updatedQty = (item.qty || 0) + extraStrips;
            updatedLoose = looseVal % pSize;
          } else {
            updatedLoose = looseVal;
          }
        }

        return rebalanceCartMedicine(prevCart, item.medicine_id, id, { qty: updatedQty, looseQty: updatedLoose });
      }

      // Standard mapping for other fields
      return prevCart.map(item => {
        if (item.id !== id) return item;
        let updatedItem = { ...item, [field]: value };

        if (field === 'packSize') {
          const pSize = Math.max(1, Number(value));
          updatedItem.packSize = pSize;
          const looseVal = updatedItem.looseQty || 0;
          if (looseVal >= pSize) {
            const extraStrips = Math.floor(looseVal / pSize);
            updatedItem.qty = (updatedItem.qty || 0) + extraStrips;
            updatedItem.looseQty = looseVal % pSize;
          }
          if (typeof id === 'number' && id < 1000000) {
            api.updateMedicine(id, { pack_size: pSize })
              .catch(err => console.error('Error updating pack size in DB:', err));
          }
        }

        if (field === 'mrp' && typeof id === 'number' && id < 1000000) {
          api.updateMedicine(id, { mrp: Number(value) })
            .catch(err => console.error('Error updating MRP in DB:', err));
        }

        if (field === 'costPrice' && typeof id === 'number' && id < 1000000) {
          api.updateMedicine(id, { purchase_price: Number(value) })
            .catch(err => console.error('Error updating Cost Price in DB:', err));
        }

        return updatedItem;
      });
    });
  };

  const clearCart = () => {
    updateCart([]);
  };

  const handleScanResult = (result: any) => {
    setShowCamera(false);
    if (!result) return;

    const info = result.medicineInfo || {};
    const batchQuery = info.batchNumber;
    const nameQuery = info.potentialName || (result.text ? result.text.split('\n')[0] : '');
    const mrpQuery = info.mrp ? String(info.mrp) : '';

    // Helper to perform the search chain locally
    const executeSearchChain = async () => {
      const compactInventory = getCompactInventoryCache();
      const mapped = compactInventory.map(item => ({
        ...item,
        medicine_name: item.name,
        quantity: item.stock_qty,
        alternatives: []
      }));
      
      // Step 1: Search by batch number (highest precision)
      if (batchQuery && batchQuery.trim().length > 1) {
        const batchTerm = batchQuery.trim().toLowerCase();
        const matches = mapped.filter(m => m.batch_no && m.batch_no.toLowerCase().includes(batchTerm));
        if (matches.length > 0) {
          const exact = matches.find(m => m.batch_no.toLowerCase() === batchTerm);
          return exact || matches[0];
        }
      }

      // Step 2: Search by medicine name (standard lookup)
      if (nameQuery && nameQuery.trim().length > 1) {
        const nameTerm = nameQuery.trim().toLowerCase();
        const matches = filterLocalInventory(nameTerm, mapped);
        if (matches.length > 0) {
          const exact = matches.find(m => m.medicine_name.toLowerCase() === nameTerm);
          return exact || matches[0];
        }
      }

      // Step 3: Search by MRP (fallback lookup)
      if (mrpQuery && mrpQuery.trim().length > 0) {
        const mrpVal = Number(mrpQuery.trim());
        if (!isNaN(mrpVal)) {
          const matches = mapped.filter(m => Math.abs(m.mrp - mrpVal) < 0.01);
          if (matches.length > 0) return matches[0];
        }
      }

      return null;
    };

    executeSearchChain().then(matched => {
      if (matched) {
        fetchDetailsAndAddToCart({
          ...matched,
          scanImage: result.capturedImage,
          rawOcrText: result.text
        });
      } else {
        // Add as custom manual entry from scan details
        addToCart({
          id: Date.now(),
          name: nameQuery.trim() || 'Scanned Item',
          batch: info.batchNumber || 'MANUAL',
          expiry: info.expiryDate || '12/28',
          mrp: info.mrp || 0,
          costPrice: info.mrp ? info.mrp * 0.7 : 0,
          salts: 'OCR Scan Entry',
          packSize: 10,
          scanImage: result.capturedImage,
          rawOcrText: result.text,
          quantity: 0
        });
      }
    }).catch(err => {
      console.error('Scan resolution failed:', err);
    });
  };
  
  // Calculations
  const subtotal = cart.reduce((sum, item) => {
    if (item.isEmptyRow) return sum;
    const unitRate = item.packSize > 0 ? item.mrp / item.packSize : item.mrp;
    const itemTotalBeforeDiscount = (item.mrp * item.qty) + (unitRate * (item.looseQty || 0));
    return sum + itemTotalBeforeDiscount * (1 - (item.discount || 0) / 100);
  }, 0);
  
  const discountAmount = subtotal * (discount / 100);
  const grandTotal = Math.round(subtotal - discountAmount);

  const totalCost = cart.reduce((sum, item) => {
    if (item.isEmptyRow) return sum;
    const itemCost = item.costPrice != null ? item.costPrice : (item.mrp * 0.7);
    const unitCostRate = item.packSize > 0 ? itemCost / item.packSize : itemCost;
    return sum + (itemCost * item.qty) + (unitCostRate * (item.looseQty || 0));
  }, 0);

  const hasValidItems = cart.some(item => !item.isEmptyRow && ((item.name && item.name.trim() !== '') || (item.medicine_name && item.medicine_name.trim() !== '')));
  const profitOrLoss = grandTotal - totalCost;
  const isLoss = hasValidItems && profitOrLoss < -0.001; // Loss greater than 0.1 paise

  const [showPhonePromptModal, setShowPhonePromptModal] = useState(false);
  const [promptPhoneValue, setPromptPhoneValue] = useState('');

  const handleCompleteSale = async (overridePhone?: string, isDirectSave: boolean = false) => {
    if (!hasValidItems) {
      alert('⚠️ CANNOT SAVE BILL:\n\nPlease add at least one valid medicine to the cart before saving the bill.');
      return;
    }
    const phoneToUse = overridePhone !== undefined ? overridePhone : patientPhone;

    if (isLoss) {
      alert(`❌ CANNOT SAVE BILL:\n\nTransaction results in a Net Loss (Grand Total ₹${grandTotal} is less than Cost Price ₹${Math.round(totalCost)}).\nPlease adjust overall discount or items MRP to proceed.`);
      return;
    }

    if (paymentMedium === 'CREDIT') {
      if (!patientName.trim()) {
        alert('Patient/Customer Name is required for Credit transactions to track outstanding balance!');
        return;
      }
      if (!phoneToUse.trim()) {
        setPromptPhoneValue('');
        pendingDirectSaveRef.current = isDirectSave;
        setShowPhonePromptModal(true);
        return;
      }
    }

    // Expiry check
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      const expiryStr = item.expiry || '';
      if (expiryStr) {
        let expDate: Date;
        if (expiryStr.includes('/')) {
          const parts = expiryStr.split('/');
          let year = parseInt(parts[1], 10);
          const month = parseInt(parts[0], 10) - 1;
          if (year < 100) year += 2000;
          expDate = new Date(year, month + 1, 0);
        } else {
          expDate = new Date(expiryStr);
        }
        if (expDate < new Date()) {
          alert(`❌ CRITICAL SAFETY BLOCK:\n\nCart contains EXPIRED product: ${item.name} (${expiryStr}).\nCannot proceed with checkout.`);
          return;
        }
      }
    }
    
    // Stock Level Verification (Strips + Loose units pool check)
    for (const item of cart) {
      if (item.isEmptyRow) continue;
      
      // Only enforce for items that are linked to actual inventory master items
      if (typeof item.id === 'number' && item.id < 1000000) {
        // Skip when stock data never loaded with the item (e.g. restored held bills / old saved tabs);
        // the server re-verifies stock authoritatively and rejects the sale if truly insufficient.
        if (item.availableStock === undefined && item.availableLooseStock === undefined) continue;

        const packSize = item.packSize || 10;
        const reqQty = Number(item.qty || 0);
        const reqLoose = Number(item.looseQty || 0);
        const reqTotalUnits = reqQty * packSize + reqLoose;

        const availQty = Number(item.availableStock !== undefined ? item.availableStock : 0);
        const availLoose = Number(item.availableLooseStock !== undefined ? item.availableLooseStock : 0);
        const availTotalUnits = availQty * packSize + availLoose;
        
        if (availTotalUnits < reqTotalUnits) {
          alert(`❌ INSUFFICIENT STOCK:\n\nMedicine: ${item.name || 'Medicine'}\nRequested: ${reqQty} strips & ${reqLoose} loose (${reqTotalUnits} units)\nAvailable: ${availQty} strips & ${availLoose} loose (${availTotalUnits} units)\n\nPlease reduce the quantity to match available stock before proceeding.`);
          return;
        }
      }
    }
    
    try {
      const salesItems = cart.filter(item => {
        if (item.isEmptyRow) return false;
        const name = item.name || item.medicine_name || '';
        return name.trim() !== '';
      }).map(item => {
        const itemDiscount = item.discount || item.discountPer || 0;
        // Resolve unit price: prefer explicit unitPrice, then mrp, then 1 as absolute fallback
        const resolvedUnitPrice = Number(item.unitPrice || item.mrp || item.unit_price || 1);
        const name = item.name || item.medicine_name || 'Medicine';
        return {
          inventory_id: typeof item.id === 'number' && item.id < 1000000 ? item.id : undefined,
          medicine_name: name,
          batch_no: item.batch || item.batch_no || 'N/A',
          expiry_date: item.expiry || item.expiry_date || '',
          mrp: item.mrp || resolvedUnitPrice,
          quantity: Number(item.qty !== undefined ? item.qty : (item.quantity || 0)),
          unit_price: resolvedUnitPrice,
          loose_qty: item.looseQty || item.loose_qty || 0,
          discount_per: itemDiscount,
          pack_size: item.packSize || item.pack_size || 10
        };
      });

      const payload = {
        items: salesItems,
        discount: discountAmount,
        patient_id: selectedCustomerId || undefined,
        patient_name: patientName || 'Walk-in Customer',
        patient_phone: phoneToUse,
        doctor_name: doctor || undefined,
        total_amount: grandTotal,
        sale_date: (() => {
          const dateParts = date.split('-');
          const combinedDate = new Date();
          if (dateParts.length === 3) {
            combinedDate.setFullYear(parseInt(dateParts[0], 10));
            combinedDate.setMonth(parseInt(dateParts[1], 10) - 1);
            combinedDate.setDate(parseInt(dateParts[2], 10));
          }
          return combinedDate.toISOString();
        })(),
        paymentMedium: paymentMedium,
        paymentStatus: paymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID',
        sendWhatsApp: paymentMedium === 'CREDIT' ? true : sendWhatsApp,
        refillEnabled: refillEnabled,
        refillDays: refillDays,
        refillId: activeRefillId || undefined
      };

      // Verification Layer Check: Pre-save validation
      try {
        const validation = await api.validateBill(payload);
        if (!validation.success) {
          alert(`❌ Save Blocked by Verification Layer:\n\nStep: ${validation.layer}\nReason: ${validation.message}`);
          return;
        }
      } catch (err: any) {
        const serverError = err.response?.data?.message || err.response?.data?.error || err.message;
        const layer = err.response?.data?.layer || 'Validation';
        alert(`❌ Verification Layer Pre-Save Failure:\n\nStep: ${layer}\nReason: ${serverError}`);
        return;
      }

      // Proceed to save bill
      const result = await api.createSale(payload);
      const invoiceNo = result.invoice_no || result.invoiceNo || 'SAVED';

      // Verification Layer Check: Post-save history validation
      if (invoiceNo !== 'SAVED') {
        try {
          const syncVerify = await api.verifySalesHistory(invoiceNo);
          if (!syncVerify.success) {
            console.error(`[Verification Layer] Post-save sync check failed: ${syncVerify.message}`);
          }
        } catch (syncErr: any) {
          console.error('[Verification Layer] Post-save verification API failed:', syncErr);
        }
      }
      
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh the local inventory cache so POS search shows the reduced stock immediately
      api.getCompactInventory().catch(() => {});
      
      const isWaSent = paymentMedium === 'CREDIT' || (sendWhatsApp && !!phoneToUse.trim());

      setLastSavedInvoiceNo(invoiceNo);
      setLastSavedPatientName(patientName || 'Walk-in Customer');
      setLastSavedPatientPhone(phoneToUse);
      setLastSavedGrandTotal(grandTotal);
      setLastSavedPaymentMedium(paymentMedium);
      setLastSavedWasWhatsAppSent(isWaSent);
      setLastSavedItems(cart.filter(item => !item.isEmptyRow).map(item => ({
        name: item.name || item.medicine_name,
        batch: item.batch_number || item.batch_no || 'N/A'
      })));
      
      if (!isDirectSave) {
        setShowBarcodeModal(true);
      } else {
        toastEvent.trigger(`Bill #${invoiceNo} saved successfully! ${isWaSent ? '(SMS dispatched)' : ''}`, 'success');
      }
      
      // Clear cart and states
      updateCart([]);
      setPatientName('');
      setPatientPhone('');
      setDoctor('');
      setSelectedDoctorId(null);
      setDoctorSuggestions([]);
      setDoctorComboSuggestions([]);
      setDiscount(0);
      setPaymentMedium('CASH');
      setActiveRefillId(null);
      setTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            items: [],
            patientName: '',
            patientPhone: '',
            refillEnabled: false,
            refillDays: 30,
            doctor: '',
            discount: 0,
            sendWhatsApp: false,
            paymentMedium: 'CASH',
            selectedDoctorId: null
          };
        }
        return t;
      }));
    } catch (error: any) {
      console.error('Error completing sale:', error);
      // Show actual server error message to help diagnose the issue
      const serverMsg = error?.response?.data?.error || error?.message || 'Unknown error';
      alert(`Failed to save sale:\n\n${serverMsg}\n\nIf this persists, check that the backend server is running.`);
    }
  };

  const handleRegisterDoctor = async () => {
    try {
      if (!newDoctorName) return;
      const docName = newDoctorSpecialty ? `Dr. ${newDoctorName} (${newDoctorSpecialty})` : `Dr. ${newDoctorName}`;
      const res = await api.addDoctor({
        name: docName,
        specialization: newDoctorSpecialty || 'General',
        phone: newDoctorPhone,
        clinic_name: newDoctorClinic,
        reg_no: newDoctorRegNo
      });
      // Refresh doctors list
      queryClient.invalidateQueries({ queryKey: ['crm-doctors'] });
      setDoctor(docName);
      if (res && res.id) {
        setSelectedDoctorId(res.id);
      }
      setShowDoctorModal(false);
      setNewDoctorName('');
      setNewDoctorSpecialty('');
      setNewDoctorPhone('');
      setNewDoctorClinic('');
      setNewDoctorRegNo('');
    } catch (err) {
      console.error(err);
      alert('Failed to register doctor');
    }
  };

  // Doctors are defined at the top using useMemo

  return (
    <div className="h-full flex flex-col fade-in overflow-hidden pb-2 bg-bg text-text">

      {/* Main Container: Split into Left Workspace and Right Sidebar */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* LEFT WORKSPACE (approx 72-75% width) - Takes up full height */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 min-w-0">
          
          {/* Patient & Doctor Context Bar */}
          <div className="glass-panel p-4 bg-glass-bg border-glass-border shrink-0 relative z-40 shadow-md rounded-2xl w-full min-w-0">
            {matchedRefill && (
              <div className="mb-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
                  <span>
                    <strong>{matchedRefill.patient_name}</strong> has a pending refill for <strong>{matchedRefill.medicine_name}</strong>. Add to this bill?
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAcceptRefill}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-[11px] transition-all shadow-sm"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => { setDismissedRefillId(matchedRefill.id); setMatchedRefill(null); }}
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-muted hover:text-text rounded-lg font-bold text-[11px] transition-all border border-glass-border"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              {/* Patient Name */}
              <div className="relative z-20">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Patient / Customer</label>
                <div className="flex gap-1 items-center">
                  <input 
                    id="patient-name-input"
                    type="text" 
                    autoComplete="off"
                    className="premium-input text-xs h-9 px-3 flex-1 w-full bg-bg2/40 border-border/60 rounded-xl" 
                    placeholder="Walk-in Customer" 
                    value={patientName}
                    onChange={e => { updatePatientName(e.target.value); setPatientHighlightIndex(-1); }}
                    onFocus={() => { if (patientSuggestions.length > 0) setShowPatientSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowPatientSuggestions(false), 180)}
                    onKeyDown={e => {
                      if (!showPatientSuggestions || patientSuggestions.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setPatientHighlightIndex(i => Math.min(i + 1, patientSuggestions.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setPatientHighlightIndex(i => Math.max(i - 1, 0));
                      } else if ((e.key === 'Enter' || e.key === 'Tab') && patientHighlightIndex >= 0) {
                        e.preventDefault();
                        const sel = patientSuggestions[patientHighlightIndex];
                        updatePatientName(sel.name);
                        setPatientPhone(sel.phone || '');
                        setSelectedCustomerId(sel.id);
                        setShowPatientSuggestions(false);
                        setPatientHighlightIndex(-1);
                      } else if (e.key === 'Escape') {
                        setShowPatientSuggestions(false);
                        setPatientHighlightIndex(-1);
                      }
                    }}
                    aria-label="Patient Name"
                  />
                  {showPatientSuggestions && (
                    <div ref={patientSuggestionsRef} className="absolute left-0 right-0 top-full z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto shadow-2xl">
                      {patientSuggestions.map((c, idx) => {
                        const hasCreditDue = (c.credit_balance && c.credit_balance > 0) || c.credit_enabled === 1;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            data-highlighted={idx === patientHighlightIndex ? "true" : "false"}
                            onMouseDown={() => {
                              updatePatientName(c.name);
                              setPatientPhone(c.phone || '');
                              setSelectedCustomerId(c.id);
                              setShowPatientSuggestions(false);
                              setPatientHighlightIndex(-1);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 text-[16px] border-b border-border/10 transition-all flex items-center justify-between gap-2 ${
                              idx === patientHighlightIndex
                                ? 'bg-primary/20 text-text font-bold'
                                : hasCreditDue
                                ? 'bg-amber-500/5 hover:bg-amber-500/10 text-text'
                                : 'text-text hover:bg-primary/10'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold truncate">{c.name}</span>
                              {hasCreditDue && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[10px] font-bold leading-none">
                                  ₹ Credit
                                  {c.credit_balance > 0 && (
                                    <span className="ml-0.5 opacity-80">₹{Number(c.credit_balance).toFixed(0)}</span>
                                  )}
                                </span>
                              )}
                            </div>
                            {c.phone && <span className="text-muted font-mono text-[13px] shrink-0">{c.phone}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button 
                    onClick={() => setShowPatientModal(true)}
                    className="h-9 w-9 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary transition-all flex items-center justify-center shrink-0"
                    title="Manage Patient Profile & Refills"
                  >
                    <Plus size={14} className="stroke-[3]" />
                  </button>
                </div>
              </div>

              {/* WhatsApp Contact */}
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">WhatsApp Number</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    className="premium-input text-xs h-9 px-3 w-full font-mono text-text bg-bg2/40 border-border/60 rounded-xl" 
                    placeholder="9876543210"
                    value={patientPhone}
                    onChange={e => setPatientPhone(e.target.value)}
                    aria-label="Phone Number"
                  />
                  <button 
                    onClick={() => setSendWhatsApp(!sendWhatsApp)}
                    className={`h-9 px-3 rounded-xl border text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 transition-all select-none shrink-0 ${
                      sendWhatsApp 
                        ? 'bg-green/15 border-green/30 text-green hover:bg-green/25' 
                        : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                    }`}
                    title={sendWhatsApp ? "WhatsApp Notifications Active" : "WhatsApp Notifications Inactive"}
                  >
                    {sendWhatsApp ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
                        <span>WA: ON</span>
                      </>
                    ) : (
                      <span>WA: OFF</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Doctor */}
              <div className="relative z-20">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Prescribing Doctor</label>
                <div className="flex gap-1 relative">
                  <input 
                    type="text"
                    autoComplete="off"
                    className="premium-input text-xs h-9 pl-3 pr-7 bg-bg2/40 border-border/60 w-full text-text focus:border-sky rounded-xl"
                    placeholder="Type or Select Doctor..."
                    value={doctor}
                    onChange={e => { setDoctor(e.target.value); setDoctorHighlightIndex(-1); }}
                    onFocus={() => {
                      setIsDoctorDropdownOpen(true);
                      doctorsControl.requestLoad();
                    }}
                    onBlur={() => setTimeout(() => setIsDoctorDropdownOpen(false), 200)}
                    onKeyDown={e => {
                      if (!isDoctorDropdownOpen || filteredDoctors.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setDoctorHighlightIndex(i => Math.min(i + 1, filteredDoctors.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setDoctorHighlightIndex(i => Math.max(i - 1, 0));
                      } else if ((e.key === 'Enter' || e.key === 'Tab') && doctorHighlightIndex >= 0) {
                        e.preventDefault();
                        const sel = filteredDoctors[doctorHighlightIndex];
                        setDoctor(sel.name);
                        setSelectedDoctorId(sel.id);
                        setIsDoctorDropdownOpen(false);
                        setDoctorHighlightIndex(-1);
                      } else if (e.key === 'Escape') {
                        setIsDoctorDropdownOpen(false);
                        setDoctorHighlightIndex(-1);
                      }
                    }}
                    title="Select or Type Doctor Name"
                  />
                  <span className="absolute inset-y-0 right-11 pr-2 flex items-center pointer-events-none text-muted">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </span>
                  
                  {isDoctorDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto shadow-2xl">
                      {filteredDoctors.length > 0 ? (
                        filteredDoctors.map((doc, idx) => (
                          <button
                            key={doc.id}
                            type="button"
                            onMouseDown={() => {
                              setDoctor(doc.name);
                              setSelectedDoctorId(doc.id);
                              setIsDoctorDropdownOpen(false);
                              setDoctorHighlightIndex(-1);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 text-[16px] border-b border-border/10 transition-all font-semibold ${
                              idx === doctorHighlightIndex
                                ? 'bg-sky/20 text-text font-bold'
                                : 'text-text hover:bg-sky/10'
                            }`}
                          >
                            {doc.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-3.5 py-2.5 text-[16px] text-muted italic">
                          Press Enter to add custom: "{doctor}"
                        </div>
                      )}
                    </div>
                  )}
                  <button 
                    onClick={() => setShowDoctorModal(true)}
                    className="h-9 w-9 rounded-xl bg-sky/10 hover:bg-sky/20 border border-sky/20 text-sky transition-all flex items-center justify-center shrink-0"
                    title="Register New Doctor"
                  >
                    <Plus size={14} className="stroke-[3]" />
                  </button>
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Billing Date</label>
                <input 
                  type="date" 
                  className="premium-input text-xs h-9 px-3 text-text w-full font-mono bg-bg2/40 border-border/60 rounded-xl" 
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  aria-label="Transaction Date"
                />
              </div>
            </div>
          </div>

          {/* A. Search & Scan Medicine Area (Header) */}
          <div className="glass-panel p-4 flex flex-col gap-3 bg-glass-bg border-glass-border relative z-30 shrink-0 shadow-md w-full min-w-0 overflow-hidden">
            <div className="flex items-center gap-3">
              <div ref={productSearchRef} className="relative flex-1">
                <span className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-muted">
                  {inventoryIndexReady ? <Search size={18} /> : <Loader2 size={18} className="animate-spin" />}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder={inventoryIndexReady ? "Search medicine by name, composition, batch, or price..." : "Warming up search index..."}
                  disabled={!inventoryIndexReady}
                  className="premium-input w-full text-sm pl-10 pr-4 py-2.5 bg-bg2/40 border-border/60 text-text rounded-2xl focus:ring-primary/20 disabled:opacity-60 disabled:cursor-wait"
                  value={searchTerm}
                  onFocus={() => setShowSearchDropdown(true)}
                  onChange={e => {
                    setSearchTerm(e.target.value);
                    setShowSearchDropdown(true);
                  }}
                  onKeyDown={e => {
                    if (searchResults.length === 0) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSearchHighlightIndex(i => Math.min(i + 1, searchResults.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSearchHighlightIndex(i => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      if (searchHighlightIndex >= 0 && searchHighlightIndex < searchResults.length) {
                        e.preventDefault();
                        const item = searchResults[searchHighlightIndex];
                        fetchDetailsAndAddToCart(item);
                        setSearchTerm('');
                        setSearchResults([]);
                        setSearchHighlightIndex(-1);
                        setShowSearchDropdown(false);
                      }
                    } else if (e.key === 'Escape') {
                      setSearchResults([]);
                      setSearchHighlightIndex(-1);
                      setShowSearchDropdown(false);
                    }
                  }}
                />
                
                {/* Empty inventory fallback dropdown */}
                {showSearchDropdown && searchTerm.trim().length >= 3 && searchResults.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                    {suggestions.length > 0 && (
                      <div className="p-3 border-b border-border/30 bg-violet-500/5">
                        <span className="text-[13px] font-bold text-violet-400 uppercase tracking-wider block mb-1.5">Did you mean:</span>
                        <div className="flex gap-2 flex-wrap">
                          {suggestions.map((sug) => (
                            <button
                              key={sug.medicine_id}
                              type="button"
                              onClick={() => {
                                setSearchTerm(sug.name);
                              }}
                              className="px-2.5 py-1.5 text-[16px] rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/20 transition-all font-medium"
                            >
                              {sug.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="p-3 border-b border-border/30 text-[13px] font-bold text-muted uppercase tracking-wider bg-bg3/55">
                      ⚠️ No matching inventory found
                    </div>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          addToCart({
                            id: Date.now(),
                            name: searchTerm.trim(),
                            batch: 'MANUAL',
                            expiry: '12/28',
                            mrp: 0,
                            costPrice: 0,
                            salts: 'Custom Manual Entry',
                            packSize: 10,
                            quantity: 0
                          });
                          setSearchTerm('');
                          setShowSearchDropdown(false);
                        }}
                        className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/20 text-left transition-all text-[16px] w-full group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-text group-hover:text-primary transition-all">Add "{searchTerm.trim()}" directly to cart (Quick Add)</span>
                          <span className="text-[13px] text-muted font-normal">Will use default batch MANUAL and expiry 12/28 (editable later)</span>
                        </div>
                        <span className="text-[14px] bg-primary/10 border border-primary/20 text-primary py-1.5 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-text transition-all">+ Add</span>
                      </button>

                      {searchingOnline && (
                        <div className="flex items-center justify-center p-4 text-[16px] text-muted gap-2 border-t border-border/20 bg-bg3/20">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-3 bg-bg3/55 border-t border-border/30 text-[13px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database)
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[13px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || 'Generic'}</strong></span>
                                {sug.manufacturer && <span className="text-[13px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[14px] bg-sky/10 border border-sky/20 text-sky py-1.5 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-text transition-all">✨ Import & Add</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Search results dropdown */}
                {showSearchDropdown && searchResults.length > 0 && (
                  <div ref={searchResultsRef} className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                    {suggestions.length > 0 && (
                      <div className="p-3 border-b border-border/30 bg-violet-500/5">
                        <span className="text-[13px] font-bold text-violet-400 uppercase tracking-wider block mb-1.5">Did you mean:</span>
                        <div className="flex gap-2 flex-wrap">
                          {suggestions.map((sug) => (
                            <button
                              key={sug.medicine_id}
                              type="button"
                              onClick={() => {
                                apiClient.post('/medicines/learn-correction', {
                                  originalQuery: searchTerm,
                                  correctedMedicineId: sug.medicine_id,
                                  context: 'POS_FUZZY_SUGGESTION'
                                }).catch(err => console.error('Failed to learn correction:', err));
                                setSearchTerm(sug.name);
                              }}
                              className="px-2.5 py-1.5 text-[16px] rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/20 transition-all font-medium"
                            >
                              {sug.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="p-3 border-b border-border/30 bg-bg3/55 text-[13px] font-bold text-muted uppercase tracking-wider">
                      Matching Inventory Records:
                    </div>
                    <div className="flex flex-col">
                      {searchResults.map((med) => {
                        const renderMedicineItem = (item: any, isAlt = false) => {
                          const isHighlighted = !isAlt && searchHighlightIndex === searchResults.indexOf(item);
                          const packSize = item.pack_size || 10;
                          const totalUnits = (item.quantity || 0) * packSize + (item.loose_quantity || 0);
                          const cartUnits = cart.reduce((sum, c) => {
                            const isSameMed = c.medicine_id === item.medicine_id || 
                              (c.name || c.medicine_name || '').toLowerCase().trim() === (item.medicine_name || '').toLowerCase().trim();
                            if (isSameMed && !c.isEmptyRow) {
                              return sum + (Number(c.qty || c.quantity || 0) * packSize) + Number(c.looseQty || 0);
                            }
                            return sum;
                          }, 0);
                          const remainingUnits = Math.max(0, totalUnits - cartUnits);
                          const remainingPacks = Math.floor(remainingUnits / packSize);
                          const isLowStockAlert = remainingPacks <= 3;

                          return (
                            <button
                              key={item.inventory_id || `item_${item.medicine_id}_${Math.random()}`}
                              type="button"
                              data-highlighted={isHighlighted ? "true" : "false"}
                              onClick={() => {
                                fetchDetailsAndAddToCart(item);
                                setSearchTerm('');
                                setSearchResults([]);
                                setShowSearchDropdown(false);
                              }}
                              className={`flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group ${
                                isAlt ? 'pl-8 bg-sky/5' : ''
                              } ${
                                isLowStockAlert ? 'bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-amber-500' : ''
                              } ${
                                isHighlighted ? 'bg-primary/10 border-l-2 border-primary' : ''
                              }`}
                            >
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {isAlt && <span className="text-[13px] bg-sky/20 text-sky px-1.5 py-0.5 rounded font-bold mr-1">ALT</span>}
                                  <span className="font-semibold text-text group-hover:text-primary transition-all">{item.medicine_name}</span>
                                  {isLowStockAlert && (
                                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider">
                                      ⚠️ Low Stock ({remainingPacks} Left • Refill Needed)
                                    </span>
                                  )}
                                </div>
                                <span className="text-[13px] text-muted">
                                  Company: <span className="text-text font-semibold">{item.manufacturer || 'Generic'}</span>
                                  {item.quantity !== undefined && (() => {
                                    const remainingLoose = remainingUnits % packSize;
                                    const hasLoose = (item.loose_quantity !== undefined && item.loose_quantity > 0) || remainingLoose > 0;
                                    return (
                                      <span className={`ml-3 font-mono font-semibold ${isLowStockAlert ? 'text-amber-400' : 'text-primary'}`}>
                                        Stock: {remainingPacks} Str
                                        {hasLoose && ` / ${remainingLoose} Tab`}
                                      </span>
                                    );
                                  })()}
                                </span>
                                {!isAlt && (!item.api_reference || item.api_reference.trim() === '') && (
                                  <span 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const res = await api.queueFromPos(item.medicine_id);
                                        navigate(`/composition-queue?highlight=${res.id}`);
                                      } catch (err) {
                                        console.error('Failed to queue medicine from POS:', err);
                                      }
                                    }}
                                    className="text-[13px] text-violet-400 hover:text-violet-300 font-bold underline cursor-pointer w-fit mt-0.5"
                                  >
                                    Verify composition ↗
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="font-mono text-green font-bold">MRP: ₹{Math.round(item.mrp)}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditMedicineId(item.medicine_id);
                                    }}
                                    className="p-1.5 rounded-lg bg-bg border border-border/40 text-muted hover:text-text hover:bg-bg3 transition-all"
                                    title="Quick Edit Medicine"
                                  >
                                    <Edit size={12} />
                                  </button>
                                  <span className="text-[14px] bg-primary/10 border border-primary/20 text-primary py-1.5 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-text transition-all">+ Add</span>
                                </div>
                              </div>
                            </button>
                          );
                        };

                        const cartQty = cart.reduce((sum, c) => {
                          if (c.medicine_id === med.medicine_id) {
                            return sum + c.qty;
                          }
                          return sum;
                        }, 0);
                        const isOutOfStock = med.is_out_of_stock || (med.quantity !== undefined && (med.quantity - cartQty) <= 0);

                        if (isOutOfStock) {
                          return (
                            <div key={`oos_${med.medicine_id}`} className="flex flex-col border-b border-border/10">
                              <div className="p-3 bg-red-500/5 text-[16px] w-full flex flex-col gap-1 border-l-2 border-red-500">
                                 <div className="flex items-center justify-between">
                                   <div>
                                     <span className="font-bold text-red-400 line-through mr-2">{med.medicine_name}</span>
                                     <span className="text-[13px] text-red-400 font-bold uppercase border border-red-500/20 px-1.5 py-0.5 rounded bg-red-500/10">Out of Stock</span>
                                   </div>
                                 </div>
                                 {med.alternatives && med.alternatives.length > 0 && (
                                   <div className="text-[13px] text-sky font-bold flex items-center gap-1.5 mt-1">
                                     <span className="h-1.5 w-1.5 bg-sky rounded-full animate-ping"></span> 
                                     Alternatives in stock (same composition):
                                   </div>
                                 )}
                              </div>
                              {med.alternatives && med.alternatives.map((alt: any) => renderMedicineItem(alt, true))}
                            </div>
                          );
                        }

                        return (
                          <div key={`in_stock_${med.inventory_id}`} className="flex flex-col">
                            {renderMedicineItem(med, false)}
                            {med.alternatives && med.alternatives.length > 0 && (
                              <div className="flex flex-col border-l-2 border-sky/30 ml-2 bg-bg3/30">
                                <div className="px-6 py-1.5 bg-sky/5 text-[13px] text-sky font-bold uppercase tracking-wider flex items-center gap-1">
                                  <span className="rotate-90">↱</span> Substitutes Available:
                                </div>
                                {med.alternatives.map((alt: any) => renderMedicineItem(alt, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {searchingOnline && (
                        <div className="flex items-center justify-center p-3 text-[16px] text-muted gap-2 border-t border-border/10 bg-bg3/25">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-3 border-t border-border/30 bg-bg3/55 text-[13px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database):
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[13px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || 'Generic'}</strong></span>
                                {sug.manufacturer && <span className="text-[13px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[14px] bg-sky/10 border border-sky/20 text-sky py-1.5 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-text transition-all">✨ Import & Add</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <button 
                type="button"
                onClick={() => setShowCamera(true)}
                className="premium-btn bg-primary text-text shadow-[0_4px_14px_rgba(59,130,246,0.25)] hover:bg-teal-500 transition-all flex items-center gap-2 px-5 h-10.5 rounded-2xl shrink-0"
              >
                <Camera size={18} />
                <span>AI Camera Scan</span>
              </button>
            </div>

            {/* Doctor Combination Suggestions */}
            {doctorComboSuggestions.length > 0 && (
              <div className="flex items-center gap-2 bg-bg2/30 border border-border/20 px-3 py-2 rounded-xl w-full min-w-0 overflow-hidden">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider select-none shrink-0">
                  🤝 Together with:
                </span>
                <div className="flex gap-2 overflow-x-auto scrollbar-thin min-w-0 flex-1 w-full">
                  {doctorComboSuggestions.map(med => (
                    <button
                      key={med.id}
                      onClick={() => addMedicineById(med.id, med.last_qty)}
                      className="flex items-center gap-1.5 bg-bg border border-border hover:border-primary/50 hover:bg-primary/5 px-2.5 py-1 rounded-full transition-all group whitespace-nowrap"
                    >
                      <span className="text-[11px] font-semibold text-text group-hover:text-primary transition-all">
                        {med.name}
                        <span className="text-[9px] text-sky ml-1 font-mono font-bold">
                          (x{med.co_count}{med.last_qty ? `, Last: ${med.last_qty}` : ''})
                        </span>
                      </span>
                      <span className="text-[10px] text-primary font-bold">+</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Add / Doctor Suggestions */}
            {doctorSuggestions.length > 0 ? (
              <div className="border-t border-border/30 pt-2 flex flex-col gap-1.5 w-full min-w-0 overflow-hidden">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 select-none">
                  ⚡ {doctor}'s Prescriptions:
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin w-full">
                  {doctorSuggestions.map(med => (
                    <button
                      key={med.id}
                      onClick={() => addMedicineById(med.id, med.last_qty)}
                      className="flex items-center gap-2.5 bg-bg2 border border-border/50 hover:border-primary/50 hover:bg-primary/5 px-3 py-1.5 rounded-full transition-all group whitespace-nowrap"
                    >
                      <span className="text-xs font-semibold text-text group-hover:text-primary transition-all">
                        {med.name}
                        <span className="text-[9px] text-sky ml-1.5 font-mono font-bold">
                          (x{med.frequency}{med.last_qty ? `, Last: ${med.last_qty}` : ''})
                        </span>
                      </span>
                      <span className="text-[10px] text-primary font-bold">+</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              combinationsControl.mode === 'manual' && !combinationsControl.loaded ? (
                <div className="border-t border-border/30 pt-2 flex flex-col gap-1.5 w-full min-w-0 overflow-hidden items-center justify-center py-2.5">
                  <span className="text-xs text-muted mb-1.5">Quick Add suggestions are deferred.</span>
                  <button
                    type="button"
                    onClick={() => combinationsControl.requestLoad()}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all cursor-pointer"
                  >
                    Load Suggestions
                  </button>
                </div>
              ) : (
                commonCombinations.length > 0 && (
                  <div className="border-t border-border/30 pt-2 flex flex-col gap-1.5 w-full min-w-0 overflow-hidden">
                    <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 select-none">
                      ⚡ Quick Add (Frequently Sold):
                    </span>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin w-full">
                      {commonCombinations.map(med => (
                        <button
                          key={med.id}
                          onClick={() => addToCart(med)}
                          className="flex items-center gap-2.5 bg-bg2 border border-border/50 hover:border-primary/50 hover:bg-primary/5 px-3 py-1.5 rounded-full transition-all group whitespace-nowrap"
                        >
                          <span className="text-xs font-semibold text-text group-hover:text-primary transition-all">
                            {med.name}
                            {med.recommendationMsg && (
                              <span className="text-[9px] text-sky ml-1.5 font-mono font-bold">
                                ({med.recommendedQty > 0 ? `${med.recommendedQty} Str` : `${med.recommendedLooseQty} Tab`})
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-primary font-bold">+</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )
            )}
          </div>

          {/* B. Cart Panel - Takes up all remaining height */}
          <div className="flex-1 glass-panel flex flex-col overflow-hidden bg-glass-bg border-glass-border relative z-10 min-h-0 min-w-0 shadow-md w-full">
            {/* Cart Header / Tab System */}
            <div className="p-2.5 border-b border-border flex items-center justify-between gap-3 bg-bg3/30 flex-nowrap shrink-0 rounded-t-[2rem]">
              <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 scrollbar-thin py-0.5">
                {tabs.map((t) => {
                  const isActive = t.id === activeTabId;
                  const count = getTabItemsCount(t);
                  const displayName = t.patientName.trim() ? `Pt: ${t.patientName}` : t.name;
                  return (
                    <div
                      key={t.id}
                      onClick={() => switchTab(t.id)}
                      className={`flex items-center gap-2 px-3.5 py-1.8 rounded-xl border font-bold text-xs transition-all select-none cursor-pointer flex-shrink-0 whitespace-nowrap ${
                        isActive 
                          ? 'bg-primary/10 border-primary text-primary shadow-[inset_0_0_12px_rgba(59,130,246,0.1)]' 
                          : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      <ShoppingCart size={13} className={isActive ? 'text-primary' : 'text-muted'} />
                      <span>{displayName} ({count})</span>
                      {tabs.length > 1 && (
                        <span 
                          onClick={(e) => closeTab(t.id, e)}
                          className="hover:bg-bg3 rounded-full p-0.5 ml-1 transition-all cursor-pointer flex items-center justify-center text-muted hover:text-text"
                          title="Close Tab"
                        >
                          <X size={10} />
                        </span>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={addNewTab}
                  className="flex items-center justify-center flex-shrink-0 p-1.5 rounded-xl border border-dashed border-border text-muted hover:text-text hover:border-text transition-all bg-bg hover:bg-bg2 h-[28px] w-[28px]"
                  title="Add New Cart"
                >
                  <Plus size={13} />
                </button>
              </div>
              
              <div className="flex items-center gap-2 ml-auto">
                {specialOrdersControl.mode === 'manual' && !specialOrdersControl.loaded && (
                  <button
                    type="button"
                    onClick={() => specialOrdersControl.requestLoad()}
                    className="px-3 py-1.5 rounded-xl text-[10px] font-extrabold uppercase bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 transition-all cursor-pointer mr-1"
                  >
                    Load Special Orders
                  </button>
                )}
                <button 
                  onClick={clearCart}
                  className="premium-btn bg-red/10 border border-red/20 text-red text-xs py-1.5 px-3 hover:bg-red/20 transition-all flex items-center gap-1.5 rounded-xl"
                >
                  <Trash2 size={12} /> Clear Cart
                </button>
              </div>
            </div>

            {/* Cart Table Container */}
            <div className="flex-1 overflow-auto bg-bg/25 scrollbar-thin">
              <table className="w-full text-left border-collapse text-[16px]">
                <thead className="sticky top-0 bg-bg2/95 backdrop-blur-xl z-10">
                  <tr>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border">Medicine</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border">Batch</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Expiry</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Strip</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Loose</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Live Stock</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-center">Disc %</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-right">MRP</th>
                    <th className="p-3 text-[13px] font-bold text-muted uppercase tracking-wider border-b-2 border-border text-right">Total</th>
                    <th className="p-3 text-[13px] font-bold text-muted tracking-wider border-b-2 border-border"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map(item => {
                    const unitRate = item.packSize > 0 ? item.mrp / item.packSize : item.mrp;
                    const itemTotal = ((item.mrp * item.qty) + (unitRate * (item.looseQty || 0))) * (1 - (item.discount || 0) / 100);
                    
                    // Near expiry highlight
                    let expBadgeClass = "bg-bg3 border border-border text-text";
                    if (item.expiry) {
                      const parts = item.expiry.split('/');
                      if (parts.length === 2) {
                        let year = parseInt(parts[1], 10);
                        const month = parseInt(parts[0], 10) - 1;
                        if (year < 100) year += 2000;
                        const expDate = new Date(year, month + 1, 0);
                        const diffMs = expDate.getTime() - new Date().getTime();
                        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        if (diffDays <= 90) {
                          expBadgeClass = "bg-amber-500/10 border border-amber-500/30 text-amber-500 font-bold";
                        }
                      }
                    }

                    return (
                      <tr key={item.id} data-medicine-id={item.medicine_id} className="border-b border-border/30 hover:bg-bg2/40 transition-all h-[52px]">
                        {/* Medicine Search/Change */}
                        <td className="p-3 min-w-[180px] relative">
                          <div className="flex items-center">
                            {item.scanImage && (
                              <div className="relative group/thumb shrink-0 mr-2.5 select-none animate-in fade-in duration-200">
                                <img
                                  src={item.scanImage}
                                  alt="Scan thumbnail"
                                  loading="lazy"
                                  decoding="async"
                                  className="w-9 h-9 object-cover rounded-xl border border-border/60 hover:border-primary/60 transition-all cursor-zoom-in shadow-sm"
                                  onClick={() => setZoomedImage(item.scanImage)}
                                />
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover/thumb:block z-[100] bg-bg2 border border-border rounded-xl p-2 shadow-2xl w-48 animate-in fade-in duration-150">
                                  <img src={item.scanImage} alt="Scan preview" loading="lazy" decoding="async" className="w-full h-auto rounded-lg object-contain" />
                                  <div className="text-[8px] text-muted text-center mt-1 font-semibold">Click to enlarge</div>
                                </div>
                              </div>
                            )}
                            <div ref={activeRowSearchIndex === cart.indexOf(item) ? activeRowRef : null} className="flex-1 relative">
                              <input 
                                id={`row-med-input-${cart.indexOf(item)}`}
                                type="text" 
                                autoComplete="off"
                                className="w-full bg-transparent border-0 border-b border-transparent hover:border-border/60 focus:border-primary/60 focus:ring-0 text-[16px] font-semibold text-text py-1 px-1 rounded"
                                value={activeRowSearchIndex === cart.indexOf(item) ? rowSearchTerm : item.name}
                                onChange={e => {
                                  const val = e.target.value;
                                  const idx = cart.indexOf(item);
                                  setActiveRowSearchIndex(idx);
                                  setRowSearchTerm(val);
                                }}
                                onFocus={() => {
                                  const idx = cart.indexOf(item);
                                  setActiveRowSearchIndex(idx);
                                  setRowSearchTerm(item.name);
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setActiveRowSearchIndex(null);
                                    setRowSearchTerm('');
                                    setRowSearchResults([]);
                                    setRowSearchHighlightIndex(-1);
                                  }, 200);
                                }}
                                onKeyDown={e => {
                                  const idx = cart.indexOf(item);
                                  if (activeRowSearchIndex !== idx || rowSearchResults.length === 0) return;
                                  if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setRowSearchHighlightIndex(i => Math.min(i + 1, rowSearchResults.length - 1));
                                  } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setRowSearchHighlightIndex(i => Math.max(i - 1, 0));
                                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                                    if (rowSearchHighlightIndex >= 0 && rowSearchHighlightIndex < rowSearchResults.length) {
                                      e.preventDefault();
                                      fetchDetailsAndChangeRowMedicine(idx, rowSearchResults[rowSearchHighlightIndex]);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setActiveRowSearchIndex(null);
                                    setRowSearchTerm('');
                                    setRowSearchResults([]);
                                    setRowSearchHighlightIndex(-1);
                                  }
                                }}
                                placeholder={item.isEmptyRow ? "Search medicine..." : "Change medicine..."}
                              />
                              
                              {activeRowSearchIndex === cart.indexOf(item) && rowSearchResults.length > 0 && (
                                <div ref={rowSearchResultsRef} className="absolute left-0 right-0 z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-56 overflow-y-auto w-[320px] shadow-2xl">
                                  {rowSearchResults.map((med) => {
                                    const rowPendingMatches = specialOrders.filter(
                                      o => o.product.toLowerCase().trim() === med.medicine_name.toLowerCase().trim() ||
                                           med.medicine_name.toLowerCase().includes(o.product.toLowerCase().trim())
                                    );
                                    const rowHasPending = rowPendingMatches.length > 0;
                                    const isRowHighlighted = rowSearchHighlightIndex === rowSearchResults.indexOf(med);
                                    return (
                                      <button
                                        key={med.inventory_id}
                                        type="button"
                                        data-highlighted={isRowHighlighted ? "true" : "false"}
                                        onClick={() => {
                                          const idx = cart.indexOf(item);
                                          fetchDetailsAndChangeRowMedicine(idx, med);
                                        }}
                                        className={`flex flex-col p-3 hover:bg-bg3 border-b border-border/10 text-left transition-all text-[16px] w-full ${isRowHighlighted ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
                                      >
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-semibold text-text">{med.medicine_name}</span>
                                          {rowHasPending && (
                                            <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 px-1.5 py-0.5 rounded text-[13px] font-bold animate-pulse">
                                              ⚠️ {rowPendingMatches[0].requester} ({rowPendingMatches[0].qty})
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[13px] text-muted font-mono mt-0.5">Batch: {med.batch_no} | Exp: {med.expiry_date}</span>
                                        <span className="text-[13px] text-green font-bold font-mono mt-0.5">
                                          MRP: ₹{Math.round(med.mrp)} | Stock: {(() => {
                                            const packSize = med.pack_size || 10;
                                            const totalUnits = (med.quantity || 0) * packSize + (med.loose_quantity || med.loose_qty || 0);
                                            const cartUnits = cart.reduce((sum, c) => {
                                              const isSameMed = c.medicine_id === med.medicine_id || 
                                                (c.name || c.medicine_name || '').toLowerCase().trim() === (med.medicine_name || '').toLowerCase().trim();
                                              if (isSameMed && !c.isEmptyRow) {
                                                return sum + (Number(c.qty || c.quantity || 0) * packSize) + Number(c.looseQty || 0);
                                              }
                                              return sum;
                                            }, 0);
                                            const remainingUnits = Math.max(0, totalUnits - cartUnits);
                                            const remainingPacks = Math.floor(remainingUnits / packSize);
                                            const remainingLoose = remainingUnits % packSize;
                                            const hasLoose = (med.loose_quantity !== undefined && med.loose_quantity > 0) || (med.loose_qty !== undefined && med.loose_qty > 0) || remainingLoose > 0;
                                            return `${remainingPacks} Str${hasLoose ? ` / ${remainingLoose} Tab` : ''}`;
                                          })()}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Batch Selection */}
                        <td className="p-3 relative">
                          <div className="relative">
                            <input
                              type="text"
                              className={`w-28 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-[16px] font-mono font-semibold py-1.5 px-2 rounded-lg ${item.isEmptyRow ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                              value={item.batch || ''}
                              placeholder="Batch"
                              readOnly
                              disabled={item.isEmptyRow}
                              onKeyDown={e => {
                                const allowedKeys = ['Tab', 'Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'];
                                if (!allowedKeys.includes(e.key)) {
                                  e.preventDefault();
                                }
                              }}
                              onPaste={e => e.preventDefault()}
                              onFocus={() => {
                                if (item.isEmptyRow) return;
                                setActiveBatchRowId(item.id);
                                api.searchMedicine(item.name)
                                  .then(data => {
                                    if (Array.isArray(data)) {
                                      const matches = data.filter(med => med.medicine_name.toLowerCase().trim() === item.name.toLowerCase().trim());
                                      setRowBatchesList(matches.length > 0 ? matches : data);
                                    }
                                  })
                                  .catch(err => console.error('Error fetching batches:', err));
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  if (activeBatchRowId === item.id) {
                                    setActiveBatchRowId(null);
                                  }
                                }, 250);
                              }}
                            />
                            
                            {activeBatchRowId === item.id && rowBatchesList.length > 1 && (
                              <div className="absolute left-1 z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto w-64 text-left shadow-2xl">
                                <div className="p-2.5 border-b border-border/30 bg-bg3/60 text-[13px] font-bold text-muted uppercase tracking-wider">
                                  Switch Batch:
                                </div>
                                {rowBatchesList.map(b => {
                                  const otherCartQty = cart.reduce((sum, c) => {
                                    if (c.id === item.id) return sum; // exclude current row
                                    if (c.id === b.inventory_id || (c.medicine_id === b.medicine_id && c.batch === b.batch_no)) {
                                      return sum + c.qty;
                                    }
                                    return sum;
                                  }, 0);
                                  const liveStock = Math.max(0, (b.quantity !== undefined ? b.quantity : 0) - otherCartQty);
                                  return (
                                    <button
                                      key={b.inventory_id}
                                      type="button"
                                      onMouseDown={() => {
                                        updateCart(prev => prev.map(cItem => {
                                          if (cItem.id !== item.id) return cItem;
                                          return {
                                            ...cItem,
                                            id: b.inventory_id,
                                            batch: b.batch_no,
                                            expiry: b.expiry_date,
                                            mrp: b.mrp,
                                            costPrice: b.cost_price,
                                            packSize: b.pack_size || cItem.packSize,
                                            availableStock: b.quantity !== undefined ? b.quantity : 0,
                                            availableLooseStock: b.loose_quantity !== undefined ? b.loose_quantity : 0
                                          };
                                        }));
                                        setActiveBatchRowId(null);
                                      }}
                                      className={`w-full text-left px-3 py-2 hover:bg-sky/15 border-b border-border/10 text-[16px] font-mono transition-all block ${b.batch_no === item.batch ? 'bg-sky/10 text-sky' : 'text-text'}`}
                                    >
                                      <span className="font-bold block">{b.batch_no}</span>
                                      <span className="text-muted block text-[13px]">Exp: {b.expiry_date} | Stock: {liveStock} Str {b.loose_quantity !== undefined && b.loose_quantity > 0 && `/ ${b.loose_quantity} Tab`} | MRP: ₹{b.mrp}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                        
                        {/* Expiry */}
                        <td className="p-3 text-center">
                          <div className={`font-mono text-[16px] font-bold px-3 py-1 rounded-lg inline-block shadow-sm ${expBadgeClass}`}>
                            {item.isEmptyRow ? '-' : item.expiry}
                          </div>
                        </td>

                        {/* Qty & Stock */}
                        {/* Strip Qty — own column */}
                        <td className="p-3 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-[16px] font-bold text-muted">-</div>;
                            }
                            return (
                              <div className="flex items-center justify-center">
                                <div className="flex items-center gap-1.5 bg-bg/40 border border-border/40 hover:border-border/80 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 rounded-lg px-3 py-1">
                                  <input 
                                    id={`row-qty-input-${cart.indexOf(item)}`}
                                    type="number" 
                                    className="w-12 text-center bg-transparent border-0 focus:ring-0 p-0 text-[16px] font-mono font-bold text-text focus:outline-none"
                                    value={item.qty === 0 || item.qty === undefined || item.qty === null ? '' : item.qty}
                                    onChange={e => updateCartItem(item.id, 'qty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                                    min="0"
                                    placeholder="0"
                                    disabled={item.isEmptyRow}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const looseInput = document.getElementById(`row-loose-input-${cart.indexOf(item)}`);
                                        if (looseInput) {
                                          looseInput.focus();
                                          (looseInput as HTMLInputElement).select();
                                        }
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Loose Qty — own column */}
                        <td className="p-3 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-[16px] font-bold text-muted">-</div>;
                            }
                            return (
                              <div className="flex items-center justify-center">
                                <div className="flex items-center gap-1.5 bg-amber-500/5 border border-amber-500/20 hover:border-amber-500/40 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/20 rounded-lg px-3 py-1">
                                  <input 
                                    id={`row-loose-input-${cart.indexOf(item)}`}
                                    type="number" 
                                    className="w-12 text-center bg-transparent border-0 focus:ring-0 p-0 text-[16px] font-mono font-bold text-amber-500 focus:outline-none"
                                    value={item.looseQty === 0 || item.looseQty === undefined || item.looseQty === null ? '' : item.looseQty}
                                    onChange={e => updateCartItem(item.id, 'looseQty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                                    min="0"
                                    placeholder="0"
                                    disabled={item.isEmptyRow}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const currentIdx = cart.indexOf(item);
                                        const nextIdx = currentIdx + 1;
                                        const nextMedInput = document.getElementById(`row-med-input-${nextIdx}`);
                                        if (nextMedInput) {
                                          nextMedInput.focus();
                                          (nextMedInput as HTMLInputElement).select();
                                        }
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Live Stock — own column */}
                        <td className="p-3 text-center">
                          {(() => {
                            if (item.isEmptyRow) {
                              return <div className="font-mono text-[16px] font-bold text-muted">-</div>;
                            }
                            const compactInventory = getCompactInventoryCache();
                            const medicineBatches = compactInventory.filter(inv => inv.medicine_id === item.medicine_id);
                            
                            let remainingStock: number | string = 'N/A';
                            let remainingLoose = 0;
                            const packSize = item.packSize || 10;
                            
                            if (medicineBatches.length > 0) {
                              const totalAvailableStock = medicineBatches.reduce((sum, b) => sum + (b.stock_qty || 0), 0);
                              const totalAvailableLooseStock = medicineBatches.reduce((sum, b) => sum + (b.loose_quantity || 0), 0);
                              
                              const totalCartQty = cart.reduce((sum, c) => {
                                if (!c.isEmptyRow && c.medicine_id === item.medicine_id) {
                                  return sum + (c.qty || 0);
                                }
                                return sum;
                              }, 0);
                              const totalCartLoose = cart.reduce((sum, c) => {
                                if (!c.isEmptyRow && c.medicine_id === item.medicine_id) {
                                  return sum + (c.looseQty || 0);
                                }
                                return sum;
                              }, 0);

                              const totalUnits = (totalAvailableStock * packSize) + totalAvailableLooseStock;
                              const cartUnits = (totalCartQty * packSize) + totalCartLoose;
                              const remainingUnits = Math.max(0, totalUnits - cartUnits);

                              remainingStock = Math.floor(remainingUnits / packSize);
                              remainingLoose = remainingUnits % packSize;
                            } else if (item.availableStock !== undefined) {
                              const totalAvailableStock = item.availableStock;
                              const totalAvailableLooseStock = item.availableLooseStock || 0;

                              const totalUnits = (totalAvailableStock * packSize) + totalAvailableLooseStock;
                              const cartUnits = (item.qty * packSize) + (item.looseQty || 0);
                              const remainingUnits = Math.max(0, totalUnits - cartUnits);

                              remainingStock = Math.floor(remainingUnits / packSize);
                              remainingLoose = remainingUnits % packSize;
                            }
                            return (
                              <div className={`text-[14px] select-none font-bold font-mono px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${
                                (typeof remainingStock === 'number' && remainingStock <= 0 && remainingLoose <= 0)
                                  ? 'bg-red/5 border-red/20 text-red animate-pulse'
                                  : (typeof remainingStock === 'number' && remainingStock <= 10)
                                  ? 'bg-amber-500/5 border-amber-500/20 text-amber-500'
                                  : 'bg-green/5 border-green/20 text-green'
                              }`}>
                                {remainingStock} / {remainingLoose}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Discount */}
                        <td className="p-3 text-center">
                          <input 
                            type="number" 
                            className={`w-16 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-[16px] font-mono font-bold text-sky py-1.5 px-2 rounded-lg ${item.isEmptyRow ? 'opacity-40 cursor-not-allowed' : ''}`}
                            value={item.isEmptyRow ? '' : (item.discount === 0 || item.discount === undefined || item.discount === null ? '' : item.discount)}
                            onChange={e => updateCartItem(item.id, 'discount', e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                            min="0"
                            max="100"
                            disabled={item.isEmptyRow}
                          />
                        </td>

                        {/* MRP */}
                        <td className="p-3 text-right">
                          <input 
                            type="number" 
                            className={`w-20 text-right font-mono bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-[16px] py-1.5 px-2 rounded-lg ${item.isEmptyRow ? 'opacity-40 cursor-not-allowed' : ''}`} 
                            value={item.isEmptyRow ? '' : (item.mrp || '')}
                            placeholder="0.00"
                            onChange={e => updateCartItem(item.id, 'mrp', Math.max(0, Number(e.target.value)))}
                            disabled={item.isEmptyRow}
                          />
                        </td>

                        {/* Total */}
                        <td className="p-3 text-right">
                          <div className="font-mono text-[16px] font-bold text-green pr-1">
                            {item.isEmptyRow ? '-' : `₹${Math.round(itemTotal)}`}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.medicine_id) setEditMedicineId(item.medicine_id);
                              }}
                              disabled={!item.medicine_id}
                              className={`p-1.5 rounded-lg transition-all ${item.medicine_id ? 'hover:bg-sky/10 text-muted hover:text-sky' : 'opacity-30 cursor-not-allowed text-muted'}`}
                              title="Quick Edit Medicine"
                            >
                              <Edit size={16} />
                            </button>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="p-1.5 hover:bg-red/10 text-muted hover:text-red rounded-lg transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Section 3: Checkout Summary & Total */}
          <div className="glass-panel p-4 bg-glass-bg border-glass-border flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 shadow-lg rounded-2xl">
            <div className="flex items-center gap-2 text-xs text-text uppercase tracking-wider shrink-0 font-bold">
              <span>💳</span> Payment & Checkout
            </div>
            
            <div className="flex flex-1 flex-col md:flex-row items-center gap-6 justify-end w-full">
              {/* Subtotal & Discount */}
              <div className="flex items-center gap-4 text-xs">
                <div className="text-muted">
                  Subtotal: <span className="font-mono text-text font-semibold ml-1">₹{Math.round(subtotal)}</span>
                </div>
                
                <div className="flex items-center gap-2 text-muted">
                  <span>Discount %:</span>
                  <input 
                    type="number" 
                    className="premium-input text-xs py-0.5 px-1.5 w-14 text-center font-mono bg-bg border-border rounded-lg" 
                    value={discount === 0 || discount === undefined || discount === null ? '' : discount}
                    onChange={e => setDiscount(e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                    min="0"
                    max="100"
                  />
                </div>

                {discountAmount > 0 && (
                  <div className="text-amber-500 font-bold bg-amber-500/5 px-2.5 py-1 rounded-lg border border-amber-500/20 text-xs">
                    Discount: -₹{Math.round(discountAmount)}
                  </div>
                )}
              </div>

              {/* Payment selector */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Method:</span>
                <div className="flex bg-bg3 border border-border rounded-xl p-1 gap-1">
                  {[
                    { id: 'CASH', label: '💵 Cash', activeClass: 'bg-green/15 text-green border-green/30' },
                    { id: 'UPI', label: '📱 UPI', activeClass: 'bg-primary/15 text-primary border-primary/30' },
                    { id: 'CREDIT', label: '💳 Credit', activeClass: 'bg-amber-500/15 text-amber-500 border-amber-500/30' }
                  ].map(item => (
                    <label key={item.id} className="relative cursor-pointer select-none">
                      <input 
                        type="radio" 
                        name="payment_medium" 
                        value={item.id} 
                        checked={paymentMedium === item.id} 
                        onChange={e => setPaymentMedium(e.target.value)}
                        className="sr-only peer"
                      />
                      <span className={`py-1 px-3.5 rounded-lg text-[10px] uppercase font-bold tracking-wider block border transition-all ${
                        paymentMedium === item.id 
                          ? `${item.activeClass} border shadow-sm` 
                          : 'border-transparent text-muted hover:text-text hover:bg-bg2/40'
                      }`}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Grand Total & Save Buttons */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-baseline gap-2 mr-1">
                  <span className="text-xs font-extrabold text-primary uppercase tracking-wider">Total:</span>
                  <span className="font-mono text-xl font-black text-primary">₹{grandTotal}</span>
                </div>

                <button 
                  onClick={() => handleCompleteSale(undefined, true)}
                  disabled={cart.length === 0}
                  title="Save bill directly without popup"
                  className={`py-2 px-4 text-xs flex items-center gap-1.5 font-bold uppercase tracking-wider rounded-xl transition-all h-9 select-none ${
                    cart.length === 0 
                      ? 'bg-bg3 border border-border text-muted cursor-not-allowed' 
                      : 'bg-sky text-text hover:bg-sky/90 shadow-[0_4px_14px_rgba(14,165,233,0.25)] hover:-translate-y-0.5'
                  }`}
                >
                  <Zap size={14} /> Direct Save
                </button>

                <button 
                  onClick={() => handleCompleteSale(undefined, false)}
                  disabled={cart.length === 0}
                  className={`py-2 px-4 text-xs flex items-center gap-1.5 font-bold uppercase tracking-wider rounded-xl transition-all h-9 select-none ${
                    cart.length === 0 
                      ? 'bg-bg3 border border-border text-muted cursor-not-allowed' 
                      : 'bg-green text-text hover:bg-emerald-600 shadow-[0_4px_14px_rgba(16,185,129,0.25)] hover:-translate-y-0.5'
                  }`}
                >
                  <CheckCircle size={14} /> Save Bill (Ctrl+S)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCamera && (
        <AICamera 
          onClose={() => setShowCamera(false)} 
          onScanResult={handleScanResult} 
        />
      )}

      {zoomedImage && createPortal(
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-global-modal flex items-center justify-center p-4 cursor-pointer animate-in fade-in duration-200"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-3xl max-h-[85vh] bg-bg2 border border-border rounded-2xl overflow-hidden p-2 shadow-2xl animate-in zoom-in-95 duration-200">
            <img src={zoomedImage} alt="Zoomed medicine scan" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <button 
              className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-text rounded-full p-2 transition-all"
              onClick={() => setZoomedImage(null)}
              aria-label="Close zoomed image"
            >
              <X size={20} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Credit Phone Number Requirement Prompt Modal */}
      {showPhonePromptModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-modal p-4 animate-fade-in">
          <div className="glass-panel max-w-md w-full p-6 space-y-4 border-border bg-bg2/95 rounded-2xl relative shadow-2xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-base text-text">
                <Send size={18} className="text-primary" />
                WhatsApp Number Required for Credit Bill
              </h3>
              <button 
                onClick={() => setShowPhonePromptModal(false)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              To save this credit transaction and automatically send the instant WhatsApp credit PDF bill, please enter the mobile number for <strong className="text-text">{patientName || 'Customer'}</strong>:
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted uppercase tracking-wider">WhatsApp Phone Number</label>
              <input
                type="tel"
                placeholder="Enter 10-digit phone number (e.g. 9876543210)"
                value={promptPhoneValue}
                onChange={e => setPromptPhoneValue(e.target.value)}
                autoFocus
                className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl text-sm text-text font-mono focus:outline-none focus:border-primary shadow-inner"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = promptPhoneValue.trim();
                    if (!val) { alert('Please enter a WhatsApp contact number'); return; }
                    setPatientPhone(val);
                    setShowPhonePromptModal(false);
                    handleCompleteSale(val, pendingDirectSaveRef.current);
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowPhonePromptModal(false)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = promptPhoneValue.trim();
                  if (!val) { alert('Please enter a WhatsApp contact number'); return; }
                  setPatientPhone(val);
                  setShowPhonePromptModal(false);
                  handleCompleteSale(val, pendingDirectSaveRef.current);
                }}
                className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-md"
              >
                <Send size={14} />
                Save &amp; Send Credit Bill
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Patient Profile & Auto-Refills Modal */}
      {showPatientModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-modal p-4 animate-fade-in">
          <div className="glass-panel max-w-md w-full p-6 space-y-5 border-border bg-bg2/95 rounded-2xl relative shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-lg text-text">
                <UserCheck size={20} className="text-primary" />
                Manage Patient & Refills
              </h3>
              <button 
                onClick={() => setShowPatientModal(false)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4">
              {/* Patient ID */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider">Patient Card ID</span>
                <input 
                  type="text" 
                  className="premium-input w-full text-xs font-mono py-2 px-3 bg-bg3/40 cursor-not-allowed rounded-xl" 
                  value={patientId}
                  disabled
                  title="Auto-generated unique card ID"
                />
              </div>

              {/* Patient Name */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider">Full Name</span>
                <input 
                  type="text" 
                  className="premium-input w-full text-sm py-2 px-3 bg-bg2/50 border-border/80 rounded-xl" 
                  placeholder="Enter full name" 
                  value={patientName}
                  onChange={e => updatePatientName(e.target.value)}
                />
              </div>

              {/* WhatsApp / Phone */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Phone size={12} className="text-green" /> WhatsApp / Contact Number
                </span>
                <input 
                  type="text" 
                  className="premium-input w-full text-sm font-mono py-2 px-3 bg-bg2/50 border-border/80 rounded-xl" 
                  placeholder="e.g. 9130558910" 
                  value={patientPhone}
                  onChange={e => setPatientPhone(e.target.value)}
                />
              </div>

              {/* Auto-Refill Manager Section */}
              <div className="border border-border rounded-2xl p-4 bg-bg3/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                      🔄 Auto-Refill Reminders
                    </span>
                    <p className="text-[10px] text-muted">Generate recurring WhatsApp stock notifications</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer" aria-label="Toggle Refill">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={refillEnabled}
                      onChange={e => setRefillEnabled(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-text after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-text"></div>
                  </label>
                </div>

                {refillEnabled && (
                  <div className="space-y-3 pt-2 border-t border-border/40 animate-fade-in">
                    <div className="space-y-1.5">
                      <span className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                        <Calendar size={12} /> Refill Interval (Days)
                      </span>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          className="premium-input text-sm font-mono py-1.5 px-3 w-20 text-center bg-bg border-border rounded-xl" 
                          value={refillDays}
                          onChange={e => setRefillDays(Math.min(100, Math.max(1, Number(e.target.value))))}
                          min="1"
                          max="100"
                        />
                        <div className="flex gap-1 flex-1">
                          {[30, 60, 90].map(days => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setRefillDays(days)}
                              className={`text-xs py-1 px-2.5 rounded-xl border font-mono transition-all flex-1 ${refillDays === days ? 'bg-primary/20 border-primary text-primary' : 'bg-bg2 border-border text-muted hover:text-text'}`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interactive 1-100 Days Slider */}
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[10px] text-muted font-semibold">
                          <span>1 day</span>
                          <span className="text-primary font-bold">{refillDays} days</span>
                          <span>100 days</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={refillDays}
                          onChange={e => setRefillDays(Number(e.target.value))}
                          className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-2 border-t border-border flex justify-end gap-3">
              <button 
                onClick={() => setShowPatientModal(false)}
                className="premium-btn bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 py-2 px-4 text-xs font-bold uppercase tracking-wider rounded-xl"
              >
                Cancel
              </button>
              <button 
                onClick={handleSavePatientProfile}
                className="premium-btn bg-primary text-text hover:bg-teal-500 py-2 px-5 text-xs font-bold uppercase tracking-wider rounded-xl shadow-md"
              >
                Save Profile (Ctrl+S)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Doctor Registration Modal */}
      {showDoctorModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-border bg-bg3/30 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2 text-sky text-sm">
                <Plus size={18} />
                Register New Doctor
              </h3>
              <button onClick={() => setShowDoctorModal(false)} className="text-muted hover:text-text transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Doctor Name *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-semibold">Dr.</span>
                  <input
                    type="text"
                    className="premium-input w-full pl-9 rounded-xl bg-bg2/40 border-border"
                    placeholder="John Doe"
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Specialization</label>
                <input
                  type="text"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="e.g. Cardiologist"
                  value={newDoctorSpecialty}
                  onChange={(e) => setNewDoctorSpecialty(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Phone</label>
                <input
                  type="text"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="Contact Number"
                  value={newDoctorPhone}
                  onChange={(e) => setNewDoctorPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Clinic Name</label>
                <input
                  type="text"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="Clinic / Hospital Name"
                  value={newDoctorClinic}
                  onChange={(e) => setNewDoctorClinic(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted uppercase tracking-wider">Registration No.</label>
                <input
                  type="text"
                  className="premium-input w-full rounded-xl bg-bg2/40 border-border"
                  placeholder="e.g. MMC-12345"
                  value={newDoctorRegNo}
                  onChange={(e) => setNewDoctorRegNo(e.target.value)}
                />
              </div>
            </div>
            
            <div className="px-5 py-4 border-t border-border bg-bg3/30 flex justify-end gap-3">
              <button 
                onClick={() => setShowDoctorModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-text hover:bg-bg2 transition-all border border-transparent"
              >
                Cancel
              </button>
              <button 
                onClick={handleRegisterDoctor}
                disabled={!newDoctorName}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-sky text-text hover:bg-sky/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(14,165,233,0.2)]"
              >
                <CheckCircle size={16} /> Save Doctor
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Post-Sale Saved Bill Confirmation Modal */}
      {showBarcodeModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md fade-in">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-green/10 border border-green/20 text-green mb-1">
                <CheckCircle size={32} className="animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-text">Sale Saved Successfully!</h3>
              <p className="text-xs text-muted">Invoice No: <span className="font-mono text-sky font-semibold">#{lastSavedInvoiceNo}</span></p>
            </div>

            <div className="bg-bg2/60 border border-border/40 p-4 rounded-xl space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted font-medium">Customer:</span>
                <span className="font-bold text-text">{lastSavedPatientName}</span>
              </div>
              {lastSavedPatientPhone && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted font-medium">Contact Phone:</span>
                  <span className="font-mono text-text font-semibold">{lastSavedPatientPhone}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-xs pt-2 border-t border-border/40">
                <span className="text-muted font-medium">Total Amount:</span>
                <span className="font-mono font-black text-primary text-sm">₹{lastSavedGrandTotal}</span>
              </div>
            </div>

            {/* SMS Status / Manual Dispatch option */}
            <div className="p-3.5 rounded-xl border text-xs flex items-center gap-3 bg-bg3/50 border-border/50">
              <MessageSquare size={18} className={lastSavedWasWhatsAppSent ? "text-green shrink-0" : "text-muted shrink-0"} />
              <div className="flex-1 min-w-0">
                {lastSavedPaymentMedium === 'CREDIT' ? (
                  <p className="font-semibold text-amber-500 text-[11px] leading-tight">
                    ⚡ Credit Sale: Instant SMS/WhatsApp message sent automatically
                  </p>
                ) : lastSavedWasWhatsAppSent ? (
                  <p className="font-semibold text-green text-[11px] leading-tight">
                    ✅ SMS/WhatsApp message sent to customer
                  </p>
                ) : lastSavedPatientPhone ? (
                  <p className="text-muted text-[11px] leading-tight">
                    SMS message not sent (WA toggle was OFF).
                  </p>
                ) : (
                  <p className="text-muted text-[11px] italic leading-tight">
                    No phone number saved for this sale.
                  </p>
                )}
              </div>
              {!lastSavedWasWhatsAppSent && lastSavedPatientPhone && lastSavedInvoiceNo && (
                <button
                  onClick={async () => {
                    try {
                      const res = await api.sendWhatsappMessage(
                        lastSavedPatientPhone,
                        `Dear ${lastSavedPatientName},\n\n📄 *Sale Invoice: #${lastSavedInvoiceNo}*\nAmount Paid: ₹${lastSavedGrandTotal}\nThank you for your purchase!\n— AI Pharmacy OS`
                      );
                      if (res && res.success !== false) {
                        setLastSavedWasWhatsAppSent(true);
                        alert('SMS/WhatsApp message sent successfully!');
                      } else {
                        alert('Failed to send SMS message.');
                      }
                    } catch (err) {
                      console.error(err);
                      alert('Error sending SMS message');
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold uppercase bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all shrink-0"
                >
                  Send SMS
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() => {
                  window.print();
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_12px_rgba(59,130,246,0.2)] flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Print Bill
              </button>

              <button
                onClick={() => {
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={14} /> Done / Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {editMedicineId && (
        <Suspense fallback={<ModalSkeleton />}>
          <UniversalMedicineEditModal 
            medicineId={editMedicineId} 
            onClose={() => setEditMedicineId(null)} 
            onSave={async () => {
              const currentMedId = editMedicineId;
              if (!currentMedId) return;
              try {
                const details = await api.getMedicineQuickDetails(currentMedId);
                const newPackSize = parsePackSizeFromPackaging(details.packaging) || details.pack_size || 10;
                
                updateCart(prevCart => {
                  const updatedCart = prevCart.map(item => {
                    if (!item.isEmptyRow && item.medicine_id === currentMedId) {
                      return {
                        ...item,
                        name: details.name,
                        packSize: newPackSize,
                        mrp: details.mrp || item.mrp,
                        salts: details.api_reference || details.hsn_code || item.salts,
                      };
                    }
                    return item;
                  });

                  const targetItem = updatedCart.find(item => !item.isEmptyRow && item.medicine_id === currentMedId);
                  if (targetItem) {
                    return rebalanceCartMedicine(updatedCart, currentMedId, targetItem.id, {});
                  }
                  return updatedCart;
                });
              } catch (err) {
                console.error('Failed to update cart items after quick edit save:', err);
              }
            }} 
          />
        </Suspense>
      )}

    </div>
  );
};

export default POS;
