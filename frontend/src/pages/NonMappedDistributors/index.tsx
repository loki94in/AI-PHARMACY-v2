import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Search, 
  Plus, 
  Minus, 
  Loader2, 
  ShoppingCart, 
  Package, 
  Phone, 
  Mail, 
  User, 
  MapPin, 
  AlertCircle, 
  Info
} from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

interface Distributor {
  storeId: number;
  storeName: string;
  isMapped: boolean;
  partyCode: string;
  address: string;
  city: string;
  mobileNumber: string;
  email: string;
  contactPerson: string;
  remarks: string;
}

interface ProductResult {
  name: string;
  company: string;
  packaging: string;
  rate: number | null;
  mrp: number | null;
  mapped: boolean;
  stock: string;
  scheme: string;
  productId: string | number;
  productCode: string;
  storeId: number;
}

// Module-level cache for instant re-mount (especially valuable since this hits Pharmarack external API)
let cachedDistributors: Distributor[] | null = null;

export default function NonMappedDistributors() {
  const [distributors, setDistributors] = useState<Distributor[]>(cachedDistributors || []);
  const [loadingDistributors, setLoadingDistributors] = useState(!cachedDistributors);
  const [distError, setDistError] = useState<string | null>(null);
  
  // Left pane filter
  const [sidebarSearch, setSidebarSearch] = useState('');
  
  // Selected distributor details
  const [selectedDist, setSelectedDist] = useState<Distributor | null>(null);
  
  // Product Search state
  const [productQuery, setProductQuery] = useState('');
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [searchDone, setSearchDone] = useState(false);

  // Cart addition quantities per product code
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addingToCart, setAddingToCart] = useState<Record<string, boolean>>({});
  const [addErrors, setAddErrors] = useState<Record<string, string | null>>({});
  // refs to hold debounce timers and controllers per product
  const saveRefs = React.useRef<Record<string, { timer?: number; controller?: AbortController; lastSavedQty?: number }>>({});


  useEffect(() => {
    const fetchDistributors = async () => {
      setLoadingDistributors(true);
      setDistError(null);
      try {
        const res = await api.getPharmarackDistributors();
        if (res && res.success) {
          // We want the non-mapped distributors for this page
          const nonMapped = res.nonMapped || [];
          cachedDistributors = nonMapped;
          setDistributors(nonMapped);
        } else {
          setDistError('Failed to fetch distributor list.');
        }
      } catch (err: any) {
        console.error('Error fetching distributors:', err);
        setDistError(err?.response?.data?.error || 'Failed to fetch distributors. Verify session.');
      } finally {
        setLoadingDistributors(false);
      }
    };
    fetchDistributors();
  }, []);

  const filteredDistributors = distributors.filter(d => 
    d.storeName.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
    (d.city && d.city.toLowerCase().includes(sidebarSearch.toLowerCase())) ||
    (d.partyCode && d.partyCode.toLowerCase().includes(sidebarSearch.toLowerCase()))
  );

  const handleSelectDistributor = (dist: Distributor) => {
    setSelectedDist(dist);
    setProducts([]);
    setProductQuery('');
    setSearchDone(false);
  };

  const handleProductSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDist || productQuery.trim().length < 3) {
      toastEvent.trigger('Please enter at least 3 characters to search.', 'info');
      return;
    }

    setSearchingProducts(true);
    try {
      const data = await api.searchPharmarack(productQuery, selectedDist.storeId, false);
      if (Array.isArray(data)) {
        setProducts(data);
      } else {
        setProducts([]);
      }
      setSearchDone(true);
    } catch (err: any) {
      console.error('Error searching products:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to fetch product list.', 'error');
    } finally {
      setSearchingProducts(false);
    }
  };

  const updateQuantity = (productCode: string, delta: number) => {
    setQuantities(prev => {
      const current = prev[productCode] || 1;
      const next = Math.max(1, current + delta);

      // start debounce auto-commit for this product
      scheduleAutoCommit(productCode, next);

      return {
        ...prev,
        [productCode]: next
      };
    });
  };

  const scheduleAutoCommit = (productCode: string, qty: number) => {
    const ref = saveRefs.current[productCode] || {};
    if (ref.timer) window.clearTimeout(ref.timer);
    // cancel pending controller (if any) as user changed qty
    if (ref.controller) {
      try { ref.controller.abort(); } catch {};
      ref.controller = undefined;
    }
    // set a new debounce to emit an auto-commit event after 700ms
    const timer = window.setTimeout(() => {
      autoCommitQuantity(productCode, qty);
    }, 700);
    saveRefs.current[productCode] = { ...ref, timer };
  };

  const autoCommitQuantity = (productCode: string, qty: number) => {
    // store lastSavedQty to avoid duplicate auto-commits
    const ref = saveRefs.current[productCode] || {};
    if (ref.lastSavedQty === qty) return;
    ref.lastSavedQty = qty;
    saveRefs.current[productCode] = ref;

    // Emit a local event to inform other components that qty changed and is stable
    window.dispatchEvent(new CustomEvent('pharmarack-qty-changed', { detail: { productCode, qty } }));
  };


  const handleAddToCart = async (prod: ProductResult) => {
    const qty = quantities[prod.productCode] || 1;
    const key = prod.productCode;

    // cancel any pending add for this product
    const prevRef = saveRefs.current[key];
    if (prevRef && prevRef.controller) {
      try { prevRef.controller.abort(); } catch {};
      prevRef.controller = undefined;
    }

    setAddErrors(prev => ({ ...prev, [key]: null }));
    setAddingToCart(prev => ({ ...prev, [key]: true }));

    const controller = new AbortController();
    saveRefs.current[key] = { ...(saveRefs.current[key] || {}), controller };

    try {
      await api.addPharmarackCart([{
        productId: prod.productId,
        storeId: prod.storeId,
        qty,
        rate: prod.rate || undefined,
        scheme: prod.scheme || undefined,
        productCode: prod.productCode,
        company: prod.company,
        productName: prod.name,
        storeName: selectedDist?.storeName || '',
        packaging: prod.packaging,
        mapped: false
      }]);

      toastEvent.trigger(`Added "${prod.name}" to cart from ${selectedDist?.storeName || 'distributor'}!`, 'success');
      
      // Reset quantity locally
      setQuantities(prev => ({ ...prev, [key]: 1 }));
      
      // Emit cart refresh event to notify other page components
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));

    } catch (err: any) {
      if (err.name === 'AbortError') {
        // request was cancelled; do not show an error
        console.info('Add to cart aborted for', key);
      } else {
        console.error('Error adding to live cart:', err);
        const detailed = err?.response?.data?.details || err?.response?.data?.error || err?.message || 'Unknown error';
        setAddErrors(prev => ({ ...prev, [key]: String(detailed) }));
        toastEvent.trigger(`Addition failed: ${detailed}`, 'error');
      }
    } finally {
      setAddingToCart(prev => ({ ...prev, [key]: false }));
      // clear controller
      if (saveRefs.current[key]) saveRefs.current[key].controller = undefined;
    }
  };

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
      if (num >= 50) return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      if (num >= 15) return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      return 'bg-red-500/10 text-red border border-red-500/20';
    }
    return 'bg-bg3 text-muted border border-border';
  };

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-bg text-text">
      {/* ── Left Sidebar: Distributors List ── */}
      <div className="w-80 border-r border-glass-border flex flex-col h-full bg-glass-bg/5 shrink-0">
        <div className="p-4 border-b border-glass-border">
          <h3 className="text-xs font-bold tracking-wider uppercase text-text flex items-center gap-2 mb-3">
            <Building2 size={14} className="text-primary" />
            Non-Mapped Distributors
          </h3>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-muted">
              <Search size={14} />
            </span>
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Filter by name or city..."
              className="w-full premium-input pl-9 pr-4 py-2 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-glass-border/30">
          {loadingDistributors ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 size={24} className="animate-spin text-primary" />
              <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Loading Stores...</span>
            </div>
          ) : distError ? (
            <div className="p-4 text-center">
              <AlertCircle size={20} className="mx-auto text-red mb-1.5" />
              <p className="text-xs font-bold text-text">Error loading stores</p>
              <p className="text-[10px] text-muted mt-1 leading-normal">{distError}</p>
            </div>
          ) : filteredDistributors.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted">
              No matching distributors found
            </div>
          ) : (
            filteredDistributors.map((dist) => (
              <button
                key={dist.storeId}
                onClick={() => handleSelectDistributor(dist)}
                className={`w-full text-left p-4 hover:bg-bg2/40 transition-all flex flex-col gap-1 border-l-2 ${
                  selectedDist?.storeId === dist.storeId 
                    ? 'bg-bg2/60 border-primary border-l-2' 
                    : 'border-transparent'
                }`}
              >
                <span className="font-bold text-text text-xs leading-snug line-clamp-2">
                  {dist.storeName}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {dist.partyCode && (
                    <span className="text-[9px] bg-bg3/60 px-1.5 py-0.5 rounded border border-border/30 text-muted font-mono">
                      Code: {dist.partyCode}
                    </span>
                  )}
                  {dist.city && (
                    <span className="text-[9px] text-sky font-semibold">
                      {dist.city}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right Content Pane ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {selectedDist ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            
            {/* Distributor Profile Panel */}
            <div className="p-6 border-b border-glass-border shrink-0 bg-glass-bg/10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-text tracking-wide uppercase flex items-center gap-2">
                    {selectedDist.storeName}
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-500 border-amber-500/20">
                      Non-Mapped
                    </span>
                  </h3>
                  {selectedDist.address && (
                    <p className="text-xs text-muted mt-1.5 flex items-start gap-1 max-w-2xl">
                      <MapPin size={13} className="shrink-0 text-muted/80 mt-0.5" />
                      <span>{selectedDist.address} {selectedDist.city ? `, ${selectedDist.city}` : ''}</span>
                    </p>
                  )}
                </div>

                {/* Profile Grid Cards */}
                <div className="grid grid-cols-2 gap-3 min-w-[280px]">
                  <div className="bg-bg2/40 border border-glass-border px-3 py-1.5 rounded-xl">
                    <span className="text-[8px] text-muted font-bold uppercase tracking-wider block">Contact Person</span>
                    <span className="text-xs font-semibold text-text truncate block mt-0.5">
                      {selectedDist.contactPerson || 'Not provided'}
                    </span>
                  </div>
                  <div className="bg-bg2/40 border border-glass-border px-3 py-1.5 rounded-xl">
                    <span className="text-[8px] text-muted font-bold uppercase tracking-wider block">Mobile / Phone</span>
                    <span className="text-xs font-semibold text-text truncate block mt-0.5 flex items-center gap-1">
                      <Phone size={10} className="text-muted" />
                      {selectedDist.mobileNumber || 'Not provided'}
                    </span>
                  </div>
                </div>
              </div>
              
              {selectedDist.remarks && (
                <div className="mt-3 p-2.5 rounded-xl bg-bg3/40 border border-glass-border/30 text-[10px] text-muted flex items-start gap-1.5">
                  <Info size={12} className="shrink-0 text-primary mt-0.5" />
                  <span><strong>Store Remarks:</strong> {selectedDist.remarks}</span>
                </div>
              )}
            </div>

            {/* Product Searching Console */}
            <div className="p-6 border-b border-glass-border/50 bg-bg2/10 shrink-0">
              <form onSubmit={handleProductSearch} className="flex gap-2 max-w-xl">
                <input
                  type="text"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Enter drug/brand name (e.g. Paracetamol, Dolo)..."
                  className="flex-1 premium-input px-4 py-2.5 text-xs font-semibold"
                />
                <button
                  type="submit"
                  disabled={searchingProducts || productQuery.trim().length < 3}
                  className="premium-btn bg-primary text-text px-5 hover:bg-primary/80 disabled:opacity-50 text-xs font-bold flex items-center gap-1.5"
                >
                  {searchingProducts ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  <span>Search Catalog</span>
                </button>
              </form>
            </div>

            {/* Products Listing Area */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              {searchingProducts ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                  <p className="text-xs text-muted font-bold uppercase tracking-wider animate-pulse">
                    Querying distributor catalog…
                  </p>
                </div>
              ) : products.length > 0 ? (
                <div className="bg-bg2/20 border border-glass-border rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-glass-border/30 text-muted font-bold uppercase tracking-wider text-[10px] bg-bg3/30">
                          <th className="text-left px-4 py-3">Product Name</th>
                          <th className="text-left px-3 py-3">Company</th>
                          <th className="text-center px-3 py-3">Pack</th>
                          <th className="text-right px-3 py-3">PTR</th>
                          <th className="text-right px-3 py-3">MRP</th>
                          <th className="text-center px-3 py-3">Stock</th>
                          <th className="text-center px-3 py-3">Scheme</th>
                          <th className="text-center px-4 py-3 w-[150px]">Quantity</th>
                          <th className="text-center px-4 py-3 w-[120px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-glass-border/15">
                        {products.map((prod) => {
                          const qty = quantities[prod.productCode] || 1;
                          const adding = addingToCart[prod.productCode] || false;
                          
                          return (
                            <tr key={prod.productCode} className="hover:bg-bg3/10 transition-colors">
                              <td className="px-4 py-3">
                                <span className="font-bold text-text text-[11px] block">{prod.name}</span>
                              </td>
                              <td className="px-3 py-3 text-muted text-[10px] max-w-[150px] truncate">
                                {prod.company || '—'}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {prod.packaging && (
                                  <span className="text-[9px] text-muted bg-bg3/50 px-1.5 py-0.5 rounded border border-glass-border/40 font-mono">
                                    {prod.packaging}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-emerald-400 font-bold text-[11px]">
                                {prod.rate ? `₹${prod.rate.toFixed(2)}` : '—'}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-muted text-[11px]">
                                {prod.mrp ? `₹${prod.mrp.toFixed(2)}` : '—'}
                              </td>
                              <td className="px-3 py-3 text-center font-mono text-[10px]">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${getStockStyle(prod.stock)}`}>
                                  {prod.stock}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                {prod.scheme ? (
                                  <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                    {prod.scheme}
                                  </span>
                                ) : (
                                  <span className="text-muted/40">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-between bg-bg3/50 border border-glass-border/40 rounded-xl h-8 px-1 mx-auto max-w-[110px]">
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(prod.productCode, -1)}
                                    className="w-6 h-6 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                                  >
                                    <Minus size={11} />
                                  </button>
                                  <input
                                    aria-label={`Quantity for ${prod.name}`}
                                    className="w-10 text-center text-[11px] font-extrabold font-mono bg-transparent outline-none"
                                    value={String(qty)}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
                                      setQuantities(prev => ({ ...prev, [prod.productCode]: isNaN(val) ? 1 : Math.max(1, val) }));
                                    }}
                                    onBlur={() => {
                                      // ensure quantity is at least 1 on blur
                                      setQuantities(prev => ({ ...prev, [prod.productCode]: Math.max(1, prev[prod.productCode] || 1) }));
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateQuantity(prod.productCode, 1)}
                                    className="w-6 h-6 rounded-lg hover:bg-bg2 active:scale-90 text-muted hover:text-text transition-all flex items-center justify-center"
                                  >
                                    <Plus size={11} />
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex flex-col gap-1">
                                  {prod.rate ? (
                                    <div className="text-[11px] text-muted font-mono">Subtotal: ₹{(qty * (prod.rate || 0)).toFixed(2)}</div>
                                  ) : null}
                                  <button
                                    onClick={() => handleAddToCart(prod)}
                                    disabled={adding}
                                    className="w-full h-8 premium-btn bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-[10px] uppercase flex items-center justify-center gap-1 rounded-xl transition-all active:scale-95"
                                  >
                                    {adding ? (
                                      <Loader2 size={11} className="animate-spin" />
                                    ) : (
                                      <ShoppingCart size={11} />
                                    )}
                                    <span>Add</span>
                                  </button>
                                  {addErrors[prod.productCode] ? (
                                    <div className="text-[11px] text-red mt-1">{addErrors[prod.productCode]}</div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : searchDone ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center text-xs text-muted">
                  <Package size={36} className="text-muted/30 mb-1" />
                  <p className="font-bold text-text">No matching products found</p>
                  <p className="mt-1">Try searching with a different chemical name or trademark.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-center text-xs text-muted">
                  <Package size={40} className="text-muted/20 mb-1" />
                  <p className="font-bold text-text">Distributor Catalog Browser</p>
                  <p className="mt-1">Enter a query in the search bar above to fetch medicines sold by this distributor.</p>
                </div>
              )}
            </div>

          </div>
        ) : (
          /* Empty Details State */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
            <Building2 size={48} className="text-muted/20" />
            <div>
              <p className="text-sm font-bold text-text">Select a distributor</p>
              <p className="text-xs text-muted mt-1">Choose a non-mapped distributor from the left list to browse its details and catalog.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
