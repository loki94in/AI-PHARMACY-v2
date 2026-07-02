import React, { useState, useEffect } from 'react';
import { RefreshCw, ExternalLink, ShoppingCart, Package, AlertCircle, Truck, Clock, Send } from 'lucide-react';
import { api, type SpecialOrder, type Refill } from '../../services/api';
import { toastEvent } from '../../services/events';

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

export default function PharmarackCart() {
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
    <div className="flex-1 flex flex-col overflow-hidden bg-bg text-text">
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
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                  sidebarTab === 'requests'
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted hover:text-text hover:bg-white/5'
                }`}
              >
                <Clock size={12} />
                Requests ({pendingOrders.length})
              </button>
              <button
                onClick={() => setSidebarTab('refills')}
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                  sidebarTab === 'refills'
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
                        className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${
                          inCart 
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
                              Date: {new Date(order.date).toLocaleDateString('en-IN')}
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
                        className={`p-3 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${
                          inCart 
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
                              Due Date: {new Date(refill.next_refill_date).toLocaleDateString('en-IN')}
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
            distributors.map((dist) => (
              <div key={dist.storeId} className="bg-bg2/30 border border-glass-border rounded-xl overflow-hidden shadow-sm">
                {/* Distributor header */}
                <div className="bg-bg3/60 px-4 py-2.5 border-b border-glass-border flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-text tracking-wide uppercase flex items-center gap-2">
                    <Package size={14} className="text-sky" />
                    {dist.storeName}
                  </h4>
                  <div className="flex items-center gap-3">
                    {dist.deliveryPersons.length > 0 && (
                      <span className="text-[10px] text-muted flex items-center gap-1">
                        <Truck size={11} />
                        {dist.deliveryPersons[0].name}
                      </span>
                    )}
                    <span className="text-[10px] text-muted font-bold px-2 py-0.5 bg-bg/50 rounded-full border border-glass-border/30">
                      {dist.items.length} item{dist.items.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => handleSendManualNotification(dist)}
                      disabled={sendingNotifId === dist.storeId}
                      className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm"
                      title="Send WhatsApp alert to distributor & delivery boy"
                    >
                      {sendingNotifId === dist.storeId ? (
                        <span className="w-2.5 h-2.5 border border-emerald-400/20 border-t-emerald-400 rounded-full animate-spin" />
                      ) : (
                        <Send size={10} />
                      )}
                      <span>Notify Order</span>
                    </button>
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
  );
}
