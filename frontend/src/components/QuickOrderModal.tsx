import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Plus, Minus, ClipboardList, Sparkles, Loader2, ShoppingCart, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent, quickOrderEvent } from '../services/events';
import { useApiQuery } from '../hooks/useApiQuery';

interface SuggestionMedicine {
  inventory_id?: number;
  medicine_id?: number;
  medicine_name: string;
  batch_no?: string;
  quantity?: number;
  mrp?: number;
  isPharmarack?: boolean;
  distributor?: string;
  rate?: number;
  mapped?: boolean;
  packaging?: string;
  stock?: string;
  isErrorMessage?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
}

const getStockStyle = (stockStr: string | undefined): string => {
  if (!stockStr) return 'bg-bg3 text-muted border border-border';
  const stock = stockStr.trim();
  
  if (stock.toLowerCase() === 'high') {
    return 'bg-green-500/15 text-green border border-green-500/30';
  }
  if (stock.toLowerCase() === 'medium') {
    return 'bg-blue-500/15 text-blue border border-blue-500/30';
  }
  if (stock.toLowerCase() === 'low' || stock.toLowerCase() === 'out of stock' || stock.toLowerCase() === 'no stock' || stock === '0') {
    return 'bg-red-500/15 text-red border border-red-500/30';
  }
  
  const num = parseInt(stock);
  if (!isNaN(num)) {
    if (num >= 50) {
      return 'bg-green-500/15 text-green border border-green-500/30';
    } else if (num >= 15) {
      return 'bg-blue-500/15 text-blue border border-blue-500/30';
    } else {
      return 'bg-red-500/15 text-red border border-red-500/30';
    }
  }
  
  return 'bg-bg3 text-muted border border-border';
};

interface SchemeInfo {
  buy: number;
  free: number;
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
  const [cart, setCart] = useState<any[]>([]);

  // Form State
  const [product, setProduct] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState(1);
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState<'Low' | 'Normal' | 'High'>('Normal');
  
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
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prMode, setPrMode] = useState<'Live' | 'Unknown'>('Unknown');

  // Duplicate check states
  const [duplicateMatch, setDuplicateMatch] = useState<any | null>(null);
  const [duplicateMatchIndex, setDuplicateMatchIndex] = useState<number>(-1);
  const [pendingItemToAdd, setPendingItemToAdd] = useState<any | null>(null);

  // Cheaper option state
  const [cheaperDistributor, setCheaperDistributor] = useState<any | null>(null);

  useEffect(() => {
    if (isOpen) {
      const fetchSessionStatus = async () => {
        try {
          const data = await api.checkPharmarackSession();
          setPrMode(data.mode || 'Live');
        } catch (err) {
          console.error('Failed to fetch Pharmarack session status in modal:', err);
          setPrMode('Live');
        }
      };
      fetchSessionStatus();
    }
  }, [isOpen]);

  const handleSwitchToCheaper = () => {
    if (cheaperDistributor) {
      setSelectedDistributor(cheaperDistributor.distributor || '');
      setSelectedRate(cheaperDistributor.rate !== undefined && cheaperDistributor.rate !== null ? cheaperDistributor.rate : '');
      setSelectedMrp(cheaperDistributor.mrp !== undefined && cheaperDistributor.mrp !== null ? cheaperDistributor.mrp : '');
      setSelectedMapped(cheaperDistributor.mapped !== undefined ? cheaperDistributor.mapped : null);
      setSelectedScheme(cheaperDistributor.scheme || '');
      setSelectedProductId(cheaperDistributor.productId || '');
      setSelectedStoreId(cheaperDistributor.storeId || '');
      setSelectedProductCode(cheaperDistributor.productCode || '');
      setSelectedCompany(cheaperDistributor.company || '');
      setSelectedPackaging(cheaperDistributor.packaging || '');
      toastEvent.trigger(`Switched to cheaper option from ${cheaperDistributor.distributor}!`, 'success');
    }
  };

  useEffect(() => {
    if (selectedStoreId && selectedProductId && selectedRate !== '') {
      const currentEff = getEffectiveRate(Number(selectedRate), selectedScheme, qty);
      
      let bestOption: any = null;
      let bestEff = currentEff;

      suggestions.forEach(item => {
        if (item.storeId !== selectedStoreId && item.rate) {
          const nameClean1 = item.medicine_name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const nameClean2 = product.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (nameClean1 === nameClean2 && item.rate) {
            const itemEff = getEffectiveRate(item.rate, item.scheme, qty);
            if (itemEff < bestEff - 0.01) {
              bestEff = itemEff;
              bestOption = {
                ...item,
                effectiveRate: itemEff
              };
            }
          }
        }
      });

      setCheaperDistributor(bestOption);
    } else {
      setCheaperDistributor(null);
    }
  }, [selectedStoreId, selectedProductId, selectedRate, selectedScheme, qty, suggestions, product]);

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

  const insertItemToCart = (item: any) => {
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
  const ignoreNextSearchRef = useRef(false);

  // Autofocus on mount
  useEffect(() => {
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

  // Medicine autocomplete search
  useEffect(() => {
if (ignoreNextSearchRef.current) {
      ignoreNextSearchRef.current = false;
      return;
    }

    const query = product.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
  }, [product]);

  // React Query for local search with dedup + abort
  const { data: localSearchData, isLoading: isLocalSearchLoading } = useApiQuery(
    ['medicine-search-local', product.trim()],
    () => api.searchMedicine(product.trim()),
    { enabled: product.trim().length >= 3, staleTime: 10_000 }
  );

  // Process local search results and combine with Pharmarack
  useEffect(() => {
    if (!localSearchData || !Array.isArray(localSearchData)) {
      setSuggestions(prev => {
        const prOnly = prev.filter(s => s.isPharmarack);
        return prOnly;
      });
      return;
    }

    let localSuggestions: SuggestionMedicine[] = [];

    const groupedLocal: Record<string, {
      medicine_id?: number;
      medicine_name: string;
      quantity: number;
      mrp?: number;
    }> = {};

    localSearchData.forEach((item: any) => {
      const name = item.medicine_name || item.name || '';
      const key = name.toLowerCase().trim();
      const qty = Number(item.quantity) || 0;
      
      if (!groupedLocal[key]) {
        groupedLocal[key] = {
          medicine_id: item.medicine_id,
          medicine_name: name,
          quantity: qty,
          mrp: item.mrp
        };
      } else {
        groupedLocal[key].quantity += qty;
        if (item.mrp && (!groupedLocal[key].mrp || item.mrp > groupedLocal[key].mrp)) {
          groupedLocal[key].mrp = item.mrp;
        }
      }
    });

    Object.values(groupedLocal).forEach((med) => {
      localSuggestions.push({
        medicine_id: med.medicine_id,
        medicine_name: med.medicine_name,
        quantity: med.quantity,
        mrp: med.mrp,
        isPharmarack: false
      });
    });

    setSuggestions(prev => {
      const prOnly = prev.filter(s => s.isPharmarack);
      return [...localSuggestions, ...prOnly];
    });
    setShowSuggestions(true);
    setActiveSuggestionIndex(-1);
    setSearchLoading(false);
  }, [localSearchData]);

  // Pharmarack search (keep existing async logic but simplify)
  useEffect(() => {
    const query = product.trim();
    if (query.length < 3) return;

    let active = true;

    const delayDebounce = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const prData = await api.searchPharmarack(query).catch((err: any) => {
          const errMsg = err?.response?.data?.error || 'Connection error, please check internet or reconnect';
          return { isError: true, message: errMsg };
        });

        if (!active) return;

        const prSuggestions: SuggestionMedicine[] = [];
        if (prData && (prData as any).isError) {
          prSuggestions.push({
            medicine_name: `⚠️ ${(prData as any).message}`,
            isPharmarack: true,
            isErrorMessage: true
          });
        } else if (Array.isArray(prData)) {
          const hasMapped = prData.some((item: any) => item.mapped);
          if (prData.length === 0 || !hasMapped) {
            if (query.length >= 3 && query !== lastToastedQueryRef.current) {
              toastEvent.trigger('No mapped distributor has product', 'info');
              lastToastedQueryRef.current = query;
            }
          }

          prData.forEach((item: any) => {
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

        setSuggestions(prev => {
          const localOnly = prev.filter(s => !s.isPharmarack);
          return [...localOnly, ...prSuggestions];
        });
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
    ignoreNextSearchRef.current = true;
    if (med.isPharmarack) {
      setProduct(`${med.medicine_name} (${med.packaging})`);
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
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);

    // Focus quantity input automatically for editing
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  };

  // Submit Order Form
  const processSubmissionQueue = async (items: any[], customerName: string, customerPhone: string, orderPriority: 'Low' | 'Normal' | 'High', advanceAmt: number) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await api.createOrder({
          product: item.product,
          requester: customerName,
          phone: customerPhone,
          qty: item.qty,
          priority: orderPriority,
          status: 'Pending',
          pharmarack_distributor: item.distributor,
          pharmarack_rate: item.rate,
          pharmarack_mrp: item.mrp,
          pharmarack_mapped: item.mapped ? 1 : 0,
          pharmarack_scheme: item.scheme,
          advance_payment: i === 0 ? advanceAmt : 0
        });
        
        // Success notification for this individual item
        toastEvent.trigger(`Logged request: "${item.product}" (${i + 1}/${items.length})`, 'success');
        
        // Trigger page refresh so it shows in the table
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));

        // If it's a Pharmarack product, also add it to the actual Pharmarack cart!
        if (item.productId && item.storeId) {
          try {
            const res = await api.addPharmarackCart([{
              productId: item.productId,
              storeId: item.storeId,
              qty: item.qty,
              rate: item.rate,
              scheme: item.scheme,
              productCode: item.productCode,
              company: item.company,
              productName: item.product,
              storeName: item.distributor,
              packaging: item.packaging
            }]);
            toastEvent.trigger(`Added "${item.product}" to actual Pharmarack cart!`, 'success');
          } catch (cartErr: any) {
            console.error(`Failed to add ${item.product} to actual Pharmarack cart:`, cartErr);
            const detailedError = cartErr?.response?.data?.details || cartErr?.response?.data?.error || cartErr?.message || 'Unknown error';
            toastEvent.trigger(`Could not add "${item.product}" to Pharmarack cart: ${detailedError}`, 'error');
          }
        }
      } catch (err) {
        console.error(`Failed to log background request for ${item.product}:`, err);
        toastEvent.trigger(`Failed to log: "${item.product}"`, 'error');
      }

      // If this is not the last item, wait 30 to 45 seconds (human behavior)
      if (i < items.length - 1) {
        const delaySec = Math.floor(Math.random() * 16) + 30; // Random seconds between 30 and 45
        // Show status toast
        toastEvent.trigger(`Next request will be logged in ${delaySec} seconds...`, 'info');
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto stage current input if cart is empty but something is typed
    let finalItems = [...cart];
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

    // Capture customer & priority details
    const customerName = requester.trim();
    const customerPhone = phone.replace(/\D/g, '');
    const orderPriority = priority;
    const advanceAmt = advancePayment !== '' ? Number(advancePayment) : 0;

    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error');
      return;
    }
    if (!customerPhone) {
      toastEvent.trigger('Phone Number is required.', 'error');
      return;
    }
    if (customerPhone.length < 10) {
      toastEvent.trigger('Please enter a valid 10-digit mobile number.', 'error');
      return;
    }

    // Reset state and close modal immediately
    setCart([]);
    setProduct('');
    setRequester('');
    setPhone('');
    setQty(1);
    setAdvancePayment('');
    setPriority('Normal');
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
    processSubmissionQueue(finalItems, customerName, customerPhone, orderPriority, advanceAmt);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div className="glass-panel max-w-md md:max-w-3xl w-full p-6 relative border border-glass-border shadow-[0_0_50px_rgba(59,130,246,0.2)] bg-bg2 text-text animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-all"
          title="Close Modal (Esc)"
        >
          <X size={18} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-primary/10 rounded-lg text-primary border border-primary/20">
            <ClipboardList size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-text flex items-center gap-2">
              Quick Special Request
              <span className="text-[10px] bg-bg3 border border-glass-border text-muted px-2 py-0.5 rounded font-mono">Alt + O</span>
              {prMode !== 'Unknown' && (
                <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border leading-none bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  ● LIVE
                </span>
              )}
            </h3>
            <p className="text-xs text-muted">Instantly log out-of-stock demands from any screen</p>
          </div>
        </div>

        {/* Form Grid */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            
            {/* Left Column: Input Form (3/5 cols) */}
            <div className="md:col-span-3 flex flex-col gap-4">
              
              {/* Search & Add Item Section */}
              <div className="space-y-4 p-4.5 bg-bg2/40 border border-border/40 rounded-3xl shadow-sm hover:shadow-md transition-all duration-300">
                <div className="flex items-center gap-2 mb-1.5 select-none">
                  <span className="w-1.5 h-3.5 bg-primary rounded-full inline-block"></span>
                  <div className="font-bold text-xs text-text/90 uppercase tracking-wider">1. Search & Stage Medicine</div>
                </div>
                
                {/* Product / Medicine Autocomplete */}
                <div className="relative animate-in fade-in duration-200" ref={autocompleteRef}>
                  <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Medicine Name</label>
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
                      className="w-full premium-input pl-11 pr-5 py-3 text-sm font-semibold"
                      placeholder="Search or enter medicine name..."
                      autoComplete="off"
                    />
                  </div>
                  
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute z-[999999] left-0 right-0 mt-1 max-h-96 overflow-y-auto bg-bg2 border border-glass-border backdrop-blur-xl rounded-xl shadow-2xl divide-y divide-glass-border/30 py-2">
                      {suggestions.map((med, index) => {
                        const isPr = med.isPharmarack;
                        return (
                          <li
                            key={index}
                            onClick={() => selectSuggestion(med)}
                            className={`px-5 py-3 text-sm cursor-pointer flex justify-between items-center transition-all ${
                              med.isErrorMessage
                                ? 'bg-red-500/10 text-red border-l-2 border-red cursor-default'
                                : index === activeSuggestionIndex 
                                ? 'bg-primary/20 text-text font-semibold border-l-2 border-primary' 
                                : 'text-muted hover:text-text hover:bg-bg3'
                            }`}
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-text truncate text-sm">{med.medicine_name}</span>
                                {isPr && !med.isErrorMessage && (
                                  <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-semibold uppercase">
                                    Pharmarack
                                  </span>
                                )}
                                {isPr && med.stock !== undefined && !med.isErrorMessage && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${getStockStyle(med.stock)}`}>
                                    {med.stock} Stock
                                  </span>
                                )}
                                {isPr && med.scheme && !med.isErrorMessage && (
                                  <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold uppercase">
                                    Scheme: {med.scheme}
                                  </span>
                                )}
                              </div>
                              {isPr ? (
                                !med.isErrorMessage && (
                                  <span className="text-xs text-muted block truncate mt-1">
                                    {med.distributor ? (
                                      <>
                                        <span className={med.mapped ? 'text-text' : 'text-purple-400 font-semibold'}>
                                          {med.distributor}
                                        </span>
                                        <span> ({med.mapped ? 'Mapped' : 'Non-mapped'})</span>
                                      </>
                                    ) : (
                                      'No Distributor'
                                    )}
                                    {med.packaging ? ` • ${med.packaging}` : ''}
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-muted block truncate mt-1">
                                  Company: <span className="text-text font-semibold">{med.company || (med as any).manufacturer || 'Generic'}</span>
                                </span>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0 flex flex-col justify-center items-end">
                              {isPr ? (
                                !med.isErrorMessage && (
                                  <div className="text-xs font-mono font-bold text-text flex flex-col items-end">
                                    {med.rate !== undefined && med.rate !== null ? (
                                      <span className="text-emerald-400">PTR: ₹{med.rate}</span>
                                    ) : null}
                                    {med.mrp !== undefined && med.mrp !== null ? (
                                      <span className="text-muted text-[10px]">MRP: ₹{med.mrp}</span>
                                    ) : null}
                                  </div>
                                )
                              ) : (
                                med.mrp !== undefined && (
                                  <span className="text-xs font-mono font-bold text-green">
                                    MRP: ₹{Math.round(med.mrp)}
                                  </span>
                                )
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Selected Pharmarack item details preview */}
                  {selectedDistributor && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-text flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="truncate pr-2">
                        <div className="font-bold text-emerald-500 text-[10px] uppercase tracking-wider mb-1">Pharmarack Match</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-text font-semibold truncate">{selectedDistributor}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            selectedMapped 
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                              : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          }`}>
                            {selectedMapped ? 'Mapped' : 'Non-mapped'}
                          </span>
                          {selectedScheme && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase">
                              Scheme: {selectedScheme}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="font-mono font-extrabold whitespace-nowrap flex flex-col items-end gap-0.5 text-right shrink-0">
                          {selectedRate !== '' && <span className="text-emerald-500 text-sm">PTR: ₹{selectedRate}</span>}
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
                          className="p-1.5 text-muted hover:text-red hover:bg-red-500/10 rounded-xl transition-all ml-1.5"
                          title="Cancel distributor selection"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Cheaper distributor suggestion banner */}
                  {cheaperDistributor && (
                    <button
                      type="button"
                      onClick={handleSwitchToCheaper}
                      className="mt-3 w-full text-left p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-text flex items-center justify-between shadow-sm hover:bg-amber-500/15 transition-all select-none animate-in fade-in slide-in-from-top-2 duration-200"
                    >
                      <div className="pr-2 min-w-0 flex-1">
                        <div className="font-bold text-amber-400 flex items-center gap-1 uppercase tracking-wider text-[10px] mb-1">
                          <Sparkles size={13} />
                          <span>Cheaper Distributor Offer Available!</span>
                        </div>
                        <div className="text-text/90">
                          <span className="font-bold">{cheaperDistributor.distributor}</span> has this for an effective PTR of <span className="font-black text-emerald-400">₹{cheaperDistributor.effectiveRate.toFixed(2)}</span>
                          {cheaperDistributor.scheme && ` (with ${cheaperDistributor.scheme} scheme)`}.
                        </div>
                      </div>
                      <div className="text-[10px] font-bold text-amber-400 bg-amber-500/20 px-2 py-1 rounded-xl shrink-0 uppercase tracking-wider">
                        Switch
                      </div>
                    </button>
                  )}
                </div>

                {/* Quantity and Add Button Row */}
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 select-none">Quantity</label>
                    <div className="flex items-center justify-between bg-bg3 border border-border/50 rounded-2xl h-11 px-1.5">
                      <button
                        type="button"
                        onClick={() => setQty(prev => Math.max(1, prev - 1))}
                        className="w-8 h-8 rounded-xl hover:bg-bg2/80 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
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
                        className="w-full bg-transparent text-center text-sm font-bold outline-none text-text focus:ring-0 border-0 p-0"
                        min="1"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setQty(prev => prev + 1)}
                        className="w-8 h-8 rounded-xl hover:bg-bg2/80 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItemToCart}
                    disabled={!product.trim()}
                    className="px-5 h-11 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-2xl transition-all flex items-center gap-1.5 active:scale-95 shrink-0 shadow-sm"
                  >
                    <Plus size={16} /> Add to Cart
                  </button>
                </div>

              </div>

              {/* Customer & Priority details */}
              <div className="space-y-4 p-4.5 bg-bg2/40 border border-border/40 rounded-3xl shadow-sm hover:shadow-md transition-all duration-300">
                <div className="flex items-center gap-2 mb-1.5 select-none">
                  <span className="w-1.5 h-3.5 bg-purple-500 rounded-full inline-block"></span>
                  <div className="font-bold text-xs text-text/90 uppercase tracking-wider">2. Customer Details & Priority</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 select-none">Customer Name *</label>
                    <input
                      type="text"
                      value={requester}
                      onChange={(e) => setRequester(e.target.value)}
                      className="w-full premium-input py-2 text-xs font-semibold rounded-xl bg-bg3/20 border-border/60"
                      placeholder="e.g. John Doe"
                      required
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 select-none">Phone Number *</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full premium-input py-2 text-xs font-semibold rounded-xl bg-bg3/20 border-border/60"
                      placeholder="e.g. 9876543210"
                      maxLength={15}
                      required
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 select-none">Advance Payment</label>
                    <input
                      type="number"
                      value={advancePayment}
                      onChange={(e) => setAdvancePayment(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full premium-input py-2 text-xs font-semibold rounded-xl bg-bg3/20 border-border/60"
                      placeholder="e.g. 500 (Optional)"
                      min="0"
                      step="0.01"
                      autoComplete="off"
                    />
                  </div>
                </div>
                {phone.replace(/\D/g, '').length === 10 && (
                  <span className="text-[9px] text-green/80 flex items-center gap-1 mt-1 font-medium select-none animate-pulse">
                    <Sparkles size={10} /> Automated WhatsApp booking confirmation will be dispatched
                  </span>
                )}
                
                <div>
                  <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 select-none">Priority</label>
                  <div className="flex bg-bg3 border border-border/40 rounded-2xl p-1 h-10 select-none">
                    {(['Low', 'Normal', 'High'] as const).map((p) => {
                      const active = priority === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          className={`flex-1 text-xs font-bold rounded-xl transition-all duration-300 ${
                            active 
                              ? p === 'High' 
                                ? 'bg-red-500/20 text-red border border-red-500/30 shadow-sm' 
                                : p === 'Low'
                                ? 'bg-bg3 text-text border border-border'
                                : 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                              : 'text-muted hover:text-text hover:bg-bg3'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column: Selected Items / Cart (2/5 cols) */}
            <div className="md:col-span-2 border-t md:border-t-0 md:border-l border-glass-border/40 pt-4 md:pt-0 md:pl-4 flex flex-col h-[280px] md:h-auto overflow-hidden">
              <div className="flex items-center justify-between mb-2 select-none flex-shrink-0">
                <span className="font-semibold text-xs text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardList size={14} className="text-primary" /> Staged Items ({cart.length})
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-[10px] font-bold text-red hover:text-red-400"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin max-h-[260px] md:max-h-none">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted/65 italic text-xs select-none">
                    No items added yet. Search and click "Add to Cart" to build your list.
                  </div>
                ) : (
                  cart.map((item, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between p-3.5 rounded-2xl border border-border/40 bg-bg2 hover:bg-bg3/50 text-xs animate-in fade-in slide-in-from-right-3 duration-250 transition-all shadow-sm hover:shadow-md"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-bold text-text truncate text-sm" title={item.product}>{item.product}</div>
                        {item.distributor && (
                          <div className="text-[10px] text-muted flex items-center gap-1.5 mt-1 truncate">
                            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0"></span>
                            <span className="truncate font-medium">{item.distributor}</span>
                            {item.scheme && (
                              <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[8px] px-1.5 py-0.5 rounded-md font-extrabold uppercase shrink-0">
                                {item.scheme}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="font-mono font-extrabold bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-xl text-xs animate-in zoom-in-75 duration-200">
                          x{item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCartItem(idx)}
                          className="p-1.5 text-muted hover:text-red hover:bg-red-500/10 rounded-xl transition-all"
                          title="Remove item"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-glass-border/30 flex justify-between items-center gap-4">
            <div className="text-[10px] text-muted font-mono font-semibold hidden md:block">
              Total items to add: {cart.length === 0 && product.trim() ? 1 : cart.length}
            </div>
            <div className="flex gap-3 w-full md:w-auto md:min-w-[240px]">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 bg-bg3 hover:bg-bg2 border border-glass-border/50 premium-btn text-muted hover:text-text text-xs font-bold py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (cart.length === 0 && !product.trim())}
                className="flex-1 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed premium-btn text-white text-xs font-bold py-2 shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Adding...
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
          <div className="absolute inset-0 z-[99999] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md rounded-3xl transition-all duration-300 animate-in fade-in">
            <div className="bg-bg2 border border-glass-border p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle size={20} />
                <h4 className="text-sm font-extrabold uppercase tracking-wide">Similar Item Staged</h4>
              </div>
              
              <div className="text-xs space-y-3 text-text/90">
                <p>
                  You are staging <span className="font-bold text-text">"{pendingItemToAdd.product}"</span> (Qty: {pendingItemToAdd.qty}), which is similar to an item already in your list:
                </p>
                <div className="bg-bg3/60 border border-glass-border/30 rounded-xl p-3 space-y-1">
                  <div className="font-bold text-text truncate">"{duplicateMatch.product}"</div>
                  <div className="text-[10px] text-muted flex items-center justify-between">
                    <span>Distributor: {duplicateMatch.distributor || 'None'}</span>
                    <span className="font-mono bg-primary/10 text-primary border border-primary/20 px-1.5 rounded">Qty: {duplicateMatch.qty}</span>
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
                  className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-bold rounded-xl transition-all"
                >
                  Combine Quantities (Total Qty: {duplicateMatch.qty + pendingItemToAdd.qty})
                </button>
                <button
                  type="button"
                  onClick={handleResolveSeparate}
                  className="w-full py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-bold rounded-xl transition-all"
                >
                  Add Separately (Different Customer)
                </button>
                <button
                  type="button"
                  onClick={handleResolveReplace}
                  className="w-full py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 text-xs font-bold rounded-xl transition-all"
                >
                  Replace Staged Item
                </button>
                <button
                  type="button"
                  onClick={handleResolveCancel}
                  className="w-full py-2 bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-xs font-bold rounded-xl transition-all"
                >
                  Cancel / Ignore Addition
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer info hints */}
        <div className="mt-4 pt-3 border-t border-glass-border/30 flex justify-between text-[9px] text-muted/60 font-medium font-mono">
          <span>[Esc] Close</span>
          <span>[Alt + O] Toggle modal</span>
          <span>[Enter] Add / Submit</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
