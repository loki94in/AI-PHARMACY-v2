import { useState, useEffect, useRef } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { Search, ShoppingCart, Trash2, CheckCircle, Camera, Plus, X, Phone, Calendar, UserCheck, Edit, Loader2 } from 'lucide-react';
import AICamera from '../../components/AICamera';
import BrandBanner from '../../components/POS/BrandBanner';
import { api, apiClient } from '../../services/api';

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

const POS = () => {
  const initialTabs = getInitialPOSTabs();
  const initialActiveTabId = getInitialPOSActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t.id === initialActiveTabId) || initialTabs[0];

  const [searchTerm, setSearchTerm] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [patientName, setPatientName] = useState(initialActiveTab.patientName || '');
  const [patientPhone, setPatientPhone] = useState(initialActiveTab.patientPhone || '');
  const [patientId] = useState('P-' + Math.floor(100000 + Math.random() * 900000));
  const [refillEnabled, setRefillEnabled] = useState(initialActiveTab.refillEnabled || false);
  const [refillDays, setRefillDays] = useState(initialActiveTab.refillDays || 30);
  const [activeRefillId, setActiveRefillId] = useState<number | null>(null);

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
              packSize: matched.pack_size || 10
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

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState('');
  const [lastSavedItems, setLastSavedItems] = useState<any[]>([]);
  const [doctor, setDoctor] = useState(initialActiveTab.doctor || '');
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const [doctorHighlightIndex, setDoctorHighlightIndex] = useState(-1);
  const [isManualDoctor, setIsManualDoctor] = useState(initialActiveTab.isManualDoctor || false);
  
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
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [cart, setCart] = useState<any[]>(initialActiveTab.items || []);
  const [sendWhatsApp, setSendWhatsApp] = useState(initialActiveTab.sendWhatsApp || false); // DEFAULT: OFF
  const [paymentMedium, setPaymentMedium] = useState<string>(initialActiveTab.paymentMedium || 'CASH'); // DEFAULT: CASH
  const [specialOrders, setSpecialOrders] = useState<any[]>(cachedSpecialOrders ? cachedSpecialOrders.filter(o => o.status === 'Pending' || o.status === 'Ordered') : []);
  const [rowBatchesList, setRowBatchesList] = useState<any[]>([]);
  const [activeBatchRowId, setActiveBatchRowId] = useState<number | null>(null);
  const [commonCombinations, setCommonCombinations] = useState<any[]>(cachedCommonCombinations || []);

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
        t.paymentMedium !== paymentMedium
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
          paymentMedium
        };
        return next;
      }
      return prev;
    });
  }, [cart, patientName, patientPhone, refillEnabled, refillDays, doctor, isManualDoctor, discount, sendWhatsApp, paymentMedium, activeTabId]);

  // Save tabs and activeTabId to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('pos_draft_tabs', JSON.stringify(tabs));
  }, [tabs]);

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
      paymentMedium: 'CASH'
    };

    setCart([]);
    setPatientName('');
    setPatientPhone('');
    setRefillEnabled(false);
    setRefillDays(30);
    setDoctor('');
    setIsManualDoctor(false);
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
      return cart.length;
    }
    return tab.items ? tab.items.length : 0;
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
  
  const [doctorsList, setDoctorsList] = useState<any[]>(cachedDoctors || []);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [onlineResults, setOnlineResults] = useState<any[]>([]);
  const [searchingOnline, setSearchingOnline] = useState(false);

  const [activeRowSearchIndex, setActiveRowSearchIndex] = useState<number | null>(null);
  const [rowSearchTerm, setRowSearchTerm] = useState('');
  const [rowSearchResults, setRowSearchResults] = useState<any[]>([]);

  useEffect(() => {
    if (activeRowSearchIndex === null || rowSearchTerm.trim().length < 3) {
      setRowSearchResults([]);
      return;
    }
    
    const delayDebounce = setTimeout(() => {
      api.searchMedicine(rowSearchTerm)
        .then(data => {
          if (Array.isArray(data)) {
            setRowSearchResults(data);
          }
        })
        .catch(err => console.error('Error searching row medicine:', err));
    }, 300);
    
    return () => clearTimeout(delayDebounce);
  }, [rowSearchTerm, activeRowSearchIndex]);

  useDeferredEffect(() => {
    // Silent background refresh of doctors
    api.getDoctors()
      .then(data => {
        if (Array.isArray(data)) {
          setDoctorsList(data);
          cachedDoctors = data;
        }
      })
      .catch(err => console.error('Error fetching doctors:', err));
      
    // Fetch quick-add common combinations from inventory using limit: 12 (P1)
    if (!cachedCommonCombinations) {
      api.getInventory({ limit: 12 })
        .then(async data => {
          if (Array.isArray(data)) {
            // Take top 12 active inventory items as quick adds
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

            // Batch enrich with recommended quantities in a single backend call!
            try {
              const medNames = topItems.map(m => m.name).join(',');
              const response = await apiClient.get('/sales/recommend-quantity/batch', { params: { medicineNames: medNames } });
              const recommendations = response.data || {};

              const enriched = topItems.map(med => {
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

              setCommonCombinations(enriched);
              cachedCommonCombinations = enriched;
            } catch (err) {
              console.error('Batch quantity enrichment failed:', err);
              setCommonCombinations(topItems);
              cachedCommonCombinations = topItems;
            }
          }
        })
        .catch(err => console.error('Error fetching common combinations:', err));
    }
  }, []);

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
            setShowPatientSuggestions(data.length > 0);
          }
        })
        .catch(() => {});
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounce);
  }, [patientName]);

  useDeferredEffect(() => {
    // Skip remote fetch if already cached to prevent redundant DB query
    api.getOrders()
      .then(data => {
        if (Array.isArray(data)) {
          cachedSpecialOrders = data;
          const active = data.filter(o => o.status === 'Pending' || o.status === 'Ordered');
          setSpecialOrders(active);
        }
      })
      .catch(err => console.error('Error fetching special orders:', err));
  }, []);

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
      setOnlineResults([]);
      setSearchingOnline(false);
      return;
    }
    
    const delayDebounce = setTimeout(() => {
      api.searchMedicine(searchTerm)
        .then(data => {
          if (Array.isArray(data)) {
            // Premium Barcode Auto-Add Feature:
            // If there is exactly one result, and the search term exactly matches its barcode (item_code),
            // auto-add it to the cart and clear the search box.
            const term = searchTerm.trim().toUpperCase();
            if (data.length === 1) {
              const matched = data[0];
              const barcode = (matched.item_code || '').toUpperCase().trim();
              if (barcode === term && matched.inventory_id && !matched.is_out_of_stock) {
                addToCart({
                  id: matched.inventory_id,
                  medicine_id: matched.medicine_id,
                  name: matched.medicine_name,
                  batch: matched.batch_no,
                  expiry: matched.expiry_date,
                  mrp: matched.mrp,
                  costPrice: matched.cost_price,
                  salts: matched.salts || matched.hsn_code || 'Generic',
                  packSize: matched.pack_size || 10,
                  quantity: matched.quantity
                });
                setSearchTerm('');
                setSearchResults([]);
                return;
              }
            }

            setSearchResults(data);
            setOnlineResults([]);
            setSearchingOnline(false);
          }
        })
        .catch(err => {
          console.error('Error searching medicines:', err);
          setSearchingOnline(false);
        });
    }, 300);
    
    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  // Universal Edit state
  const [editMedicineId, setEditMedicineId] = useState<number | null>(null);

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
    updateCart(prevCart => {
      const existing = prevCart.find(item => {
        const isDbId = (id: any) => typeof id === 'number' && id < 1000000;
        const idMatches = isDbId(item.id) && isDbId(med.id) && item.id === med.id;
        const nameAndBatchMatch = 
          (item.medicine_id !== undefined && med.medicine_id !== undefined && item.medicine_id === med.medicine_id && item.batch.toLowerCase().trim() === (med.batch || 'B-GEN').toLowerCase().trim()) ||
          (item.name.toLowerCase().trim() === med.name.toLowerCase().trim() && item.batch.toLowerCase().trim() === (med.batch || 'B-GEN').toLowerCase().trim());
        return idMatches || nameAndBatchMatch;
      });
      const incQty = med.recommendedQty !== undefined ? med.recommendedQty : 1;
      const incLooseQty = med.recommendedLooseQty || 0;
      if (existing) {
        return prevCart.map(item => 
          item.id === existing.id ? { 
            ...item, 
            qty: item.qty + incQty,
            looseQty: (item.looseQty || 0) + incLooseQty
          } : item
        );
      }
      return [...prevCart, { 
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
        availableStock: med.quantity !== undefined ? med.quantity : (med.availableStock !== undefined ? med.availableStock : 0)
      }];
    });
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
        availableStock: med.quantity !== undefined ? med.quantity : 0
      };
    }));
    setActiveRowSearchIndex(null);
    setRowSearchTerm('');
    setRowSearchResults([]);
  };

  const updateCartItem = (id: number, field: string, value: any) => {
    updateCart(prevCart => prevCart.map(item => {
      if (item.id !== id) return item;
      
      let updatedItem = { ...item, [field]: value };
      
      if (field === 'looseQty') {
        const looseVal = Math.max(0, Number(value));
        const pSize = updatedItem.packSize || 10;
        if (looseVal >= pSize) {
          const extraStrips = Math.floor(looseVal / pSize);
          updatedItem.qty = (updatedItem.qty || 0) + extraStrips;
          updatedItem.looseQty = looseVal % pSize;
        } else {
          updatedItem.looseQty = looseVal;
        }
      }

      if (field === 'packSize') {
        const pSize = Math.max(1, Number(value));
        updatedItem.packSize = pSize;
        const looseVal = updatedItem.looseQty || 0;
        if (looseVal >= pSize) {
          const extraStrips = Math.floor(looseVal / pSize);
          updatedItem.qty = (updatedItem.qty || 0) + extraStrips;
          updatedItem.looseQty = looseVal % pSize;
        }
        
        // Trigger global SQLite database update for pack size if it is a saved inventory item
        if (typeof id === 'number' && id < 1000000) {
          api.updateMedicine(id, { pack_size: String(pSize) })
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
    }));
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

    // Helper to perform the search chain
    const executeSearchChain = async () => {
      // Step 1: Search by batch number (highest precision)
      if (batchQuery && batchQuery.trim().length > 1) {
        try {
          const data = await api.searchMedicine(batchQuery.trim());
          if (Array.isArray(data) && data.length > 0) {
            // Find an exact batch match if possible
            const exactBatch = data.find(m => m.batch_no?.toLowerCase().trim() === batchQuery.toLowerCase().trim());
            return exactBatch || data[0];
          }
        } catch (e) { console.warn('Batch search failed:', e); }
      }

      // Step 2: Search by medicine name (standard lookup)
      if (nameQuery && nameQuery.trim().length > 1) {
        try {
          const data = await api.searchMedicine(nameQuery.trim());
          if (Array.isArray(data) && data.length > 0) {
            // Prefer exact name match, otherwise first result
            return data.find(m => m.medicine_name.toLowerCase().trim() === nameQuery.toLowerCase().trim()) || data[0];
          }
        } catch (e) { console.warn('Name search failed:', e); }
      }

      // Step 3: Search by MRP (fallback lookup)
      if (mrpQuery && mrpQuery.trim().length > 0) {
        try {
          const data = await api.searchMedicine(mrpQuery.trim());
          if (Array.isArray(data) && data.length > 0) {
            return data[0];
          }
        } catch (e) { console.warn('MRP search failed:', e); }
      }

      return null; // No database match
    };

    executeSearchChain().then(matched => {
      if (matched) {
        addToCart({
          id: matched.inventory_id,
          medicine_id: matched.medicine_id,
          name: matched.medicine_name,
          batch: matched.batch_no || info.batchNumber || 'B-GEN',
          expiry: matched.expiry_date || info.expiryDate || '12/28',
          mrp: matched.mrp || info.mrp || 0,
          costPrice: matched.cost_price || (matched.mrp * 0.7),
          salts: matched.salts || matched.hsn_code || 'Generic',
          packSize: matched.pack_size || 10,
          scanImage: result.capturedImage,
          rawOcrText: result.text,
          quantity: matched.quantity
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
    const unitRate = item.packSize > 0 ? item.mrp / item.packSize : item.mrp;
    const itemTotalBeforeDiscount = (item.mrp * item.qty) + (unitRate * (item.looseQty || 0));
    return sum + itemTotalBeforeDiscount * (1 - (item.discount || 0) / 100);
  }, 0);
  
  const discountAmount = subtotal * (discount / 100);
  const grandTotal = Math.round(subtotal - discountAmount);

  const totalCost = cart.reduce((sum, item) => {
    const itemCost = item.costPrice != null ? item.costPrice : (item.mrp * 0.7);
    const unitCostRate = item.packSize > 0 ? itemCost / item.packSize : itemCost;
    return sum + (itemCost * item.qty) + (unitCostRate * (item.looseQty || 0));
  }, 0);

  const profitOrLoss = grandTotal - totalCost;
  const isLoss = cart.length > 0 && profitOrLoss < -0.001; // Loss greater than 0.1 paise

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    if (isLoss) {
      alert(`❌ CANNOT SAVE BILL:\n\nTransaction results in a Net Loss (Grand Total ₹${grandTotal} is less than Cost Price ₹${Math.round(totalCost)}).\nPlease adjust overall discount or items MRP to proceed.`);
      return;
    }

    if (paymentMedium === 'CREDIT') {
      if (!patientName.trim()) {
        alert('Patient/Customer Name is required for Credit transactions to track outstanding balance!');
        return;
      }
      if (!patientPhone.trim()) {
        alert('Patient WhatsApp/Contact Number is required for Credit transactions to automatically generate the PDF and share it on WhatsApp! Redirecting to Patient Profile to fill it.');
        setShowPatientModal(true);
        return;
      }
    }

    // Expiry check
    for (const item of cart) {
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
    
    try {
      const salesItems = cart.map(item => {
        const itemDiscount = item.discount || item.discountPer || 0;
        return {
          inventory_id: typeof item.id === 'number' && item.id < 1000000 ? item.id : undefined,
          medicine_name: item.name,
          batch_no: item.batch,
          expiry_date: item.expiry,
          mrp: item.mrp,
          quantity: item.qty || 0,
          unit_price: item.unitPrice || item.mrp,
          loose_qty: item.looseQty || 0,
          discount_per: itemDiscount,
          pack_size: item.packSize || 10
        };
      });

      const payload = {
        items: salesItems,
        discount: discountAmount,
        patient_name: patientName || 'Walk-in Customer',
        patient_phone: patientPhone,
        doctor_name: doctor || undefined,
        sale_date: date,
        paymentMedium: paymentMedium,
        paymentStatus: paymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID',
        sendWhatsApp: paymentMedium === 'CREDIT' ? true : sendWhatsApp,
        refillEnabled: refillEnabled,
        refillDays: refillDays,
        refillId: activeRefillId || undefined
      };

      const result = await api.createSale(payload);
      const invoiceNo = result.invoice_no || result.invoiceNo || 'SAVED';
      
      setLastSavedInvoiceNo(invoiceNo);
      setLastSavedItems(cart.map(item => ({
        name: item.name || item.medicine_name,
        batch: item.batch_number || item.batch_no || 'N/A'
      })));
      setShowBarcodeModal(true);
      
      // Clear cart and states
      updateCart([]);
      setPatientName('');
      setPatientPhone('');
      setDoctor('');
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
            paymentMedium: 'CASH'
          };
        }
        return t;
      }));
    } catch (error) {
      console.error('Error completing sale:', error);
      alert('Failed to save sale to database. Please check connection.');
    }
  };

  const handleRegisterDoctor = async () => {
    try {
      if (!newDoctorName) return;
      const docName = newDoctorSpecialty ? `Dr. ${newDoctorName} (${newDoctorSpecialty})` : `Dr. ${newDoctorName}`;
      await api.addDoctor({
        name: docName,
        specialization: newDoctorSpecialty || 'General',
        phone: newDoctorPhone,
        clinic_name: newDoctorClinic,
        reg_no: newDoctorRegNo
      });
      // Refresh doctors list
      const docs = await api.getDoctors();
      if (Array.isArray(docs)) setDoctorsList(docs);
      setDoctor(docName);
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

  const defaultDoctors = [
    { id: 901, name: 'Dr. Priya Mehta (Cardiologist)' },
    { id: 902, name: 'Dr. Raj Sharma (GP)' },
    { id: 903, name: 'Dr. Anita Patel (Pediatrician)' }
  ];

  const allDoctors = [
    ...defaultDoctors,
    ...doctorsList.filter(d => !defaultDoctors.some(dd => dd.name === d.name))
  ];

  const filteredDoctors = allDoctors.filter(doc => 
    doc.name.toLowerCase().includes(doctor.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col fade-in overflow-hidden pb-2 bg-bg text-text">

      {/* Main Container: Split into Left Workspace and Right Sidebar */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* LEFT WORKSPACE (approx 72-75% width) - Takes up full height */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          
          {/* Patient & Doctor Context Bar */}
          <div className="glass-panel p-4 bg-glass-bg border-glass-border shrink-0 relative z-40 shadow-md rounded-2xl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              {/* Patient Name */}
              <div className="relative z-20">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Patient / Customer</label>
                <div className="flex gap-1 items-center">
                  <input 
                    type="text" 
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
                      } else if (e.key === 'Enter' && patientHighlightIndex >= 0) {
                        e.preventDefault();
                        const sel = patientSuggestions[patientHighlightIndex];
                        updatePatientName(sel.name);
                        setPatientPhone(sel.phone || '');
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
                    <div className="absolute left-0 right-0 top-full z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-44 overflow-y-auto shadow-2xl">
                      {patientSuggestions.map((c, idx) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => {
                            updatePatientName(c.name);
                            setPatientPhone(c.phone || '');
                            setShowPatientSuggestions(false);
                            setPatientHighlightIndex(-1);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs border-b border-border/10 transition-all flex items-center justify-between gap-2 ${
                            idx === patientHighlightIndex
                              ? 'bg-primary/20 text-text font-bold'
                              : 'text-text hover:bg-primary/10'
                          }`}
                        >
                          <span className="font-semibold truncate">{c.name}</span>
                          {c.phone && <span className="text-muted font-mono text-[10px] shrink-0">{c.phone}</span>}
                        </button>
                      ))}
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
                    className="premium-input text-xs h-9 pl-3 pr-7 bg-bg2/40 border-border/60 w-full text-text focus:border-sky rounded-xl"
                    placeholder="Type or Select Doctor..."
                    value={doctor}
                    onChange={e => { setDoctor(e.target.value); setDoctorHighlightIndex(-1); }}
                    onFocus={() => setIsDoctorDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsDoctorDropdownOpen(false), 200)}
                    onKeyDown={e => {
                      if (!isDoctorDropdownOpen || filteredDoctors.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setDoctorHighlightIndex(i => Math.min(i + 1, filteredDoctors.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setDoctorHighlightIndex(i => Math.max(i - 1, 0));
                      } else if (e.key === 'Enter' && doctorHighlightIndex >= 0) {
                        e.preventDefault();
                        setDoctor(filteredDoctors[doctorHighlightIndex].name);
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
                              setIsDoctorDropdownOpen(false);
                              setDoctorHighlightIndex(-1);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs border-b border-border/10 transition-all font-semibold ${
                              idx === doctorHighlightIndex
                                ? 'bg-sky/20 text-text font-bold'
                                : 'text-text hover:bg-sky/10'
                            }`}
                          >
                            {doc.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs text-muted italic">
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
          <div className="glass-panel p-4 flex flex-col gap-3 bg-glass-bg border-glass-border relative z-30 shrink-0 shadow-md">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-muted">
                  <Search size={18} />
                </span>
                <input 
                  type="text" 
                  placeholder="Search medicine by name, composition, batch, or price..." 
                  className="premium-input w-full text-sm pl-10 pr-4 py-2.5 bg-bg2/40 border-border/60 text-text rounded-2xl focus:ring-primary/20"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                
                {/* Empty inventory fallback dropdown */}
                {searchTerm.trim().length >= 3 && searchResults.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                    <div className="p-3 border-b border-border/30 text-[10px] font-bold text-muted uppercase tracking-wider bg-bg3/55">
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
                        }}
                        className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/20 text-left transition-all text-xs w-full group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-text group-hover:text-primary transition-all">Add "{searchTerm.trim()}" directly to cart (Quick Add)</span>
                          <span className="text-[10px] text-muted font-normal">Will use default batch MANUAL and expiry 12/28 (editable later)</span>
                        </div>
                        <span className="text-[10px] bg-primary/10 border border-primary/20 text-primary py-1 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-text transition-all">+ Add</span>
                      </button>

                      {searchingOnline && (
                        <div className="flex items-center justify-center p-4 text-xs text-muted gap-2 border-t border-border/20 bg-bg3/20">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-3 bg-bg3/55 border-t border-border/30 text-[10px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database)
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-xs w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[10px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || 'Generic'}</strong></span>
                                {sug.manufacturer && <span className="text-[9px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[10px] bg-sky/10 border border-sky/20 text-sky py-1 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-text transition-all">✨ Import & Add</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Search results dropdown */}
                {searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden max-h-80 overflow-y-auto shadow-2xl backdrop-blur-xl">
                    <div className="p-3 border-b border-border/30 bg-bg3/55 text-[10px] font-bold text-muted uppercase tracking-wider">
                      Matching Inventory Records:
                    </div>
                    <div className="flex flex-col">
                      {searchResults.map((med) => {
                        const renderMedicineItem = (item: any, isAlt = false) => {
                          return (
                            <button
                              key={item.inventory_id || `item_${item.medicine_id}_${Math.random()}`}
                              type="button"
                              onClick={() => {
                                addToCart({
                                  id: item.inventory_id,
                                  medicine_id: item.medicine_id,
                                  name: item.medicine_name,
                                  batch: item.batch_no,
                                  expiry: item.expiry_date,
                                  mrp: item.mrp,
                                  costPrice: item.cost_price,
                                  salts: item.salts || item.hsn_code || 'Generic',
                                  packSize: item.pack_size || 10,
                                  quantity: item.quantity
                                });
                                setSearchTerm('');
                                setSearchResults([]);
                              }}
                              className={`flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-xs w-full group ${isAlt ? 'pl-8 bg-sky/5' : ''}`}
                            >
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {isAlt && <span className="text-[9px] bg-sky/20 text-sky px-1.5 py-0.5 rounded font-bold mr-1">ALT</span>}
                                  <span className="font-semibold text-text group-hover:text-primary transition-all">{item.medicine_name}</span>
                                </div>
                                <span className="text-[9px] text-muted">Company: <span className="text-text font-semibold">{item.manufacturer || 'Generic'}</span></span>
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
                                  <span className="text-[10px] bg-primary/10 border border-primary/20 text-primary py-1 px-3 rounded-lg font-bold group-hover:bg-primary group-hover:text-text transition-all">+ Add</span>
                                </div>
                              </div>
                            </button>
                          );
                        };

                        if (med.is_out_of_stock) {
                          return (
                            <div key={`oos_${med.medicine_id}`} className="flex flex-col border-b border-border/10">
                              <div className="p-3 bg-red-500/5 text-xs w-full flex flex-col gap-1 border-l-2 border-red-500">
                                 <div className="flex items-center justify-between">
                                   <div>
                                     <span className="font-bold text-red-400 line-through mr-2">{med.medicine_name}</span>
                                     <span className="text-[9px] text-red-400 font-bold uppercase border border-red-500/20 px-1.5 py-0.5 rounded bg-red-500/10">Out of Stock</span>
                                   </div>
                                 </div>
                                 {med.alternatives && med.alternatives.length > 0 && (
                                   <div className="text-[10px] text-sky font-bold flex items-center gap-1.5 mt-1">
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
                                <div className="px-6 py-1 bg-sky/5 text-[9px] text-sky font-bold uppercase tracking-wider flex items-center gap-1">
                                  <span className="rotate-90">↱</span> Substitutes Available:
                                </div>
                                {med.alternatives.map((alt: any) => renderMedicineItem(alt, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {searchingOnline && (
                        <div className="flex items-center justify-center p-3 text-xs text-muted gap-2 border-t border-border/10 bg-bg3/25">
                          <Loader2 size={14} className="animate-spin text-sky" />
                          <span>Searching internet for active compositions...</span>
                        </div>
                      )}

                      {onlineResults.length > 0 && (
                        <>
                          <div className="p-2 border-t border-border/30 bg-bg3/55 text-[10px] font-bold text-sky uppercase tracking-wider">
                            🌐 Internet Suggestion (Auto-Enrich to Database):
                          </div>
                          {onlineResults.map((sug, sidx) => (
                            <button
                              key={`online_${sidx}`}
                              type="button"
                              onClick={() => handleSelectOnlineSuggestion(sug)}
                              className="flex items-center justify-between p-3.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-xs w-full group"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-text group-hover:text-sky transition-all">{sug.name}</span>
                                <span className="text-[10px] text-muted font-normal">Active Salts: <strong className="text-text">{sug.api_reference || 'Generic'}</strong></span>
                                {sug.manufacturer && <span className="text-[9px] text-muted font-normal">Mfr: {sug.manufacturer}</span>}
                              </div>
                              <span className="text-[10px] bg-sky/10 border border-sky/20 text-sky py-1 px-3 rounded-lg font-bold group-hover:bg-sky group-hover:text-text transition-all">✨ Import & Add</span>
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

            {/* Quick Add Combinations */}
            {commonCombinations.length > 0 && (
              <div className="border-t border-border/30 pt-2 flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5 select-none">
                  ⚡ Quick Add (Frequently Sold):
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
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
            )}
          </div>

          {/* B. Cart Panel - Takes up all remaining height */}
          <div className="flex-1 glass-panel flex flex-col overflow-hidden bg-glass-bg border-glass-border h-full relative z-10 min-h-0 shadow-md">
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
              
              <button 
                onClick={clearCart}
                className="premium-btn bg-red/10 border border-red/20 text-red text-xs py-1.5 px-3 hover:bg-red/20 transition-all flex items-center gap-1.5 ml-auto rounded-xl"
              >
                <Trash2 size={12} /> Clear Cart
              </button>
            </div>

            {/* Cart Table Container */}
            <div className="flex-1 overflow-auto bg-bg/25 scrollbar-thin">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-bg2/95 backdrop-blur-xl z-10">
                  <tr>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80">Medicine</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80">Batch</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-center">Expiry</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-center text-primary font-extrabold">Stock</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-center">Qty (Str)</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-center">Loose Qty</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-center">Disc %</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-right">MRP</th>
                    <th className="p-3 text-xs font-bold text-muted uppercase tracking-wider border-b border-border/80 text-right">Total</th>
                    <th className="p-3 text-xs font-bold text-muted tracking-wider border-b border-border/80"></th>
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
                      <tr key={item.id} data-medicine-id={item.medicine_id} className="border-b border-border/30 hover:bg-bg2/40 transition-all">
                        {/* Medicine Search/Change */}
                        <td className="p-2 min-w-[160px] relative">
                          <div className="flex items-center">
                            {item.scanImage && (
                              <div className="relative group/thumb shrink-0 mr-2.5 select-none animate-in fade-in duration-200">
                                <img 
                                  src={item.scanImage} 
                                  alt="Scan thumbnail" 
                                  className="w-9 h-9 object-cover rounded-xl border border-border/60 hover:border-primary/60 transition-all cursor-zoom-in shadow-sm"
                                  onClick={() => setZoomedImage(item.scanImage)}
                                />
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover/thumb:block z-[100] bg-bg2 border border-border rounded-xl p-2 shadow-2xl w-48 animate-in fade-in duration-150">
                                  <img src={item.scanImage} alt="Scan preview" className="w-full h-auto rounded-lg object-contain" />
                                  <div className="text-[8px] text-muted text-center mt-1 font-semibold">Click to enlarge</div>
                                </div>
                              </div>
                            )}
                            <div className="flex-1 relative">
                              <input 
                                type="text" 
                                className="w-full bg-transparent border-0 border-b border-transparent hover:border-border/60 focus:border-primary/60 focus:ring-0 text-xs font-semibold text-text py-1 px-1 rounded"
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
                                placeholder="Change medicine..."
                              />
                              
                              {activeRowSearchIndex === cart.indexOf(item) && rowSearchResults.length > 0 && (
                                <div className="absolute left-0 right-0 z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto w-64 shadow-2xl">
                                  {rowSearchResults.map((med) => {
                                    const rowPendingMatches = specialOrders.filter(
                                      o => o.product.toLowerCase().trim() === med.medicine_name.toLowerCase().trim() ||
                                           med.medicine_name.toLowerCase().includes(o.product.toLowerCase().trim())
                                    );
                                    const rowHasPending = rowPendingMatches.length > 0;
                                    return (
                                      <button
                                        key={med.inventory_id}
                                        type="button"
                                        onClick={() => {
                                          const idx = cart.indexOf(item);
                                          changeRowMedicine(idx, med);
                                        }}
                                        className="flex flex-col p-2.5 hover:bg-bg3 border-b border-border/10 text-left transition-all text-xs w-full"
                                      >
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-semibold text-text">{med.medicine_name}</span>
                                          {rowHasPending && (
                                            <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 px-1 py-0.5 rounded text-[8px] font-bold animate-pulse">
                                              ⚠️ {rowPendingMatches[0].requester} ({rowPendingMatches[0].qty})
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[9px] text-muted font-mono mt-0.5">Batch: {med.batch_no} | Exp: {med.expiry_date}</span>
                                        <span className="text-[9px] text-green font-bold font-mono mt-0.5">MRP: ₹{Math.round(med.mrp)} | Stock: {med.quantity}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Batch Selection */}
                        <td className="p-2 relative">
                          <div className="relative">
                            <input
                              type="text"
                              className="w-28 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs font-mono font-semibold py-1 px-1.5 rounded-lg"
                              value={item.batch || ''}
                              placeholder="Batch"
                              onChange={e => updateCartItem(item.id, 'batch', e.target.value)}
                              onFocus={() => {
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
                              <div className="absolute left-1 z-[100] mt-1 bg-bg2 border border-border rounded-xl overflow-hidden max-h-36 overflow-y-auto w-52 text-left shadow-2xl">
                                <div className="p-1.5 border-b border-border/30 bg-bg3/60 text-[9px] font-bold text-muted uppercase tracking-wider">
                                  Switch Batch:
                                </div>
                                {rowBatchesList.map(b => (
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
                                          availableStock: b.quantity !== undefined ? b.quantity : 0
                                        };
                                      }));
                                      setActiveBatchRowId(null);
                                    }}
                                    className={`w-full text-left px-2.5 py-1.5 hover:bg-sky/15 border-b border-border/10 text-[10px] font-mono transition-all block ${b.batch_no === item.batch ? 'bg-sky/10 text-sky' : 'text-text'}`}
                                  >
                                    <span className="font-bold block">{b.batch_no}</span>
                                    <span className="text-muted block text-[8px]">Exp: {b.expiry_date} | Stock: {b.quantity} | MRP: ₹{b.mrp}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        
                        {/* Expiry */}
                        <td className="p-2 text-center">
                          <div className={`font-mono text-[10px] font-bold px-2 py-0.8 rounded-lg inline-block shadow-sm ${expBadgeClass}`}>{item.expiry}</div>
                        </td>

                        {/* Stock */}
                        <td className="p-2 text-center">
                          <div className={`font-mono text-xs font-bold bg-bg3/50 px-2 py-1 rounded-lg border border-border/30 inline-block shadow-sm ${
                            item.availableStock === 'N/A' || item.availableStock === undefined || item.availableStock === null
                              ? 'text-muted'
                              : Number(item.availableStock) <= 0
                              ? 'text-red font-extrabold bg-red/5 border-red/20'
                              : Number(item.availableStock) <= 10
                              ? 'text-amber-500 font-bold bg-amber-500/5 border-amber-500/20'
                              : 'text-green font-bold bg-green/5 border-green/20'
                          }`}>
                            {item.availableStock !== undefined ? item.availableStock : 'N/A'}
                          </div>
                        </td>

                        {/* Qty */}
                        <td className="p-2 text-center">
                          <input 
                            type="number" 
                            className="w-16 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs font-mono font-bold py-1 px-1 rounded-lg"
                            value={item.qty === 0 || item.qty === undefined || item.qty === null ? '' : item.qty}
                            onChange={e => updateCartItem(item.id, 'qty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                            min="0"
                          />
                        </td>

                        {/* Loose Qty */}
                        <td className="p-2 text-center">
                          <input 
                            type="number" 
                            className="w-16 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs font-mono font-bold text-amber-500 py-1 px-1 rounded-lg"
                            value={item.looseQty === 0 || item.looseQty === undefined || item.looseQty === null ? '' : item.looseQty}
                            onChange={e => updateCartItem(item.id, 'looseQty', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
                            min="0"
                          />
                        </td>

                        {/* Discount */}
                        <td className="p-2 text-center">
                          <input 
                            type="number" 
                            className="w-16 text-center bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs font-mono font-bold text-sky py-1 px-1 rounded-lg"
                            value={item.discount === 0 || item.discount === undefined || item.discount === null ? '' : item.discount}
                            onChange={e => updateCartItem(item.id, 'discount', e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
                            min="0"
                            max="100"
                          />
                        </td>

                        {/* MRP */}
                        <td className="p-2 text-right">
                          <input 
                            type="number" 
                            className="w-16 text-right font-mono bg-bg/40 border border-border/40 hover:border-border/80 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 text-xs py-1 px-1.5 rounded-lg" 
                            value={item.mrp || ''}
                            placeholder="0.00"
                            onChange={e => updateCartItem(item.id, 'mrp', Math.max(0, Number(e.target.value)))}
                          />
                        </td>

                        {/* Total */}
                        <td className="p-2 text-right">
                          <div className="font-mono text-xs font-bold text-green pr-1">
                            ₹{Math.round(itemTotal)}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-2 text-center">
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
                              <Edit size={13} />
                            </button>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="p-1.5 hover:bg-red/10 text-muted hover:text-red rounded-lg transition-all"
                            >
                              <Trash2 size={13} />
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

              {/* Grand Total & Save Button */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-extrabold text-primary uppercase tracking-wider">Total:</span>
                  <span className="font-mono text-xl font-black text-primary">₹{grandTotal}</span>
                </div>

                <button 
                  onClick={handleCompleteSale}
                  disabled={cart.length === 0}
                  className={`text-text py-2 px-5 text-xs flex items-center gap-2 font-bold uppercase tracking-wider rounded-xl transition-all h-9 ${
                    cart.length === 0 
                      ? 'bg-bg3 border border-border text-muted cursor-not-allowed' 
                      : 'bg-green hover:bg-emerald-600 shadow-[0_4px_14px_rgba(16,185,129,0.25)] hover:-translate-y-0.5'
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

      {/* Barcode Print Prompt Modal */}
      {showBarcodeModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md fade-in">
          <div className="bg-bg border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full bg-green/10 border border-green/20 text-green mb-2">
                <CheckCircle size={32} className="animate-bounce" />
              </div>
              <h3 className="text-lg font-bold text-text">Sale Saved Successfully!</h3>
              <p className="text-xs text-muted">Invoice No: <span className="font-mono text-sky font-semibold">{lastSavedInvoiceNo}</span></p>
            </div>

            <div className="bg-bg2/60 border border-border/40 p-4 rounded-xl space-y-3">
              <p className="text-xs text-center text-text font-medium leading-relaxed">
                Would you like to print unique barcode/QR code labels for the medicines in this bill, or generate a single barcode for the bill itself?
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={async () => {
                  try {
                    const res = await api.generateMedicineBarcodes(lastSavedItems);
                    if (res && res.success && res.pdfUrl) {
                      const backendUrl = apiClient.defaults.baseURL || window.location.origin;
                      window.open(`${backendUrl}${res.pdfUrl}`, '_blank');
                    } else {
                      alert('Failed to generate barcodes');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Error generating medicine barcodes');
                  }
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-green text-text hover:bg-green/90 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2"
              >
                Create Medicine Barcodes
              </button>

              <button
                onClick={async () => {
                  try {
                    const res = await api.generateBillBarcode(lastSavedInvoiceNo);
                    if (res && res.success && res.pdfUrl) {
                      const backendUrl = apiClient.defaults.baseURL || window.location.origin;
                      window.open(`${backendUrl}${res.pdfUrl}`, '_blank');
                    } else {
                      alert('Failed to generate bill barcode');
                    }
                  } catch (err) {
                    console.error(err);
                    alert('Error generating bill barcode');
                  }
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-sky text-text hover:bg-sky/90 transition-all shadow-[0_4px_12px_rgba(14,165,233,0.2)] flex items-center justify-center gap-2"
              >
                Create Bill Barcode
              </button>

              <button
                onClick={() => {
                  setShowBarcodeModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-bg2 border border-border text-muted hover:text-text hover:bg-bg3 transition-all"
              >
                No / Skip
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {editMedicineId && (
        <UniversalMedicineEditModal 
          medicineId={editMedicineId} 
          onClose={() => setEditMedicineId(null)} 
          onSave={() => {
            // Optional: Re-fetch or update local search results state if needed
          }} 
        />
      )}

    </div>
  );
};

export default POS;
