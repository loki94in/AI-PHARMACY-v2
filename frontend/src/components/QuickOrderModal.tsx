import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Search, 
  Plus, 
  Minus, 
  ClipboardPlus, 
  Sparkles, 
  Loader2, 
  ShoppingCart, 
  AlertTriangle,
  User,
  Phone,
  IndianRupee,
  Globe,
  Flame,
  Layers,
  Store,
  Tag,
  CheckCircle2,
  Trash2,
  Zap,
  Package,
  Clock,
  MessageCircle
} from 'lucide-react';
import { api } from '../services/api';
import { toastEvent, specialOrdersEvent } from '../services/events';
import {} from '../hooks/useApiQuery';

interface SuggestionMedicine {
  inventory_id?: number;
  medicine_id?: number;
  medicine_name: string;
  batch_no?: string;
  quantity?: number;
  mrp?: number | null;
  isPharmarack?: boolean;
  distributor?: string;
  rate?: number | null;
  mapped?: boolean;
  packaging?: string;
  stock?: string;
  isErrorMessage?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  manufacturer?: string;
}

interface SchemeInfo {
  buy: number;
  free: number;
}

type LocalApiError = { response?: { data?: { error?: string; details?: string } }; message?: string };

interface LocalStagedOrderItem {
  product: string;
  qty: number;
  distributor?: string;
  rate?: number;
  mrp?: number;
  mapped?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  packaging?: string;
}

interface LocalPharmarackSearchItem {
  name: string;
  shortName?: string;
  fullName?: string;
  packaging?: string;
  distributor?: string;
  rate?: number | null;
  mrp?: number | null;
  mapped?: boolean;
  stock?: string;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
}

const parseScheme = (schemeStr: string | undefined): SchemeInfo | null => {
  if (!schemeStr) return null;
  const match = schemeStr.match(/^(\d+)\+(\d+)$/);
  if (match) {
    return {
      buy: parseInt(match[1]),
      free: parseInt(match[2])
    };
  }
  return null;
};

const getEffectiveRate = (rate: number, schemeStr: string | undefined, qty: number): number => {
  if (!rate) return 0;
  const scheme = parseScheme(schemeStr);
  if (!scheme || qty < scheme.buy) {
    return rate;
  }
  const freeItems = Math.floor(qty / scheme.buy) * scheme.free;
  const totalItems = qty + freeItems;
  return (qty * rate) / totalItems;
};

export const QuickOrderModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isOpen, setIsOpen] = useState(true);
  
  const handleClose = () => {
    setIsOpen(false);
    onClose();
  };
  
  // Staged Cart List
  const [cart, setCart] = useState<LocalStagedOrderItem[]>([]);

  // Form State
  const [product, setProduct] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState(1);
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState<'Low' | 'Normal' | 'High'>('Normal');
  const [language, setLanguage] = useState('en');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  
  const [selectedDistributor, setSelectedDistributor] = useState('');
  const [selectedRate, setSelectedRate] = useState<number | ''>('');
  const [selectedMrp, setSelectedMrp] = useState<number | ''>('');
  const [selectedMapped, setSelectedMapped] = useState<boolean | null>(null);
  const [selectedScheme, setSelectedScheme] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | number>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | number>('');
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedPackaging, setSelectedPackaging] = useState('');
  
  // Search state
  const [suggestions, setSuggestions] = useState<SuggestionMedicine[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  
  const [isSubmitting] = useState(false);
  const [prMode, setPrMode] = useState<'Live' | 'Unknown'>('Live');

  // Duplicate check states
  const [duplicateMatch, setDuplicateMatch] = useState<LocalStagedOrderItem | null>(null);
  const [duplicateMatchIndex, setDuplicateMatchIndex] = useState<number>(-1);
  const [pendingItemToAdd, setPendingItemToAdd] = useState<LocalStagedOrderItem | null>(null);

  const resetInputsAndFocus = () => {
    setProduct('');
    setQty(1);
    setSelectedDistributor('');
    setSelectedRate('');
    setSelectedMrp('');
    setSelectedMapped(null);
    setSelectedScheme('');
    setSelectedProductId('');
    setSelectedStoreId('');
    setSelectedProductCode('');
    setSelectedCompany('');
    setSelectedPackaging('');
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);
    setTimeout(() => productInputRef.current?.focus(), 50);
  };

  const insertItemToCart = (item: LocalStagedOrderItem) => {
    setCart(prev => [...prev, item]);
    resetInputsAndFocus();
  };

  const handleAddItemToCart = () => {
    if (!product.trim()) {
      toastEvent.trigger('Please enter or select a medicine name first.', 'error');
      return;
    }

    const newItem = {
      product: product.trim(),
      qty: qty,
      distributor: selectedDistributor || undefined,
      rate: selectedRate !== '' ? Number(selectedRate) : undefined,
      mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
      mapped: selectedMapped !== null ? selectedMapped : undefined,
      scheme: selectedScheme || undefined,
      productId: selectedProductId || undefined,
      storeId: selectedStoreId || undefined,
      productCode: selectedProductCode || undefined,
      company: selectedCompany || undefined,
      packaging: selectedPackaging || undefined
    };

    // Check for similar item in currently staged items (case-insensitive & whitespace independent)
    const existingIndex = cart.findIndex(item => {
      const itemClean = item.product.toLowerCase().replace(/[^a-z0-9]/g, '');
      const inputClean = newItem.product.toLowerCase().replace(/[^a-z0-9]/g, '');
      return itemClean.includes(inputClean) || inputClean.includes(itemClean);
    });

    if (existingIndex > -1) {
      setDuplicateMatch(cart[existingIndex]);
      setDuplicateMatchIndex(existingIndex);
      setPendingItemToAdd(newItem);
      return;
    }

    insertItemToCart(newItem);
  };

  const handleRemoveCartItem = (idxToRemove: number) => {
    setCart(prev => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const handleResolveCombine = () => {
    if (duplicateMatchIndex > -1 && pendingItemToAdd) {
      setCart(prev => prev.map((item, idx) => {
        if (idx === duplicateMatchIndex) {
          return {
            ...item,
            qty: item.qty + pendingItemToAdd.qty
          };
        }
        return item;
      }));
      toastEvent.trigger(`Combined quantities for "${pendingItemToAdd.product}"`, 'success');
      resetInputsAndFocus();
      setDuplicateMatch(null);
      setDuplicateMatchIndex(-1);
      setPendingItemToAdd(null);
    }
  };

  const handleResolveSeparate = () => {
    if (pendingItemToAdd) {
      setCart(prev => [...prev, pendingItemToAdd]);
      toastEvent.trigger(`Added "${pendingItemToAdd.product}" as separate request`, 'success');
      resetInputsAndFocus();
      setDuplicateMatch(null);
      setDuplicateMatchIndex(-1);
      setPendingItemToAdd(null);
    }
  };

  const handleResolveReplace = () => {
    if (duplicateMatchIndex > -1 && pendingItemToAdd) {
      setCart(prev => prev.map((item, idx) => {
        if (idx === duplicateMatchIndex) {
          return pendingItemToAdd;
        }
        return item;
      }));
      toastEvent.trigger(`Replaced staged item with "${pendingItemToAdd.product}"`, 'success');
      resetInputsAndFocus();
      setDuplicateMatch(null);
      setDuplicateMatchIndex(-1);
      setPendingItemToAdd(null);
    }
  };

  const handleResolveCancel = () => {
    toastEvent.trigger('Cancelled.', 'info');
    setDuplicateMatch(null);
    setDuplicateMatchIndex(-1);
    setPendingItemToAdd(null);
    setTimeout(() => productInputRef.current?.focus(), 50);
  };

  const autocompleteRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const lastToastedQueryRef = useRef('');
  const isSelectingRef = useRef(false);

  // Find the minimum effective rate among all suggestions to identify the best rate option
  const minEffectiveRate = React.useMemo(() => {
    let min = Infinity;
    suggestions.forEach(item => {
      if (item.isErrorMessage || !item.rate) return;
      const eff = getEffectiveRate(item.rate, item.scheme, qty);
      if (eff < min) min = eff;
    });
    return min;
  }, [suggestions, qty]);

  // Autofocus and check session mode on mount
  useEffect(() => {
    api.checkPharmarackSession().then(data => {
      setPrMode(data.mode || 'Live');
    }).catch(() => setPrMode('Live'));

    setTimeout(() => {
      productInputRef.current?.focus();
    }, 100);
  }, []);

  // Listen to Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle outside clicks for autocomplete
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Pharmarack-Only Search
  useEffect(() => {
    if (isSelectingRef.current) return;
    const query = product.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    let active = true;

    const delayDebounce = setTimeout(async () => {
      if (isSelectingRef.current) return;
      setSearchLoading(true);
      try {
        const prData = await api.searchPharmarack(query).catch((err: LocalApiError) => {
          const errMsg = err?.response?.data?.error || 'Connection error, please check internet or reconnect';
          return { isError: true, message: errMsg };
        });

        if (!active || isSelectingRef.current) return;

        const prSuggestions: SuggestionMedicine[] = [];
        if (prData && prData.isError) {
          prSuggestions.push({
            medicine_name: `⚠️ ${prData.message}`,
            isPharmarack: true,
            isErrorMessage: true
          });
        } else if (Array.isArray(prData)) {
          const hasMapped = prData.some((item: LocalPharmarackSearchItem) => item.mapped);
          if (prData.length === 0 || !hasMapped) {
            if (query.length >= 3 && query !== lastToastedQueryRef.current) {
              toastEvent.trigger('No mapped distributor has product', 'info');
              lastToastedQueryRef.current = query;
            }
          }

          prData.forEach((item: LocalPharmarackSearchItem) => {
            prSuggestions.push({
              medicine_name: item.name,
              mrp: item.mrp,
              isPharmarack: true,
              distributor: item.distributor,
              rate: item.rate,
              mapped: item.mapped,
              scheme: item.scheme,
              productId: item.productId,
              storeId: item.storeId,
              productCode: item.productCode,
              company: item.company,
              packaging: item.packaging,
              stock: item.stock,
            });
          });
        }

        if (isSelectingRef.current) return;
        setSuggestions(prSuggestions);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Error searching Pharmarack:', err);
      } finally {
        if (active) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [product]);

  // Autocomplete key navigation
  const handleProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }

    if (e.key === 'Enter' || (e.key === 'Tab' && showSuggestions && activeSuggestionIndex >= 0)) {
      e.preventDefault();
      if (showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        selectSuggestion(suggestions[activeSuggestionIndex]);
      } else {
        handleAddItemToCart();
      }
    }
  };

  const handleProductChange = (val: string) => {
    isSelectingRef.current = false;
    setProduct(val);
    if (selectedProductId || selectedDistributor) {
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(null);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
    }
  };

  const selectSuggestion = (med: SuggestionMedicine) => {
    if (med.isErrorMessage) return;
    isSelectingRef.current = true;
    if (med.isPharmarack) {
      setProduct(med.medicine_name);
      setSelectedDistributor(med.distributor || '');
      setSelectedRate(med.rate !== undefined && med.rate !== null ? med.rate : '');
      setSelectedMrp(med.mrp !== undefined && med.mrp !== null ? med.mrp : '');
      setSelectedMapped(med.mapped !== undefined ? med.mapped : null);
      setSelectedScheme(med.scheme || '');
      setSelectedProductId(med.productId || '');
      setSelectedStoreId(med.storeId || '');
      setSelectedProductCode(med.productCode || '');
      setSelectedCompany(med.company || '');
      setSelectedPackaging(med.packaging || '');
    } else {
      setProduct(med.medicine_name);
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(null);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
    }
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);

    // Focus quantity input automatically for editing
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  };

  // Submit Order Form
  const processSubmissionQueue = async (
    items: LocalStagedOrderItem[],
    customerName: string,
    customerPhone: string,
    orderPriority: 'Low' | 'Normal' | 'High',
    advanceAmt: number,
    messageLang: string,
    shouldSendWhatsApp: boolean
  ) => {
    try {
      // 1. Log all requested medicines in a single batch call (sends 1 consolidated WhatsApp message to customer if enabled)
      await api.createBatchOrders({
        items,
        requester: customerName,
        phone: customerPhone,
        priority: orderPriority,
        advance_payment: advanceAmt,
        language: messageLang,
        sendWhatsApp: Boolean(shouldSendWhatsApp && customerPhone && customerPhone.length >= 10)
      });

      toastEvent.trigger(`Successfully logged request for ${items.length} medicine(s)!`, 'success');
      // Notify the PharmarackCart sidebar (and any other specialOrdersEvent subscriber) immediately
      specialOrdersEvent.triggerUpdated();
      window.dispatchEvent(new CustomEvent('refresh-special-orders'));

      // 2. Add all items to the actual Pharmarack cart in a single batch call
      try {
        const pharmarackItems = items.map(item => ({
          productId: item.productId || 0,
          storeId: item.storeId || 0,
          qty: item.qty,
          rate: item.rate,
          scheme: item.scheme,
          productCode: item.productCode,
          company: item.company,
          productName: item.product,
          storeName: item.distributor,
          packaging: item.packaging,
          mapped: item.mapped
        }));
        const res = await api.addPharmarackCart(pharmarackItems);
        if (res && res.success) {
          toastEvent.trigger(`Added ${items.length} medicine(s) to actual Pharmarack cart!`, 'success');
          window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        } else {
          toastEvent.trigger(`Requests logged, cart notice: ${res?.error || 'Manual cart add required'}`, 'info');
        }
      } catch (cartErr) {
        const e = cartErr as LocalApiError;
        console.warn('Failed to add batch items to actual Pharmarack cart:', cartErr);
        const detailedError = e.response?.data?.details || e.response?.data?.error || e.message || 'Sync issue';
        toastEvent.trigger(`Requests logged, Pharmarack cart notice: ${detailedError}`, 'info');
      }
    } catch (err) {
      const e = err as LocalApiError;
      console.error('Failed to log batch request:', err);
      toastEvent.trigger(`Failed to log order request: ${e.response?.data?.error || e.message || 'Error'}`, 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto stage current input if cart is empty but something is typed
    const finalItems = [...cart];
    if (finalItems.length === 0) {
      if (!product.trim()) {
        toastEvent.trigger('Please stage at least one product name first.', 'error');
        return;
      }
      if (qty < 1) {
        toastEvent.trigger('Quantity must be at least 1.', 'error');
        return;
      }
      finalItems.push({
        product: product.trim(),
        qty: qty,
        distributor: selectedDistributor || undefined,
        rate: selectedRate !== '' ? Number(selectedRate) : undefined,
        mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
        mapped: selectedMapped !== null ? selectedMapped : undefined,
        scheme: selectedScheme || undefined,
        productId: selectedProductId || undefined,
        storeId: selectedStoreId || undefined,
        productCode: selectedProductCode || undefined,
        company: selectedCompany || undefined
      });
    }

    // Capture customer & priority details (Customer details optional / store default)
    const customerName = requester.trim() || 'Store Inventory';
    const customerPhone = phone.replace(/\D/g, '') || '';
    const orderPriority = priority;
    const advanceAmt = advancePayment !== '' ? Number(advancePayment) : 0;

    // Reset state and close modal immediately
    setCart([]);
    setProduct('');
    setRequester('');
    setPhone('');
    setQty(1);
    setAdvancePayment('');
    setPriority('Normal');
    setSendWhatsApp(true);
    setSelectedDistributor('');
    setSelectedRate('');
    setSelectedMrp('');
    setSelectedMapped(null);
    setSelectedScheme('');
    setSelectedProductId('');
    setSelectedStoreId('');
    handleClose();

    // Trigger background queue processing (non-blocking)
    toastEvent.trigger(`Starting background logging for ${finalItems.length} request(s)...`, 'info');
    processSubmissionQueue(finalItems, customerName, customerPhone, orderPriority, advanceAmt, language, sendWhatsApp);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60 backdrop-blur-md transition-all duration-300">
      <div className="glass-panel max-w-md md:max-w-3xl w-full p-6 relative border border-glass-border shadow-[0_0_50px_rgba(59,130,246,0.2)] bg-bg2 text-text animate-in fade-in zoom-in-95 duration-200 rounded-3xl">
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-muted hover:text-text rounded-xl hover:bg-bg3 border border-transparent hover:border-glass-border transition-all duration-200"
          title="Close Modal (Esc)"
        >
          <X size={18} />
        </button>

        {/* Header Title Bar */}
        <div className="flex items-center gap-3 mb-5 select-none">
          <div className="p-2.5 bg-primary/10 rounded-2xl text-primary border border-primary/20 shadow-sm flex items-center justify-center">
            <ClipboardPlus size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-text flex items-center gap-2">
              Quick Special Request
              <span className="text-[10px] bg-bg3 border border-glass-border text-muted px-2 py-0.5 rounded-md font-mono font-semibold">Alt + O</span>
              {prMode !== 'Unknown' && (
                <span className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-full border leading-none bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block"></span> LIVE
                </span>
              )}
            </h3>
            <p className="text-xs text-muted">Instantly log out-of-stock demands & shortage requests</p>
          </div>
        </div>

        {/* Form Grid */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            
            {/* Left Column: Input Form & Staging Controls (3/5 cols) */}
            <div className="md:col-span-3 flex flex-col gap-3">
              
              {/* Search & Add Item Section */}
              <div className="space-y-3 p-4 bg-bg2/50 border border-glass-border rounded-3xl shadow-sm hover:shadow-md transition-all duration-300">
                
                {/* Product / Medicine Autocomplete (No label header) */}
                <div className="relative animate-in fade-in duration-200" ref={autocompleteRef}>
                  <div className="relative">
                    <span className="absolute left-3.5 top-[13px] text-muted">
                      {searchLoading ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} />}
                    </span>
                    <input
                      ref={productInputRef}
                      type="text"
                      value={product}
                      onChange={(e) => handleProductChange(e.target.value)}
                      onKeyDown={handleProductKeyDown}
                      className="w-full premium-input pl-11 pr-5 py-3 text-sm font-semibold rounded-2xl"
                      placeholder="Search or enter medicine name..."
                      autoComplete="off"
                    />
                  </div>
                  
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute z-[9999] left-0 right-0 mt-1.5 max-h-[380px] overflow-y-auto bg-bg2 border-2 border-primary/40 backdrop-blur-2xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] divide-y divide-border/30 py-1 scrollbar-thin">
                      {suggestions.map((med, index) => (
                        <li
                          key={index}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectSuggestion(med);
                          }}
                          className={`px-3.5 py-2.5 text-xs cursor-pointer flex justify-between items-center transition-all ${
                            med.isErrorMessage
                              ? 'bg-red-500/10 text-red border-l-2 border-red cursor-default'
                              : index === activeSuggestionIndex
                              ? 'bg-primary/20 text-text font-semibold border-l-2 border-primary'
                              : 'text-muted hover:text-text hover:bg-bg3/60'
                          }`}
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            {/* Line 1: Product name + scheme badge + Best Rate badge */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-text truncate text-sm">{med.medicine_name}</span>
                              {med.scheme && !med.isErrorMessage && (
                                <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase shrink-0 flex items-center gap-1">
                                  <Tag size={10} /> {med.scheme}
                                </span>
                              )}
                              {med.rate !== undefined && med.rate !== null && !med.isErrorMessage && getEffectiveRate(med.rate, med.scheme, qty) === minEffectiveRate && (
                                <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase flex items-center gap-0.5 shrink-0 select-none">
                                  <Sparkles size={9} className="text-emerald-400 animate-pulse" /> Best Rate
                                </span>
                              )}
                            </div>

                            {/* Line 2: Distributor name + company */}
                            {!med.isErrorMessage && (
                              <div className="flex items-center gap-2 flex-wrap mt-1 text-xs">
                                <span className={`font-semibold flex items-center gap-1 ${ med.isPharmarack ? (med.mapped ? 'text-sky-400' : 'text-purple-400') : 'text-muted' }`}>
                                  <Store size={11} /> {med.isPharmarack ? (med.distributor || 'No Distributor') : 'Local Inventory'}
                                </span>
                                {(med.company || med.manufacturer) && (
                                  <span className="text-[10px] text-muted/70 font-semibold uppercase tracking-wider">
                                    • {med.company || med.manufacturer}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Line 3: PTR, MRP, packaging & stock pill */}
                            {!med.isErrorMessage && (
                              <div className="flex items-center gap-2.5 text-[11px] mt-1 flex-wrap">
                                {med.isPharmarack ? (
                                  <>
                                    {med.rate !== undefined && med.rate !== null && (
                                      <span className="font-bold text-emerald-400 font-mono">PTR: ₹{med.rate}</span>
                                    )}
                                    {med.mrp !== undefined && med.mrp !== null && (
                                      <span className="text-muted font-mono">MRP: ₹{med.mrp}</span>
                                    )}
                                    {med.packaging && (
                                      <span className="text-muted font-mono font-semibold">{med.packaging}</span>
                                    )}
                                    {med.stock !== undefined && (
                                      <span className={`font-bold font-mono px-1.5 py-0.5 rounded-md text-[10px] flex items-center gap-1 ${
                                        (med.stock.toLowerCase() === 'high' || parseInt(med.stock) >= 15)
                                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                          : (med.stock.toLowerCase() === 'low' || parseInt(med.stock) > 0)
                                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                          : 'bg-red-500/10 text-red border border-red-500/20'
                                      }`}>
                                        <Package size={10} /> {med.stock}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  med.mrp !== undefined && (
                                    <span className="font-bold text-emerald-400 font-mono">MRP: ₹{Math.round(med.mrp as number)}</span>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Selected Pharmarack item details preview */}
                  {selectedDistributor && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-text flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="truncate pr-2">
                        <div className="font-bold text-emerald-400 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Zap size={12} className="text-emerald-400" /> Pharmarack Match
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-text font-semibold truncate flex items-center gap-1">
                            <Store size={12} className="text-emerald-400 shrink-0" /> {selectedDistributor}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            selectedMapped 
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}>
                            {selectedMapped ? 'Mapped' : 'Non-mapped'}
                          </span>
                          {selectedScheme && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase flex items-center gap-0.5">
                              <Tag size={9} /> {selectedScheme}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="font-mono font-extrabold whitespace-nowrap flex flex-col items-end gap-0.5 text-right shrink-0">
                          {selectedRate !== '' && <span className="text-emerald-400 text-sm">PTR: ₹{selectedRate}</span>}
                          {selectedMrp !== '' && <span className="text-muted text-[10px]">MRP: ₹{selectedMrp}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDistributor('');
                            setSelectedRate('');
                            setSelectedMrp('');
                            setSelectedMapped(null);
                            setSelectedScheme('');
                            setSelectedProductId('');
                            setSelectedStoreId('');
                            setSelectedProductCode('');
                            setSelectedCompany('');
                            setSelectedPackaging('');
                            setProduct('');
                            setTimeout(() => productInputRef.current?.focus(), 50);
                          }}
                          className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all ml-1.5"
                          title="Cancel distributor selection"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                </div>

                {/* Priority Selector Row (No label header) */}
                <div className="flex items-center gap-2">
                  <div className="flex bg-bg3 border border-glass-border rounded-2xl p-1 h-9 flex-1 select-none">
                    {(['Low', 'Normal', 'High'] as const).map((p) => {
                      const active = priority === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          className={`flex-1 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                            active 
                              ? p === 'High' 
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30 shadow-sm' 
                                : p === 'Low'
                                ? 'bg-bg2 text-text border border-border/50 shadow-sm'
                                : 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                              : 'text-muted hover:text-text hover:bg-bg2/50'
                          }`}
                        >
                          {p === 'Low' && <Clock size={11} />}
                          {p === 'Normal' && <CheckCircle2 size={11} />}
                          {p === 'High' && <Flame size={11} className="text-red-400 animate-pulse" />}
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quantity & Presets & Stage Medicine Bar (No label header) */}
                <div className="pt-2 border-t border-glass-border/40 space-y-2">
                  <div className="flex items-center justify-between select-none">
                    <span className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                      Presets
                    </span>
                    <div className="flex gap-1">
                      {[1, 5, 10, 50].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setQty(preset)}
                          className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-lg transition-all ${
                            qty === preset
                              ? 'bg-primary/20 text-primary border border-primary/30'
                              : 'bg-bg3 text-muted hover:text-text hover:bg-bg2 border border-transparent'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 items-center">
                    {/* Stepper Input Capsule */}
                    <div className="flex items-center justify-between bg-bg3 border border-glass-border rounded-2xl h-11 px-1.5 shadow-inner w-36 shrink-0">
                      <button
                        type="button"
                        onClick={() => setQty(prev => Math.max(1, prev - 1))}
                        className="w-8 h-8 rounded-xl hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                        title="Decrease Quantity"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        ref={qtyInputRef}
                        type="number"
                        value={qty}
                        onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddItemToCart();
                          }
                        }}
                        className="w-full bg-transparent text-center text-sm font-bold outline-none text-text focus:ring-0 border-0 p-0 font-mono"
                        min="1"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setQty(prev => prev + 1)}
                        className="w-8 h-8 rounded-xl hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                        title="Increase Quantity"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Add to List Button */}
                    <button
                      type="button"
                      onClick={handleAddItemToCart}
                      disabled={!product.trim()}
                      className="flex-1 h-11 bg-gradient-to-r from-primary to-blue-600 hover:opacity-95 text-white disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-primary/20"
                    >
                      <Plus size={16} /> Stage Medicine
                    </button>
                  </div>
                </div>

              </div>

              {/* Customer Details Inputs (No label headers) */}
              <div className="p-4 bg-bg2/50 border border-glass-border rounded-3xl shadow-sm space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {/* Customer Name */}
                  <div className="relative">
                    <User size={14} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
                    <input
                      type="text"
                      value={requester}
                      onChange={(e) => setRequester(e.target.value)}
                      className="w-full premium-input pl-10 pr-3 py-2.5 text-xs font-semibold rounded-2xl bg-bg3/40 border-glass-border"
                      placeholder="Customer Name (Optional)"
                      autoComplete="off"
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="relative">
                    <Phone size={14} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full premium-input pl-10 pr-3 py-2.5 text-xs font-semibold rounded-2xl bg-bg3/40 border-glass-border font-mono"
                      placeholder="Phone Number (Optional)"
                      maxLength={15}
                      autoComplete="off"
                    />
                  </div>

                  {/* Advance Payment */}
                  <div className="relative">
                    <IndianRupee size={14} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
                    <input
                      type="number"
                      value={advancePayment}
                      onChange={(e) => setAdvancePayment(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full premium-input pl-10 pr-3 py-2.5 text-xs font-semibold rounded-2xl bg-bg3/40 border-glass-border font-mono"
                      placeholder="Advance Payment (₹)"
                      min="0"
                      step="0.01"
                      autoComplete="off"
                    />
                  </div>

                  {/* Message Language */}
                  <div className="relative">
                    <Globe size={14} className="absolute left-3.5 top-3 text-muted pointer-events-none" />
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full premium-input pl-10 pr-3 py-2.5 text-xs font-semibold rounded-2xl bg-bg3/40 border-glass-border appearance-none cursor-pointer text-text"
                    >
                      <option value="en">🇬🇧 English</option>
                      <option value="hi">🇮🇳 Hindi</option>
                      <option value="mr">🇮🇳 Marathi</option>
                    </select>
                  </div>

                  {/* WhatsApp Notification Toggle */}
                  <div className="flex items-center justify-between p-2 rounded-2xl bg-bg3/30 border border-glass-border">
                    <div className="flex items-center gap-2">
                      <MessageCircle size={13} className={sendWhatsApp ? "text-emerald-400" : "text-muted"} />
                      <span className="text-[11px] font-semibold text-text">WhatsApp Alert</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSendWhatsApp(!sendWhatsApp)}
                      className={`px-2.5 py-0.5 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                        sendWhatsApp 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm' 
                          : 'bg-bg3 text-muted border border-border'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${sendWhatsApp ? 'bg-emerald-400 animate-pulse' : 'bg-muted'}`} />
                      {sendWhatsApp ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              </div>

            </div>


            {/* Right Column: Selected Items / Cart (2/5 cols) */}
            <div className="md:col-span-2 border-t md:border-t-0 md:border-l border-glass-border pt-4 md:pt-0 md:pl-5 flex flex-col h-[280px] md:h-auto overflow-hidden">
              <div className="flex items-center justify-between mb-3 select-none flex-shrink-0">
                <span className="font-semibold text-xs text-text uppercase tracking-wider flex items-center gap-1.5">
                  <ShoppingCart size={15} className="text-primary" /> Staged Items ({cart.length})
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 size={11} /> Clear All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin max-h-[260px] md:max-h-none">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted/65 italic text-xs select-none border border-dashed border-glass-border rounded-3xl bg-bg3/20">
                    <ShoppingCart size={32} className="text-muted/30 mb-2" />
                    <span>No items added yet. Search and click "Add to List" to build your order list.</span>
                  </div>
                ) : (
                  cart.map((item, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between p-3.5 rounded-2xl border border-glass-border bg-bg2 hover:bg-bg3/50 text-xs animate-in fade-in slide-in-from-right-3 duration-250 transition-all shadow-sm hover:shadow-md"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-bold text-text truncate text-sm" title={item.product}>{item.product}</div>
                        {item.distributor && (
                          <div className="text-[10px] text-muted flex items-center gap-1.5 mt-1 truncate">
                            <Store size={11} className="text-emerald-400 shrink-0" />
                            <span className="truncate font-semibold text-text/80">{item.distributor}</span>
                            {item.scheme && (
                              <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[8px] px-1.5 py-0.5 rounded-md font-extrabold uppercase shrink-0 flex items-center gap-0.5">
                                <Tag size={8} /> {item.scheme}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="font-mono font-extrabold bg-primary/15 text-primary border border-primary/25 px-2.5 py-1 rounded-xl text-xs flex items-center gap-1">
                          x{item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCartItem(idx)}
                          className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                          title="Remove item"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-glass-border flex justify-between items-center gap-4">
            <div className="text-[10px] text-muted font-mono font-semibold hidden md:flex items-center gap-1.5">
              <Layers size={12} className="text-primary" /> Total items to submit: {cart.length === 0 && product.trim() ? 1 : cart.length}
            </div>
            <div className="flex gap-3 w-full md:w-auto md:min-w-[260px]">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-xs font-bold py-2.5 rounded-2xl transition-all flex items-center justify-center gap-1.5"
              >
                <X size={14} /> Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (cart.length === 0 && !product.trim())}
                className="flex-1 bg-gradient-to-r from-primary to-purple-600 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold py-2.5 rounded-2xl transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] flex items-center justify-center gap-1.5 active:scale-95"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Submitting...
                  </>
                ) : (
                  <>
                    <ShoppingCart size={14} /> 
                    {cart.length > 0 ? `Add to Cart (${cart.length})` : 'Add to Cart'}
                  </>
                )}
              </button>
            </div>
          </div>
          
        </form>

        {/* Duplicate Item Resolution Overlay */}
        {duplicateMatch && pendingItemToAdd && (
          <div className="absolute inset-0 z-submodal flex items-center justify-center p-6 bg-black/80 backdrop-blur-md rounded-3xl transition-all duration-300 animate-in fade-in">
            <div className="bg-bg2 border border-glass-border p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle size={20} />
                <h4 className="text-sm font-extrabold uppercase tracking-wide">Similar Item Staged</h4>
              </div>
              
              <div className="text-xs space-y-3 text-text/90">
                <p>
                  You are staging <span className="font-bold text-text">"{pendingItemToAdd.product}"</span> (Qty: {pendingItemToAdd.qty}), which is similar to an item already in your list:
                </p>
                <div className="bg-bg3/60 border border-glass-border/30 rounded-2xl p-3.5 space-y-1.5">
                  <div className="font-bold text-text truncate">"{duplicateMatch.product}"</div>
                  <div className="text-[10px] text-muted flex items-center justify-between">
                    <span className="flex items-center gap-1"><Store size={10} /> Distributor: {duplicateMatch.distributor || 'None'}</span>
                    <span className="font-mono bg-primary/10 text-primary border border-primary/20 px-1.5 rounded-md">Qty: {duplicateMatch.qty}</span>
                  </div>
                </div>
                <p className="text-muted leading-relaxed">
                  Is this for the same customer (where you want to combine quantities) or a different customer?
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleResolveCombine}
                  className="w-full py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
                >
                  <Plus size={14} /> Combine Quantities (Total Qty: {duplicateMatch.qty + pendingItemToAdd.qty})
                </button>
                <button
                  type="button"
                  onClick={handleResolveSeparate}
                  className="w-full py-2.5 bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
                >
                  <ShoppingCart size={14} /> Add Separately (Different Customer)
                </button>
                <button
                  type="button"
                  onClick={handleResolveReplace}
                  className="w-full py-2.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
                >
                  <Zap size={14} /> Replace Staged Item
                </button>
                <button
                  type="button"
                  onClick={handleResolveCancel}
                  className="w-full py-2.5 bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
                >
                  <X size={14} /> Cancel / Ignore Addition
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer info hints */}
        <div className="mt-4 pt-3 border-t border-glass-border/30 flex justify-between text-[9px] text-muted/60 font-medium font-mono">
          <span className="flex items-center gap-1"><Clock size={10} /> [Esc] Close</span>
          <span className="flex items-center gap-1"><Zap size={10} /> [Alt + O] Toggle modal</span>
          <span className="flex items-center gap-1"><CheckCircle2 size={10} /> [Enter] Add / Submit</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
