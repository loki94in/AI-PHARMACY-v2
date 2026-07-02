import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Plus, Minus, Sparkles, Loader2, ShoppingCart, RefreshCw, Clock } from 'lucide-react';
import { api, type SpecialOrder, type Refill } from '../services/api';
import { toastEvent, liveCartAddEvent } from '../services/events';

interface SuggestionMedicine {
  medicine_name: string;
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
  mrp?: number;
}

const getStockStyle = (stockStr: string | undefined): string => {
  if (!stockStr) return 'bg-bg3 text-muted border border-border';
  const stock = stockStr.trim();
  
  if (stock.toLowerCase() === 'high') {
    return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }
  if (stock.toLowerCase() === 'medium') {
    return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
  }
  if (stock.toLowerCase() === 'low' || stock.toLowerCase() === 'out of stock' || stock.toLowerCase() === 'no stock' || stock === '0') {
    return 'bg-red-500/10 text-red border border-red-500/20';
  }
  
  const num = parseInt(stock);
  if (!isNaN(num)) {
    if (num >= 50) {
      return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    } else if (num >= 15) {
      return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    } else {
      return 'bg-red-500/10 text-red border border-red-500/20';
    }
  }
  
  return 'bg-bg3 text-muted border border-border';
};

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

export const LiveCartAddModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isOpen, setIsOpen] = useState(true);
  
  const handleClose = () => {
    setIsOpen(false);
    onClose();
  };
  
  // Input fields
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState(1);
  
  // Selected Pharmarack Metadata
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
  const [selectedMedicineName, setSelectedMedicineName] = useState('');

  // Suggestions Search
  const [suggestions, setSuggestions] = useState<SuggestionMedicine[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prMode, setPrMode] = useState<'Live' | 'Unknown'>('Unknown');

  // Cart Preview States
  const [cartDistributors, setCartDistributors] = useState<Distributor[]>([]);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  // Pending Orders States and Functions
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>([]);
  const [addingOrderId, setAddingOrderId] = useState<number | null>(null);

  // Pending Refills States and Functions
  const [pendingRefills, setPendingRefills] = useState<Refill[]>([]);
  const [addingRefillId, setAddingRefillId] = useState<number | null>(null);

  // Reconcile Orders (unreconciled distributor email orders)
  const [reconOrders, setReconOrders] = useState<any[]>([]);

  // Distributor Picker States (for Orders & Refills)
  const [distributorPickerOrderId, setDistributorPickerOrderId] = useState<number | null>(null);
  const [distributorPickerRefillId, setDistributorPickerRefillId] = useState<number | null>(null);
  const [distributorPickerResults, setDistributorPickerResults] = useState<SuggestionMedicine[]>([]);
  const [distributorPickerLoading, setDistributorPickerLoading] = useState(false);

  const fetchPendingOrders = async () => {
    try {
      const data = await api.getOrders();
      if (Array.isArray(data)) {
        const filtered = data.filter(o => o.status === 'Pending' || o.status === 'Ordered');
        setPendingOrders(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch pending special orders in modal:', err);
    }
  };

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
      }
    } catch (err) {
      console.error('Failed to fetch pending refills in modal:', err);
    }
  };

  const fetchReconOrders = async () => {
    try {
      const data = await api.getReconciliationList();
      if (Array.isArray(data)) {
        // Only show unresolved / missing reconcile items
        setReconOrders(data.filter((r: any) => !r.is_saved && r.status !== 'Matched'));
      }
    } catch (err) {
      console.error('Failed to fetch reconcile orders in modal:', err);
    }
  };

  const getRefillItemInCart = (refill: Refill) => {
    const refillNameNorm = (refill.medicine_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of cartDistributors) {
      for (const item of dist.items) {
        const cartNameNorm = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cartNameNorm.includes(refillNameNorm) || refillNameNorm.includes(cartNameNorm)) {
          return item;
        }
      }
    }
    return null;
  };

  const handleSearchDistributorsForRefill = async (refill: Refill) => {
    setDistributorPickerRefillId(refill.id);
    setDistributorPickerResults([]);
    setDistributorPickerLoading(true);
    try {
      const medName = refill.medicine_name || `Medicine ${refill.medicine_id}`;
      const searchResults = await api.searchPharmarack(medName);
      if (!searchResults || searchResults.length === 0) {
        toastEvent.trigger(`No Pharmarack matches found for "${medName}"`, 'error');
        setDistributorPickerRefillId(null);
        return;
      }
      const mapped: SuggestionMedicine[] = (searchResults as any[]).map((item) => ({
        medicine_name: item.name,
        mrp: item.mrp,
        isPharmarack: true,
        distributor: item.distributor,
        rate: item.rate,
        mapped: item.mapped,
        packaging: item.packaging,
        stock: item.stock,
        scheme: item.scheme,
        productId: item.productId,
        storeId: item.storeId,
        productCode: item.productCode,
        company: item.company
      }));
      setDistributorPickerResults(mapped);
    } catch (err: any) {
      console.error('Failed to search distributors for refill:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to search distributors', 'error');
      setDistributorPickerRefillId(null);
    } finally {
      setDistributorPickerLoading(false);
    }
  };

  const handleConfirmRefillDistributor = async (refill: Refill, picked: SuggestionMedicine) => {
    setAddingRefillId(refill.id);
    try {
      const payload = [{
        productId: picked.productId!,
        storeId: picked.storeId!,
        qty: 1,
        productCode: picked.productCode,
        productName: picked.medicine_name,
        company: picked.company,
        packaging: picked.packaging,
        rate: picked.rate || 0,
        mrp: picked.mrp || 0,
        storeName: picked.distributor,
        mapped: picked.mapped
      }];
      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger(`Added "${refill.medicine_name}" to Pharmarack cart!`, 'success');
        setDistributorPickerRefillId(null);
        setDistributorPickerResults([]);
        await fetchCart();
        await fetchPendingRefills();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
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

  const getOrderItemInCart = (order: SpecialOrder) => {
    const orderNameNorm = order.product.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of cartDistributors) {
      for (const item of dist.items) {
        const cartNameNorm = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cartNameNorm.includes(orderNameNorm) || orderNameNorm.includes(cartNameNorm)) {
          return item;
        }
      }
    }
    return null;
  };

  const handleSearchDistributorsForOrder = async (order: SpecialOrder) => {
    setDistributorPickerOrderId(order.id);
    setDistributorPickerResults([]);
    setDistributorPickerLoading(true);
    try {
      const searchResults = await api.searchPharmarack(order.product);
      if (!searchResults || searchResults.length === 0) {
        toastEvent.trigger(`No Pharmarack matches found for "${order.product}"`, 'error');
        setDistributorPickerOrderId(null);
        return;
      }
      const mapped: SuggestionMedicine[] = (searchResults as any[]).map((item) => ({
        medicine_name: item.name,
        mrp: item.mrp,
        isPharmarack: true,
        distributor: item.distributor,
        rate: item.rate,
        mapped: item.mapped,
        packaging: item.packaging,
        stock: item.stock,
        scheme: item.scheme,
        productId: item.productId,
        storeId: item.storeId,
        productCode: item.productCode,
        company: item.company
      }));
      setDistributorPickerResults(mapped);
    } catch (err: any) {
      console.error('Failed to search distributors for order:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to search distributors', 'error');
      setDistributorPickerOrderId(null);
    } finally {
      setDistributorPickerLoading(false);
    }
  };

  const handleConfirmOrderDistributor = async (order: SpecialOrder, picked: SuggestionMedicine) => {
    setAddingOrderId(order.id);
    try {
      const payload = [{
        productId: picked.productId!,
        storeId: picked.storeId!,
        qty: order.qty,
        productCode: picked.productCode,
        productName: picked.medicine_name,
        company: picked.company,
        packaging: picked.packaging,
        rate: order.pharmarack_rate || picked.rate || 0,
        mrp: order.pharmarack_mrp || picked.mrp || 0,
        storeName: picked.distributor,
        mapped: picked.mapped
      }];
      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger(`Added "${order.product}" to Pharmarack cart!`, 'success');
        await api.updateOrder(order.id, { status: 'Ordered' });
        setDistributorPickerOrderId(null);
        setDistributorPickerResults([]);
        await fetchCart();
        await fetchPendingOrders();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
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

  // Cheaper option state
  const [cheaperDistributor, setCheaperDistributor] = useState<any | null>(null);

  const autocompleteRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const ignoreNextSearchRef = useRef(false);

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
      setSelectedMedicineName(cheaperDistributor.medicine_name || '');
      toastEvent.trigger(`Switched to cheaper option from ${cheaperDistributor.distributor}!`, 'success');
    }
  };

  useEffect(() => {
    if (selectedStoreId && selectedProductId && selectedRate !== '' && selectedMedicineName) {
      const currentEff = getEffectiveRate(Number(selectedRate), selectedScheme, qty);
      
      let bestOption: any = null;
      let bestEff = currentEff;

      suggestions.forEach(item => {
        // Only suggest from mapped (main) distributors
        if (item.storeId !== selectedStoreId && item.rate && item.mapped === true) {
          const nameClean1 = item.medicine_name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const nameClean2 = selectedMedicineName.toLowerCase().replace(/[^a-z0-9]/g, '');
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
  }, [selectedStoreId, selectedProductId, selectedRate, selectedScheme, qty, suggestions, selectedMedicineName]);

  // Find the minimum effective rate among all suggestions to identify the best rate option
  const minEffectiveRate = React.useMemo(() => {
    let min = Infinity;
    suggestions.forEach(item => {
      if (item.isErrorMessage || !item.rate) return;
      const eff = getEffectiveRate(item.rate, item.scheme, qty);
      if (eff < min) {
        min = eff;
      }
    });
    return min;
  }, [suggestions, qty]);

  // fetchCart logic
  const fetchCart = async () => {
    setCartLoading(true);
    setCartError(null);
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        setCartDistributors(data.distributors || []);
      } else {
        setCartError('Failed to retrieve cart details.');
      }
    } catch (err: any) {
      console.error('Failed to fetch Pharmarack cart in modal:', err);
      setCartError(err?.response?.data?.error || err?.message || 'Error fetching cart');
    } finally {
      setCartLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCart();
      fetchPendingOrders();
      fetchPendingRefills();
      fetchReconOrders();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleRefresh = () => {
      if (isOpen) {
        fetchCart();
        fetchPendingOrders();
        fetchPendingRefills();
        fetchReconOrders();
      }
    };
    window.addEventListener('refresh-pharmarack-cart', handleRefresh);
    return () => window.removeEventListener('refresh-pharmarack-cart', handleRefresh);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const fetchSessionStatus = async () => {
        try {
          const data = await api.checkPharmarackSession();
          setPrMode(data.mode || 'Live');
        } catch (err) {
          console.error('Failed to fetch Pharmarack session status in live add modal:', err);
          setPrMode('Live');
        }
      };
      fetchSessionStatus();
    }
  }, [isOpen]);

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

  // Handle clicking outside to dismiss search results
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Live Query autocomplete
  useEffect(() => {
    if (ignoreNextSearchRef.current) {
      ignoreNextSearchRef.current = false;
      return;
    }

    if (product.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const prData = await api.searchPharmarack(product).catch((err: any) => {
          const errMsg = err?.response?.data?.error || 'Connection error, please check internet or reconnect';
          return { isError: true, message: errMsg };
        });

        const mergedList: SuggestionMedicine[] = [];

        if (prData && (prData as any).isError) {
          mergedList.push({
            medicine_name: `âš ï¸ ${(prData as any).message}`,
            isPharmarack: true,
            isErrorMessage: true
          });
        } else if (Array.isArray(prData)) {
          if (prData.length === 0) {
            toastEvent.trigger('No matching distributor offers found.', 'info');
          }
          prData.forEach((item: any) => {
            mergedList.push({
              medicine_name: item.name,
              mrp: item.mrp,
              isPharmarack: true,
              distributor: item.distributor,
              rate: item.rate,
              mapped: item.mapped,
              packaging: item.packaging,
              stock: item.stock,
              scheme: item.scheme,
              productId: item.productId,
              storeId: item.storeId,
              productCode: item.productCode,
              company: item.company
            });
          });
        }

        setSuggestions(mergedList);
        setShowSuggestions(mergedList.length > 0);
        setActiveSuggestionIndex(-1);
      } catch (err) {
        console.error('Error searching Pharmarack live catalog:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [product]);

  const handleProductChange = (val: string) => {
    setProduct(val);
    if (selectedProductId) {
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
      setSelectedMedicineName('');
    }
  };

  const selectSuggestion = (med: SuggestionMedicine) => {
    if (med.isErrorMessage) return;
    ignoreNextSearchRef.current = true;
    
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
    setSelectedMedicineName(med.medicine_name || '');

    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);

    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  };

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

    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        selectSuggestion(suggestions[activeSuggestionIndex]);
      } else {
        handleSubmit(e);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProductId || !selectedStoreId) {
      toastEvent.trigger('Please search and select a matching distributor product from the dropdown list.', 'error');
      return;
    }

    if (qty < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.addPharmarackCart([{
        productId: selectedProductId,
        storeId: selectedStoreId,
        qty,
        rate: selectedRate !== '' ? Number(selectedRate) : undefined,
        scheme: selectedScheme || undefined,
        productCode: selectedProductCode,
        company: selectedCompany,
        productName: product.trim(),
        storeName: selectedDistributor,
        packaging: selectedPackaging,
        mapped: selectedMapped === false ? false : true
      }]);

      toastEvent.trigger(`Added "${product}" directly to live Pharmarack cart!`, 'success');
      
      // Reset form and keep open
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
      setSelectedMedicineName('');
      
      // Focus back to search input so user can add another medicine
      setTimeout(() => {
        productInputRef.current?.focus();
      }, 100);
      
      // Refresh any active cart indicators in the header/sidebar
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
    } catch (cartErr: any) {
      console.error('Failed to add live cart item:', cartErr);
      const detailedError = cartErr?.response?.data?.details || cartErr?.response?.data?.error || cartErr?.message || 'Unknown error';
      toastEvent.trigger(`Live addition failed: ${detailedError}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalProducts = cartDistributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = cartDistributors.reduce((s, d) => s + d.items.reduce((q, i) => q + i.qty, 0), 0);
  const totalAmount = cartDistributors.reduce((s, d) => s + d.items.reduce((a, i) => a + i.amount, 0), 0);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
      {/* ponytail: fix height to h-[85vh] to prevent modal size from jumping when cart preview loads */}
      <div className="glass-panel max-w-5xl lg:max-w-6xl xl:max-w-7xl w-full h-[85vh] max-h-[85vh] p-5 md:p-6 relative border border-glass-border shadow-[0_0_60px_rgba(59,130,246,0.25)] bg-bg2 text-text animate-in fade-in zoom-in-95 duration-200 flex flex-col">
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-all"
          title="Close Modal (Esc)"
        >
          <X size={18} />
        </button>

        {/* Refresh Button */}
        <button 
          type="button"
          onClick={fetchCart}
          disabled={cartLoading}
          className="absolute top-4 right-4 md:right-[33.33%] md:mr-2.5 p-1.5 text-muted hover:text-text rounded-lg hover:bg-bg3 transition-all flex items-center justify-center disabled:opacity-50"
          title="Refresh Cart"
        >
          <RefreshCw size={14} className={cartLoading ? 'animate-spin text-emerald-400' : ''} />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-glass-border/30 flex-1 overflow-hidden">
          
          {/* Left Column: Unified Pending Table */}
          <div className="flex flex-col h-full overflow-hidden pr-2">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 shrink-0 border-b border-glass-border/30">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Pending ({pendingOrders.length + pendingRefills.length + reconOrders.length})
              </span>
              <div className="flex gap-1.5 text-[9px] font-bold uppercase">
                <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red border border-red-500/20">{pendingOrders.length} Ord</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">{pendingRefills.length} Refill</span>
                <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">{reconOrders.length} Recon</span>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto scrollbar-thin mt-1">
              {(pendingOrders.length + pendingRefills.length + reconOrders.length) === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                  <Clock size={28} className="opacity-20 mb-2" />
                  <p className="text-xs font-bold">All Clear</p>
                  <p className="text-[11px] max-w-[180px] mx-auto mt-0.5">No pending orders, refills, or unreconciled items.</p>
                </div>
              ) : (
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="text-muted border-b border-glass-border/20">
                      <th className="text-left py-1.5 px-1 font-semibold w-12">Type</th>
                      <th className="text-left py-1.5 px-1 font-semibold">Product / Detail</th>
                      <th className="text-right py-1.5 px-1 font-semibold w-8">Qty</th>
                      <th className="text-right py-1.5 px-1 font-semibold w-10">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-glass-border/10">

                    {/* Orders */}
                    {pendingOrders.map(order => {
                      const inCart = getOrderItemInCart(order);
                      const isPickingForOrder = distributorPickerOrderId === order.id;
                      const pickerMinRate = isPickingForOrder && distributorPickerResults.length > 0
                        ? Math.min(...distributorPickerResults.filter(d => d.rate).map(d => getEffectiveRate(d.rate!, d.scheme, order.qty)))
                        : Infinity;
                      return (
                        <React.Fragment key={`order-${order.id}`}>
                          <tr className={`transition-colors ${
                            inCart ? 'bg-emerald-500/5' : isPickingForOrder ? 'bg-blue-500/5' : 'hover:bg-bg3/40'
                          }`}>
                            <td className="py-2 px-1">
                              <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red border border-red-500/20">Ord</span>
                            </td>
                            <td className="py-2 px-1 min-w-0">
                              <div className={`font-semibold truncate max-w-[130px] ${inCart ? 'line-through opacity-50 text-emerald-400' : 'text-text'}`} title={order.product}>
                                {order.product}
                              </div>
                              <div className="text-muted truncate max-w-[130px]">{order.requester}</div>
                            </td>
                            <td className="py-2 px-1 text-right text-muted font-mono">{order.qty}</td>
                            <td className="py-2 px-1 text-right">
                              {inCart ? (
                                <span className="text-[8px] font-bold text-emerald-400">âœ“</span>
                              ) : isPickingForOrder ? (
                                <button type="button" onClick={() => { setDistributorPickerOrderId(null); setDistributorPickerResults([]); }}
                                  className="text-[9px] text-muted hover:text-text transition-colors">âœ•</button>
                              ) : (
                                <button type="button"
                                  onClick={() => handleSearchDistributorsForOrder(order)}
                                  disabled={addingOrderId === order.id || distributorPickerLoading}
                                  className="text-[9px] font-bold text-red hover:text-red/80 disabled:opacity-40 transition-colors">
                                  {addingOrderId === order.id ? 'â€¦' : 'Add'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {/* Distributor Picker Row */}
                          {isPickingForOrder && (
                            <tr>
                              <td colSpan={4} className="pb-2 px-1">
                                <div className="animate-in fade-in slide-in-from-top-1 duration-200 bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 space-y-1">
                                  {distributorPickerLoading ? (
                                    <div className="flex items-center gap-1.5 text-[10px] text-muted py-1">
                                      <Loader2 size={10} className="animate-spin text-primary" />
                                      Searching distributorsâ€¦
                                    </div>
                                  ) : distributorPickerResults.length === 0 ? (
                                    <p className="text-[10px] text-muted py-1">No distributors found.</p>
                                  ) : distributorPickerResults.map((dist, idx) => {
                                    const effRate = dist.rate ? getEffectiveRate(dist.rate, dist.scheme, order.qty) : null;
                                    const isBest = effRate !== null && Math.abs(effRate - pickerMinRate) < 0.01;
                                    return (
                                      <button key={idx} type="button"
                                        onClick={() => handleConfirmOrderDistributor(order, dist)}
                                        disabled={addingOrderId === order.id}
                                        className="w-full text-left px-2 py-1.5 rounded-lg bg-bg3/50 hover:bg-primary/10 border border-border hover:border-primary/40 transition-all flex items-center justify-between gap-2 group disabled:opacity-50">
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-1">
                                            <span className="text-[10px] font-semibold text-text truncate group-hover:text-primary">{dist.distributor || 'Unknown'}</span>
                                            {isBest && <span className="text-[7px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 rounded font-bold"><Sparkles size={6} className="inline" /> Best</span>}
                                            {dist.stock && <span className={`text-[7px] px-1 rounded font-bold ${getStockStyle(dist.stock)}`}>{dist.stock}</span>}
                                          </div>
                                          {dist.scheme && <span className="text-[9px] text-amber-400">{dist.scheme}</span>}
                                        </div>
                                        {dist.rate != null && <span className="text-[11px] font-bold text-emerald-400 font-mono shrink-0">â‚¹{dist.rate}</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Refills */}
                    {pendingRefills.map(refill => {
                      const inCart = getRefillItemInCart(refill);
                      const isPickingForRefill = distributorPickerRefillId === refill.id;
                      const pickerMinRateRefill = isPickingForRefill && distributorPickerResults.length > 0
                        ? Math.min(...distributorPickerResults.filter(d => d.rate).map(d => getEffectiveRate(d.rate!, d.scheme, 1)))
                        : Infinity;
                      return (
                        <React.Fragment key={`refill-${refill.id}`}>
                          <tr className={`transition-colors ${
                            inCart ? 'bg-emerald-500/5' : isPickingForRefill ? 'bg-blue-500/5' : 'hover:bg-bg3/40'
                          }`}>
                            <td className="py-2 px-1">
                              <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Refill</span>
                            </td>
                            <td className="py-2 px-1 min-w-0">
                              <div className={`font-semibold truncate max-w-[130px] ${inCart ? 'line-through opacity-50 text-emerald-400' : 'text-text'}`} title={refill.medicine_name}>
                                {refill.medicine_name}
                              </div>
                              <div className="text-muted truncate max-w-[130px]">{refill.patient_name}</div>
                            </td>
                            <td className="py-2 px-1 text-right text-muted font-mono">1</td>
                            <td className="py-2 px-1 text-right">
                              {inCart ? (
                                <span className="text-[8px] font-bold text-emerald-400">âœ“</span>
                              ) : isPickingForRefill ? (
                                <button type="button" onClick={() => { setDistributorPickerRefillId(null); setDistributorPickerResults([]); }}
                                  className="text-[9px] text-muted hover:text-text transition-colors">âœ•</button>
                              ) : (
                                <button type="button"
                                  onClick={() => handleSearchDistributorsForRefill(refill)}
                                  disabled={addingRefillId === refill.id || distributorPickerLoading}
                                  className="text-[9px] font-bold text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors">
                                  {addingRefillId === refill.id ? 'â€¦' : 'Add'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {/* Distributor Picker Row */}
                          {isPickingForRefill && (
                            <tr>
                              <td colSpan={4} className="pb-2 px-1">
                                <div className="animate-in fade-in slide-in-from-top-1 duration-200 bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 space-y-1">
                                  {distributorPickerLoading ? (
                                    <div className="flex items-center gap-1.5 text-[10px] text-muted py-1">
                                      <Loader2 size={10} className="animate-spin text-primary" />
                                      Searching distributorsâ€¦
                                    </div>
                                  ) : distributorPickerResults.length === 0 ? (
                                    <p className="text-[10px] text-muted py-1">No distributors found.</p>
                                  ) : distributorPickerResults.map((dist, idx) => {
                                    const effRate = dist.rate ? getEffectiveRate(dist.rate, dist.scheme, 1) : null;
                                    const isBest = effRate !== null && Math.abs(effRate - pickerMinRateRefill) < 0.01;
                                    return (
                                      <button key={idx} type="button"
                                        onClick={() => handleConfirmRefillDistributor(refill, dist)}
                                        disabled={addingRefillId === refill.id}
                                        className="w-full text-left px-2 py-1.5 rounded-lg bg-bg3/50 hover:bg-primary/10 border border-border hover:border-primary/40 transition-all flex items-center justify-between gap-2 group disabled:opacity-50">
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-1">
                                            <span className="text-[10px] font-semibold text-text truncate group-hover:text-primary">{dist.distributor || 'Unknown'}</span>
                                            {isBest && <span className="text-[7px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 rounded font-bold"><Sparkles size={6} className="inline" /> Best</span>}
                                            {dist.stock && <span className={`text-[7px] px-1 rounded font-bold ${getStockStyle(dist.stock)}`}>{dist.stock}</span>}
                                          </div>
                                          {dist.scheme && <span className="text-[9px] text-amber-400">{dist.scheme}</span>}
                                        </div>
                                        {dist.rate != null && <span className="text-[11px] font-bold text-emerald-400 font-mono shrink-0">â‚¹{dist.rate}</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Reconcile Orders */}
                    {reconOrders.map((recon, idx) => (
                      <tr key={`recon-${recon.email_uid || idx}`} className="hover:bg-bg3/40 transition-colors">
                        <td className="py-2 px-1">
                          <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Recon</span>
                        </td>
                        <td className="py-2 px-1 min-w-0">
                          <div className="font-semibold truncate max-w-[130px] text-text" title={recon.extracted_distributor}>
                            {recon.extracted_distributor || 'Unknown Dist.'}
                          </div>
                          <div className="text-muted truncate max-w-[130px]">
                            {recon.medicine_names?.slice(0, 2).join(', ') || recon.subject || 'â€”'}
                            {recon.medicine_names?.length > 2 && ` +${recon.medicine_names.length - 2}`}
                          </div>
                        </td>
                        <td className="py-2 px-1 text-right text-muted font-mono">â€”</td>
                        <td className="py-2 px-1 text-right">
                          <span className="text-[8px] font-bold uppercase text-purple-400">Missing</span>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              )}
            </div>
          </div>


          {/* Middle Column: Form */}
          <div className="flex flex-col h-full justify-between md:pl-6 overflow-y-auto pr-2">
            <div className="space-y-4">
              {/* Title */}
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/10 rounded-xl text-primary border border-primary/20 shadow-sm">
                  <ShoppingCart size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                    Add to Live Cart
                    <span className="text-[10px] bg-bg3 border border-border text-muted px-1.5 py-0.5 rounded font-mono">Alt + L</span>
                    {prMode !== 'Unknown' && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border leading-none bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        â— LIVE
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-muted">Direct live stock addition for inventory replenishment</p>
                </div>
              </div>

              {/* Form Body */}
              <form id="live-cart-add-form" onSubmit={handleSubmit} className="space-y-4">
                
                {/* Autocomplete Search Input */}
                <div className="relative animate-in fade-in duration-200" ref={autocompleteRef}>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">Medicine Search</label>
                  <div className="relative">
                    <span className="absolute left-3 top-[11.5px] text-muted">
                      {searchLoading ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} />}
                    </span>
                    <input
                      ref={productInputRef}
                      type="text"
                      value={product}
                      onChange={(e) => handleProductChange(e.target.value)}
                      onKeyDown={handleProductKeyDown}
                      className="w-full premium-input pl-9 pr-4 py-2 text-sm font-medium"
                      placeholder="Search Pharmarack catalog..."
                      autoComplete="off"
                    />
                  </div>
                  
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute z-[999999] left-0 right-0 mt-1 max-h-[400px] overflow-y-auto bg-bg2 border border-glass-border backdrop-blur-2xl rounded-xl shadow-2xl divide-y divide-border/30 py-1 scrollbar-thin">
                      {suggestions.map((med, index) => (
                        <li
                          key={index}
                          onClick={() => selectSuggestion(med)}
                          className={`px-4 py-2 text-sm cursor-pointer flex justify-between items-center transition-all ${
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
                              {med.rate !== undefined && med.rate !== null && !med.isErrorMessage && getEffectiveRate(med.rate, med.scheme, qty) === minEffectiveRate && (
                                <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-0.5 shrink-0 select-none">
                                  <Sparkles size={8} className="text-emerald-400 animate-pulse" /> Best Rate
                                </span>
                              )}
                              {med.stock !== undefined && !med.isErrorMessage && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${getStockStyle(med.stock)}`}>
                                  {med.stock} Stock
                                </span>
                              )}
                              {med.scheme && !med.isErrorMessage && (
                                <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold uppercase">
                                  {med.scheme}
                                </span>
                              )}
                            </div>
                            {!med.isErrorMessage && (
                              <span className="text-[11px] text-muted block truncate mt-0.5">
                                {med.distributor ? (
                                  <>
                                    <span className={med.mapped ? 'text-text font-medium' : 'text-purple-400 font-medium'}>
                                      {med.distributor}
                                    </span>
                                    <span> ({med.mapped ? 'Mapped' : 'Non-mapped'})</span>
                                  </>
                                ) : (
                                  'No Distributor'
                                )}
                                {med.packaging ? ` â€¢ ${med.packaging}` : ''}
                              </span>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0 flex flex-col justify-center items-end">
                            {!med.isErrorMessage && (
                              <div className="text-xs font-mono font-bold text-text flex flex-col items-end">
                                {med.rate !== undefined && med.rate !== null ? (
                                  <span className="text-emerald-400">PTR: â‚¹{med.rate}</span>
                                ) : null}
                                {med.mrp !== undefined && med.mrp !== null ? (
                                  <span className="text-muted text-[10px]">MRP: â‚¹{med.mrp}</span>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Selected Pharmarack preview */}
                {selectedDistributor && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-text flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="truncate pr-2">
                      <div className="font-bold text-emerald-400 text-[9px] uppercase tracking-wider mb-1">Pharmarack Distributor Link</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-text font-semibold truncate text-xs">{selectedDistributor}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          selectedMapped 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {selectedMapped ? 'Mapped' : 'Non-mapped'}
                        </span>
                        {selectedScheme && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase">
                            {selectedScheme}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="font-mono font-bold whitespace-nowrap flex flex-col items-end gap-0.5 text-right shrink-0">
                        {selectedRate !== '' && <span className="text-emerald-400 text-sm">PTR: â‚¹{selectedRate}</span>}
                        {selectedMrp !== '' && <span className="text-muted text-[10px]">MRP: â‚¹{selectedMrp}</span>}
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
                          setSelectedMedicineName('');
                          setTimeout(() => productInputRef.current?.focus(), 50);
                        }}
                        className="p-1.5 text-muted hover:text-red hover:bg-red-500/10 rounded-xl transition-all ml-2"
                        title="Cancel distributor selection"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Cheaper distributor suggestion banner */}
                {cheaperDistributor && (
                  <button
                    type="button"
                    onClick={handleSwitchToCheaper}
                    className="w-full text-left p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-text flex items-center justify-between shadow-sm hover:bg-amber-500/15 transition-all select-none animate-in fade-in slide-in-from-top-2 duration-200"
                  >
                    <div className="pr-2.5 min-w-0 flex-1">
                      <div className="font-bold text-amber-400 flex items-center gap-1 uppercase tracking-wider text-[10px] mb-1">
                        <Sparkles size={12} />
                        <span>Cheaper Distributor Offer Available!</span>
                      </div>
                      <div className="text-text/90 leading-relaxed text-[11px]">
                        <span className="font-bold">{cheaperDistributor.distributor}</span> has this for an effective PTR of <span className="font-black text-emerald-400">â‚¹{cheaperDistributor.effectiveRate.toFixed(2)}</span>
                        {cheaperDistributor.scheme && ` (${cheaperDistributor.scheme} scheme)`}.
                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-amber-400 bg-amber-500/20 px-2 py-1 rounded-lg shrink-0 uppercase tracking-wider">
                      Switch
                    </div>
                  </button>
                )}

                {/* Quantity Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">Quantity</label>
                  <div className="flex items-center justify-between bg-bg3 border border-border rounded-xl h-9 px-1.5 max-w-[150px]">
                    <button
                      type="button"
                      onClick={() => setQty(prev => Math.max(1, prev - 1))}
                      className="w-7.5 h-7.5 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      ref={qtyInputRef}
                      type="number"
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-transparent text-center text-sm font-bold outline-none text-text focus:ring-0 border-0 p-0"
                      min="1"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setQty(prev => prev + 1)}
                      className="w-7.5 h-7.5 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Action Row */}
            <div className="pt-4 border-t border-glass-border flex justify-end gap-3 mt-4 flex-row flex-nowrap shrink-0 whitespace-nowrap">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-bg3 border border-border text-muted hover:text-text text-xs font-bold rounded-xl transition-all shrink-0 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="live-cart-add-form"
                disabled={isSubmitting || !selectedProductId}
                className="px-5 py-2 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] flex items-center gap-1.5 shrink-0 whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Adding...
                  </>
                ) : (
                  <>
                    <ShoppingCart size={14} /> Add to Cart Live
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Mini Cart Preview */}
          {/* ponytail: show simple mini-cart preview side-by-side */}
          <div className="md:pl-6 pt-4 md:pt-0 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-glass-border/30 shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-emerald-400" />
                <h4 className="text-xs font-bold text-text uppercase tracking-wider">Cart Preview</h4>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 py-3 space-y-3 scrollbar-thin">
              {cartLoading && cartDistributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                  <Loader2 size={24} className="animate-spin text-emerald-400" />
                  <span className="text-xs text-muted font-mono">Loading cart...</span>
                </div>
              ) : cartError ? (
                <div className="text-center py-4 text-xs text-red/80 bg-red-500/5 rounded-xl border border-red-500/10 p-3">
                  <p className="font-semibold">Failed to load cart</p>
                  <p className="text-[10px] opacity-70 mt-1">{cartError}</p>
                </div>
              ) : cartDistributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center text-muted">
                  <ShoppingCart size={28} className="opacity-20 mb-2" />
                  <p className="text-xs font-bold">Cart is empty</p>
                  <p className="text-[11px] max-w-[180px] mx-auto mt-0.5">Add items using the search form on the left.</p>
                </div>
              ) : (
                cartDistributors.map((dist) => (
                  <div key={dist.storeId} className="bg-bg3/30 border border-glass-border/30 rounded-xl overflow-hidden p-2.5 space-y-2 hover:border-glass-border/60 transition-all">
                    {/* Distributor Header */}
                    <div className="flex items-center justify-between border-b border-glass-border/20 pb-1.5">
                      <span className="text-[11px] font-bold text-sky uppercase tracking-wide truncate max-w-[160px]" title={dist.storeName}>
                        {dist.storeName}
                      </span>
                      <span className="text-[9px] font-bold text-muted bg-bg3/50 px-1.5 py-0.5 rounded-full border border-glass-border/20">
                        {dist.items.length} item{dist.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Distributor Items */}
                    <div className="space-y-1.5">
                      {dist.items.map((item, idx) => (
                        <div key={`${item.productCode}-${idx}`} className="flex justify-between items-start text-[11px] gap-2.5 hover:bg-bg3/40 p-1 rounded transition-colors">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-text block truncate" title={item.productName}>
                              {item.productName}
                            </span>
                            <span className="text-[9px] text-muted flex items-center gap-1 mt-0.5">
                              {item.packaging && <span className="font-mono">{item.packaging}</span>}
                              {item.scheme && (
                                <span className="text-emerald-400 font-bold uppercase text-[8px] bg-emerald-500/10 px-1 rounded">
                                  {item.scheme}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end">
                            <span className="font-bold text-text">Qty: {item.qty}</span>
                            {item.ptr > 0 && <span className="text-[9px] text-muted font-mono mt-0.5">â‚¹{(item.ptr * item.qty).toFixed(2)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Subtotal */}
                    {dist.lineTotal > 0 && (
                      <div className="flex justify-between items-center pt-1.5 border-t border-glass-border/15 text-[11px]">
                        <span className="text-muted uppercase tracking-wider font-bold">Subtotal</span>
                        <span className="font-bold text-emerald-400 font-mono">â‚¹{dist.lineTotal.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Cart Preview Footer Summary */}
            {cartDistributors.length > 0 && (
              <div className="mt-auto pt-3 border-t border-glass-border/30 bg-bg2/40 rounded-xl p-2.5 space-y-1.5 shrink-0">
                <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Items</span>
                    <span className="font-bold text-text font-mono">{totalProducts}</span>
                  </div>
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Total Qty</span>
                    <span className="font-bold text-text font-mono">{totalQty}</span>
                  </div>
                  <div>
                    <span className="text-muted block uppercase text-[8px] tracking-wider mb-0.5">Est. Total</span>
                    <span className="font-bold text-emerald-400 font-mono text-xs">â‚¹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer info hints */}
        <div className="mt-4 pt-3 border-t border-glass-border flex justify-between text-[9px] text-muted/60 font-semibold font-mono">
          <span>[Esc] Close</span>
          <span>[Alt + L] Toggle modal</span>
          <span>[Enter] Add to Cart</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
