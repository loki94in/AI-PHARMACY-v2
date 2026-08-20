import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Database as DatabaseIcon, Search, RefreshCw, BookOpen, ArrowDownAZ, Clock, X, Edit, Trash2, Plus, Upload, Unlock, ShoppingCart } from 'lucide-react';
import { api } from '../../services/api';
import { UniversalMedicineEditModal, updateMedicineNameWithPackSize, parsePackSizeFromPackaging } from '../../components/UniversalMedicineEditModal';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import CatalogUpload from '../CatalogUpload';
import { formatDisplayDate } from '../../utils/date';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { toastEvent } from '../../services/events';

interface MedicineRow {
  id: number;
  name: string;
  generic_name?: string;
  manufacturer?: string;
  marketed_by?: string;
  strength?: string;
  packaging?: string;
  pack_unit?: string;
  item_code?: string;
  category?: string;
  api_reference?: string;
  mrp?: number;
  sell_price?: number;
  last_purchase_rate?: number;
  last_purchase_mrp?: number;
  last_distributor_name?: string;
  source?: string;
  possible_duplicate_of?: number;
  therapeutic?: string;
  sub_therapeutic?: string;
  short_code?: string;
  ucode?: string;
  schedule_type?: string;
  item_type?: string;
}

// Module-level cache for instant re-mount
let cachedMedicines: MedicineRow[] | null = null;

const DatabasePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'db';
  const queryClient = useQueryClient();
  const [medicines, setMedicines] = useState<MedicineRow[]>(cachedMedicines || []);
  const [loading, setLoading] = useState(!cachedMedicines);
  const [appending, setAppending] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [productNameInput, setProductNameInput] = useState('');

  const [productNameTerm, setProductNameTerm] = useState('');
  const [mrpInput, setMrpInput] = useState('');
  const [mrpTerm, setMrpTerm] = useState('');
  const [apiInput, setApiInput] = useState('');
  const [apiTerm, setApiTerm] = useState('');
  const [packagingInput, setPackagingInput] = useState('');
  const [packagingTerm, setPackagingTerm] = useState('');
  const [distributorInput, setDistributorInput] = useState('');
  const [distributorTerm, setDistributorTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [allSelectedAcrossPages, setAllSelectedAcrossPages] = useState(false);
  const [sort, setSort] = useState('name_asc');
  const [letter, setLetter] = useState('');
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);
  const [universalEditMode, setUniversalEditMode] = useState<'create' | 'edit'>('edit');
  const [universalEditItem, setUniversalEditItem] = useState<any>(null);
  const [isUniversalModalOpen, setIsUniversalModalOpen] = useState(false);

  // Bulk Multi-Add state
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [seedingMaster, setSeedingMaster] = useState(false);
  const [syncingInventory, setSyncingInventory] = useState(false);

  const handleSeedMasterCatalog = async () => {
    if (!window.confirm('Do you want to seed/restore the full master medicines catalog (200,000+ reference items) into the database?')) {
      return;
    }
    setSeedingMaster(true);
    try {
      const res = await api.seedMasterMedicines();
      alert(res.message || 'Master catalog seeded successfully!');
      invalidateAfterStockWrite(queryClient);
      setPage(1);
      loadDatabase();
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.error || err.message || 'Failed to seed master catalog');
    } finally {
      setSeedingMaster(false);
    }
  };

  const handleSyncFromInventory = async () => {
    setSyncingInventory(true);
    try {
      const res = await api.syncInventoryToMaster();
      alert(res.message || 'Inventory medicines synced to master catalog!');
      invalidateAfterStockWrite(queryClient);
      setPage(1);
      loadDatabase();
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.error || err.message || 'Failed to sync inventory to master');
    } finally {
      setSyncingInventory(false);
    }
  };
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Price History Modal States
  const [showPriceHistoryModal, setShowPriceHistoryModal] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [priceHistoryMedicine, setPriceHistoryMedicine] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleSellMedicine = async (item: MedicineRow) => {
    try {
      const refillInfo = await api.getMedicineRefillInfo(item.id);
      const lastSale = refillInfo?.last_sale;
      const bestInv = refillInfo?.best_inventory;

      const prefillPayload: any = {
        medicineId: item.id,
        medicineName: item.name,
        quantity: lastSale?.quantity || 1,
        looseQty: lastSale?.loose_qty || 0,
        patientName: lastSale?.customer_name || '',
        patientPhone: lastSale?.customer_phone || '',
        selectedCustomerId: lastSale?.customer_id || null,
        doctorName: lastSale?.doctor_name || '',
        medicines: [{
          medicineId: item.id,
          medicineName: item.name,
          inventory_id: bestInv?.inventory_id || undefined,
          batch_no: bestInv?.batch_no || '',
          expiry_date: bestInv?.expiry_date || '',
          mrp: bestInv?.mrp || item.mrp || 0,
          sell_price: item.sell_price || null,
          quantity: lastSale?.quantity || 1,
          loose_qty: lastSale?.loose_qty || 0,
          unit_price: lastSale?.unit_price || bestInv?.unit_price || item.sell_price || item.mrp || 0,
          discount: lastSale?.discount || 0,
          packaging: item.packaging,
          pack_size: parsePackSizeFromPackaging(item.packaging) || 1
        }]
      };

      if (refillInfo?.sibling_items && Array.isArray(refillInfo.sibling_items) && refillInfo.sibling_items.length > 0) {
        for (const sib of refillInfo.sibling_items) {
          prefillPayload.medicines.push({
            medicineId: sib.medicine_id,
            medicineName: sib.medicine_name,
            inventory_id: sib.inventory_id || undefined,
            batch_no: sib.batch_no || '',
            expiry_date: sib.expiry_date || '',
            mrp: sib.mrp || 0,
            sell_price: sib.sell_price || null,
            quantity: sib.sold_quantity || 1,
            loose_qty: sib.sold_loose_qty || 0,
            unit_price: sib.sold_unit_price || sib.sell_price || sib.mrp || 0,
            discount: sib.sold_discount || 0,
            packaging: sib.packaging,
            pack_size: sib.pack_size || 1
          });
        }
      }

      if (lastSale?.customer_name) {
        toastEvent.trigger(`Transferring "${item.name}" (Qty: ${lastSale.quantity || 1}) for ${lastSale.customer_name} to POS...`, 'info', '/pos');
      } else {
        toastEvent.trigger(`Transferring "${item.name}" to POS...`, 'info', '/pos');
      }

      navigate('/pos', { state: { prefill: prefillPayload } });
    } catch (err: any) {
      const prefillPayload = {
        medicineId: item.id,
        medicineName: item.name,
        quantity: 1,
        medicines: [{
          medicineId: item.id,
          medicineName: item.name,
          mrp: item.mrp || 0,
          sell_price: item.sell_price || null,
          quantity: 1
        }]
      };
      toastEvent.trigger(`Transferring "${item.name}" to POS...`, 'info', '/pos');
      navigate('/pos', { state: { prefill: prefillPayload } });
    }
  };

  const openPriceHistory = (medicineName: string) => {
    setPriceHistoryMedicine(medicineName);
    setShowPriceHistoryModal(true);
    setLoadingHistory(true);
    setPriceHistory([]);
    
    api.getMedicinePriceHistory(medicineName)
      .then((res: any) => {
        setPriceHistory(res.data || []);
        setLoadingHistory(false);
      })
      .catch((err: any) => {
        console.error('Failed to load medicine price history:', err);
        setLoadingHistory(false);
      });
  };

  const handleDeleteMedicine = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}" from the database? This cannot be undone.`)) {
      return;
    }
    // Optimistically remove from state so the user can continue working immediately without page reload
    setMedicines(prev => prev.filter(m => m.id !== id));
    if (cachedMedicines) cachedMedicines = cachedMedicines.filter(m => m.id !== id);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setTotalItems(prev => Math.max(0, prev - 1));

    try {
      await api.deleteMedicine(id);
      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
    } catch (err: any) {
      console.error(err);
      const errorMsg = err.response?.data?.error || 'Failed to delete medicine.';
      alert(errorMsg);
      // Revert on error
      queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(medicines.map(m => m.id)));
    } else {
      setSelectedIds(new Set());
      setAllSelectedAcrossPages(false);
    }
  };

  const handleSelectRow = (id: number) => {
    setSelectedIds(prev => {
      const updated = new Set(prev);
      if (updated.has(id)) updated.delete(id); else updated.add(id);
      if (updated.size !== medicines.length) {
        setAllSelectedAcrossPages(false);
      }
      return updated;
    });
  };

  const handleBulkDelete = async () => {
    const countToDelete = allSelectedAcrossPages ? totalItems : selectedIds.size;
    if (!window.confirm(`Are you sure you want to delete all ${countToDelete} selected medicines? This cannot be undone.`)) {
      return;
    }
    
    const idsToDeleteSet = new Set(selectedIds);

    // Optimistically remove deleted rows from state so page doesn't reset or flash full loading screen
    if (!allSelectedAcrossPages) {
      setMedicines(prev => prev.filter(m => !idsToDeleteSet.has(m.id)));
      if (cachedMedicines) cachedMedicines = cachedMedicines.filter(m => !idsToDeleteSet.has(m.id));
      setTotalItems(prev => Math.max(0, prev - idsToDeleteSet.size));
    }
    setSelectedIds(new Set());
    setAllSelectedAcrossPages(false);

    try {
      const res = await api.bulkDeleteMedicines({
        ids: allSelectedAcrossPages ? undefined : Array.from(idsToDeleteSet),
        all: allSelectedAcrossPages,
        productName: productNameTerm,
        mrpFilter: mrpTerm,
        apiFilter: apiTerm,
        packagingFilter: packagingTerm,
        distributorFilter: distributorTerm,
      });

      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['database-medicines'] });

      const successCount = res.successCount || 0;
      const failCount = res.failCount || 0;
      const failedNames = res.failedNames || [];

      if (failCount > 0) {
        alert(
          `Deleted ${successCount} medicines.\n` +
          `Failed to delete ${failCount} medicines because they have associated transactions:\n` +
          failedNames.slice(0, 5).join(', ') + 
          (failedNames.length > 5 ? `, and ${failedNames.length - 5} more...` : '')
        );
      }
    } catch (err: any) {
      console.error(err);
      const errorMsg = err.response?.data?.error || 'Failed to bulk delete medicines.';
      alert(errorMsg);
      queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const names = bulkText.split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) {
      alert('Enter at least one medicine name');
      return;
    }
    setAdding(true);
    let count = 0;
    setAddMessage(`Adding ${names.length} medicines...`);
    for (const name of names) {
      try {
        await api.createMedicine({
          name,
          category: bulkCategory,
          pack_unit: 'Tablet',
          cgst_per: 6,
          sgst_per: 6
        });
        count++;
        setAddMessage(`Added ${count} / ${names.length} medicines...`);
      } catch (err) {
        console.error(`Failed to bulk add "${name}":`, err);
      }
    }
    setAdding(false);
    setAddMessage(`Finished bulk add! Successfully registered ${count} medicines.`);
    setBulkText('');
    invalidateAfterStockWrite(queryClient);
    api.getCompactInventory().catch(() => {});
    setPage(1);
    loadDatabase();
    setTimeout(() => setAddMessage(null), 3000);
  };

  const limit = 100;
  
  const observerTarget = useRef<HTMLTableRowElement>(null);

  const { data: pageData, isFetching: queryIsFetching } = useApiQuery<any>(
    ['database-medicines', page, sort, letter, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm],
    () => api.getMedicines(page, limit, '', sort, letter, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm, ''),
    { staleTime: 30000 }
  );

  useEffect(() => {
    if (queryIsFetching) {
      if (page === 1 && medicines.length === 0) setLoading(true);
      else if (page > 1) setAppending(true);
    }
  }, [queryIsFetching, page, medicines.length]);

  useEffect(() => {
    if (pageData) {
      const data = pageData.data || [];
      const totalPagesVal = pageData.totalPages || 1;
      const totalItemsVal = pageData.totalItems || 0;

      setTotalPages(totalPagesVal);
      setTotalItems(totalItemsVal);

      if (page === 1) {
        setMedicines(data);
        cachedMedicines = data;
        setSelectedIds(new Set());
        setAllSelectedAcrossPages(false);
      } else {
        setMedicines(prev => {
          const newIds = new Set(data.map((m: any) => m.id));
          const filteredPrev = prev.filter(p => !newIds.has(p.id));
          return [...filteredPrev, ...data];
        });
      }
      setLoading(false);
      setAppending(false);
    }
  }, [pageData, page]);

  const loadDatabase = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
  }, [queryClient]);

  useEffect(() => {
    const handleUpdate = () => {
      cachedMedicines = null;
      loadDatabase();
    };
    window.addEventListener('stock-write-completed', handleUpdate);
    window.addEventListener('price-updated', handleUpdate);
    window.addEventListener('compact-inventory-ready', handleUpdate);
    return () => {
      window.removeEventListener('stock-write-completed', handleUpdate);
      window.removeEventListener('price-updated', handleUpdate);
      window.removeEventListener('compact-inventory-ready', handleUpdate);
    };
  }, [loadDatabase]);

  // Infinite Scroll Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loading && !appending && page < totalPages) {
          setPage(p => p + 1);
        }
      },
      { threshold: 0.1 }
    );
    
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    
    return () => observer.disconnect();
  }, [loading, appending, page, totalPages]);

  // Debounce search input
  useEffect(() => {
    const hasChanges = 
      productNameInput !== productNameTerm ||
      mrpInput !== mrpTerm ||
      apiInput !== apiTerm ||
      packagingInput !== packagingTerm ||
      distributorInput !== distributorTerm;

    if (hasChanges) {
      setSearchPending(true);
    }

    const timer = setTimeout(() => {
      setPage(1); // Reset to page 1 on new search
      setProductNameTerm(productNameInput);
      setMrpTerm(mrpInput);
      setApiTerm(apiInput);
      setPackagingTerm(packagingInput);
      setDistributorTerm(distributorInput);
      setSearchPending(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [productNameInput, mrpInput, apiInput, packagingInput, distributorInput, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm]);

  return (
    <div className="h-full flex flex-col fade-in relative gap-3">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm shrink-0">
        {/* Title & Quick Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <DatabaseIcon size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-text leading-none">Database & Master Catalog</h1>
              <p className="text-[11px] text-muted mt-0.5">Explore SQLite drug records & upload distributor master catalogs</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setUniversalEditMedicineId(null);
                setUniversalEditMode('create');
                setUniversalEditItem(null);
                setIsUniversalModalOpen(true);
              }}
              className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Register a new medicine to Master Database using Universal Editor"
            >
              <Plus size={13} />
              <span>Add Medicine</span>
            </button>
            <button
              onClick={() => setShowBulkAddModal(true)}
              className="px-2.5 py-1.5 bg-bg3 hover:bg-bg2 text-muted hover:text-text border border-glass-border rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Bulk Multi-Add medicine names"
            >
              <Upload size={12} />
              <span className="hidden sm:inline">Bulk Add</span>
            </button>
            <button
              onClick={handleSyncFromInventory}
              disabled={syncingInventory}
              className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Sync all saved/purchased products from inventory into Master Database"
            >
              <RefreshCw size={12} className={syncingInventory ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{syncingInventory ? 'Syncing...' : 'Sync Meds'}</span>
            </button>
            <button
              onClick={handleSeedMasterCatalog}
              disabled={seedingMaster}
              className="px-2.5 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Seed/Restore full 200,000+ reference medicines catalog"
            >
              <BookOpen size={12} className={seedingMaster ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{seedingMaster ? 'Seeding...' : 'Seed Catalog'}</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/40 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {[
            { id: 'db', label: 'Master Database', icon: DatabaseIcon },
            { id: 'catalog', label: 'Catalog Upload', icon: Upload },
          ].map(t => {
            const Icon = t.icon;
            const isActive = currentTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSearchParams({ tab: t.id })}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-primary' : 'text-muted'} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {currentTab === 'catalog' ? (
        <div className="glass-panel flex-1 flex flex-col overflow-hidden">
          <CatalogUpload />
        </div>
      ) : (
        <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        
        {/* Floating Actions */}
        <div className="absolute bottom-8 right-8 flex flex-col gap-3 z-30">
          <button 
            className="w-12 h-12 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)] bg-bg3 border border-glass-border hover:bg-bg2 text-green-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={() => {
              setUniversalEditMedicineId(null);
              setUniversalEditMode('create');
              setUniversalEditItem(null);
              setIsUniversalModalOpen(true);
            }} 
            title="Add New Medicine (Universal Editor)"
          >
            <Plus size={20} className="group-hover:scale-110 transition-transform" />
          </button>

          <button 
            className="w-12 h-12 rounded-full shadow-[0_0_15px_rgba(14,165,233,0.3)] bg-bg3 border border-glass-border hover:bg-bg2 text-sky-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={() => { setPage(1); setSort(s => s === 'name_asc' ? 'id_desc' : 'name_asc'); }} 
            title="Toggle Sort Order"
          >
            {sort === 'name_asc' ? <ArrowDownAZ size={20} className="group-hover:scale-110 transition-transform" /> : <Clock size={20} className="group-hover:scale-110 transition-transform" />}
          </button>

          <button 
            className="w-12 h-12 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.5)] bg-bg3 border border-glass-border hover:bg-bg2 text-amber-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={async () => {
              try {
                const res = await api.unlockDatabase();
                alert(res.message);
              } catch (err: any) {
                alert(err.response?.data?.error || err.message || 'Failed to unlock database');
              }
            }} 
            title="Force Unlock Database"
          >
            <Unlock size={20} className="group-hover:scale-110 transition-transform" />
          </button>

          <button 
            className="w-12 h-12 rounded-full shadow-[0_0_20px_rgba(14,165,233,0.5)] bg-sky-500 text-white hover:bg-sky-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={() => { setPage(1); loadDatabase(); }} 
            title="Refresh Data"
          >
            <RefreshCw size={20} className={loading && page === 1 ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} /> 
          </button>
        </div>



        {/* Bulk Delete Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0 animate-fade-in z-20">
            <div className="text-xs font-semibold text-red-400">
              {allSelectedAcrossPages ? (
                <span>Selected all {totalItems} medicines in the database matching current filters.</span>
              ) : (
                <span>
                  Selected {selectedIds.size} {selectedIds.size === 1 ? 'medicine' : 'medicines'} on this page.
                  {totalItems > medicines.length && (
                    <button
                      onClick={() => setAllSelectedAcrossPages(true)}
                      className="ml-2 text-sky-400 hover:text-sky-300 underline font-bold transition-all"
                    >
                      Select all {totalItems} medicines in database
                    </button>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {allSelectedAcrossPages && (
                <button
                  onClick={() => {
                    setSelectedIds(new Set());
                    setAllSelectedAcrossPages(false);
                  }}
                  className="px-3 py-1.5 border border-glass-border hover:bg-bg2 text-muted hover:text-text rounded-lg text-xs font-bold uppercase transition-all"
                >
                  Clear Selection
                </button>
              )}
              <button
                onClick={handleBulkDelete}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1.5 shadow-md shadow-red-600/10 hover:shadow-red-600/20"
              >
                <Trash2 size={12} />
                {allSelectedAcrossPages ? `Delete All ${totalItems} Medicines` : 'Delete Selected'}
              </button>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="flex-1 overflow-auto bg-bg2 relative">
          {/* Slim progress bar during sync/load */}
          <div className="relative shrink-0">
            {(loading || searchPending || appending) && (
              <div className="h-0.5 w-full bg-sky-500/20 overflow-hidden absolute top-0 left-0 z-50">
                <div className="h-full bg-sky-500 animate-pulse w-full" style={{ animationDuration: '1s' }} />
              </div>
            )}
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-bg/95 backdrop-blur z-10 shadow-md">
              <tr>
                <th className="p-4 border-b border-glass-border w-12 text-center align-middle">
                  <input 
                    type="checkbox"
                    className="rounded bg-bg3 border-glass-border text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                    checked={medicines.length > 0 && selectedIds.size === medicines.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border w-16 align-middle">ID</th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle">
                  <div className="flex flex-col">
                    <input 
                      type="text" 
                      placeholder="Product Name..." 
                      className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-500/50 font-medium normal-case"
                      value={productNameInput}
                      onChange={e => setProductNameInput(e.target.value)}
                    />
                  </div>
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle">
                  <div className="flex flex-col">
                    <input 
                      type="text" 
                      placeholder="Composition (API)..." 
                      className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-500/50 font-medium normal-case"
                      value={apiInput}
                      onChange={e => setApiInput(e.target.value)}
                    />
                  </div>
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle">Strength</th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle">
                  <div className="flex flex-col">
                    <input 
                      type="text" 
                      placeholder="Packaging..." 
                      className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-500/50 font-medium normal-case"
                      value={packagingInput}
                      onChange={e => setPackagingInput(e.target.value)}
                    />
                  </div>
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle w-32">
                  Category
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border align-middle">Manufacturer</th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-right align-middle w-28">
                  <div className="flex flex-col items-end">
                    <input 
                      type="text" 
                      placeholder="MRP (₹)..." 
                      className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-500/50 text-right font-medium normal-case"
                      value={mrpInput}
                      onChange={e => setMrpInput(e.target.value)}
                    />
                  </div>
                </th>
                <th className="p-4 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-center align-middle w-44">
                  <div className="flex flex-col items-center">
                    <input 
                      type="text" 
                      placeholder="Distributor..." 
                      className="w-full bg-bg3 border border-glass-border rounded px-2 py-1.5 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:border-sky-500/50 font-medium normal-case text-center"
                      value={distributorInput}
                      onChange={e => setDistributorInput(e.target.value)}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-12 text-center">
                    <RefreshCw size={24} className="animate-spin text-sky-400 mx-auto mb-3" />
                    <span className="text-muted text-sm block">Loading catalog data...</span>
                  </td>
                </tr>
              ) : medicines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-12 text-center text-muted">
                    <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
                    <span className="block font-medium">No medicines found.</span>
                    <span className="text-xs opacity-70 mt-1 block">Try adjusting your search terms.</span>
                  </td>
                </tr>
              ) : (
                medicines.map(item => (
                  <tr
                    key={item.id}
                    className="hover:bg-bg3/50 transition-colors border-b border-glass-border/50 group"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 73px' }}
                  >
                    <td className="p-4 text-center align-middle w-12">
                      <input
                        type="checkbox"
                        className="rounded bg-bg3 border-glass-border text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                        checked={selectedIds.has(item.id)}
                        onChange={() => handleSelectRow(item.id)}
                      />
                    </td>
                    <td className="p-4 text-xs text-muted/60 font-mono">{item.id}</td>
                    <td className="p-4">
                      <div className="font-semibold text-text text-sm">{item.name}</div>
                      <div className="flex flex-wrap gap-2 items-center mt-1">
                        {item.item_code && <span className="text-[10px] text-muted bg-bg3/50 px-1.5 py-0.5 rounded border border-glass-border/40 font-mono">Code: {item.item_code}</span>}
                        {item.api_reference && (
                          <span className="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 font-medium" title="Composition (API)">
                            {item.api_reference}
                          </span>
                        )}
                        {item.source && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                            item.source === 'ocr' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                            item.source === 'catalog' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                            'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          }`} title={`Ingested via ${item.source}`}>
                            {item.source}
                          </span>
                        )}
                        {item.possible_duplicate_of ? (
                          <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full" title={`Merge-resolved duplicate of ID: ${item.possible_duplicate_of}`}>
                            ⚠ Merge Resolved
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-4 text-xs text-sky-400 max-w-[200px] truncate" title={item.api_reference || ''}>
                      {item.api_reference || '-'}
                    </td>
                    <td className="p-4 text-xs text-muted">
                      {item.strength || '-'}
                    </td>
                    <td className="p-4 text-xs text-muted">
                      {item.packaging || '-'}
                    </td>
                    <td className="p-4 text-xs">
                      {item.category ? (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          item.category.toLowerCase() === 'allopathy' 
                            ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' 
                            : item.category.toLowerCase() === 'homeopathy'
                            ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        }`}>
                          {item.category}
                        </span>
                      ) : (
                        <span className="text-muted/40 font-medium">-</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-muted max-w-[150px] truncate" title={item.manufacturer || ''}>
                      {item.manufacturer || '-'}
                    </td>
                    <td className="p-4 text-right">
                      <div className="text-sm font-bold text-green-400">
                        {item.mrp ? `₹${item.mrp.toFixed(2)}` : '-'}
                      </div>
                      {item.last_purchase_rate !== undefined && item.last_purchase_rate !== null && (
                        <div className="mt-1 flex flex-col items-end gap-0.5 text-[10px]">
                          <span className="text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded font-mono font-semibold" title="Latest Supplier Purchase Cost">
                            Cost: ₹{item.last_purchase_rate.toFixed(2)}
                          </span>
                          {item.last_purchase_mrp !== undefined && item.last_purchase_mrp !== null && Math.abs(item.last_purchase_mrp - (item.mrp || 0)) > 0.01 && (
                            <span className="text-muted text-[9px] font-mono">
                              (Purchased MRP: ₹{item.last_purchase_mrp.toFixed(2)})
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleSellMedicine(item)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all font-bold text-[10px] uppercase flex items-center gap-1 shadow-sm"
                          title="Sell / Refill this medicine in POS"
                        >
                          <ShoppingCart size={10} />
                          Sell
                        </button>
                        <button
                          onClick={() => openPriceHistory(item.name)}
                          className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-white transition-all font-bold text-[10px] uppercase"
                          title="View Supplier Price History"
                        >
                          Rates
                        </button>
                        <button
                          onClick={() => {
                            setUniversalEditItem(item);
                            setUniversalEditMedicineId(item.id);
                            setUniversalEditMode('edit');
                            setIsUniversalModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-white transition-all font-bold text-[10px] uppercase flex items-center gap-0.5"
                          title="Universal Edit Medicine"
                        >
                          <Edit size={10} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteMedicine(item.id, item.name)}
                          className="px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all font-bold text-[10px] uppercase flex items-center gap-0.5"
                          title="Delete medicine from database"
                        >
                          <Trash2 size={10} />
                          Delete
                        </button>
                      </div>
                      {item.last_distributor_name && (
                        <div 
                          className="text-[10px] text-muted mt-1.5 font-medium truncate max-w-[140px] mx-auto text-center" 
                          title={`Last supplied by: ${item.last_distributor_name}`}
                        >
                          via {item.last_distributor_name}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
              
              {/* Observer target */}
              {!loading && page < totalPages && (
                <tr ref={observerTarget}>
                  <td colSpan={10} className="p-8 text-center text-muted">
                    {appending ? (
                      <><RefreshCw size={20} className="animate-spin inline-block mr-2 text-sky-400" /> Loading more products...</>
                    ) : (
                      'Scroll for more'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Simple Footer */}
        <div className="p-3 border-t border-glass-border bg-bg3 flex items-center justify-between">
          <div className="text-xs text-muted font-medium">
            Showing <span className="text-text">{medicines.length}</span> of <span className="text-text">{totalItems.toLocaleString()}</span> entries
          </div>
        </div>

      </div>
      )}

      {/* Price History Modal */}
      {showPriceHistoryModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-bg border border-glass-border rounded-2xl w-11/12 max-w-4xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border bg-bg3/50">
              <div>
                <h3 className="text-base font-bold text-text">Supplier Rates & Purchase History</h3>
                <p className="text-xs text-muted mt-1 font-semibold">{priceHistoryMedicine}</p>
              </div>
              <button 
                onClick={() => setShowPriceHistoryModal(false)}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <RefreshCw className="animate-spin text-sky-400" size={24} />
                  <span className="text-sm text-muted">Retrieving distributor records...</span>
                </div>
              ) : priceHistory.length === 0 ? (
                <div className="text-center py-12 text-muted italic">
                  No purchase invoice history found for this medicine in the database.
                </div>
              ) : (
                <div className="bg-bg2 border border-glass-border rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-bg3 border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-wider">
                        <th className="py-3 px-4">Purchase Date</th>
                        <th className="py-3 px-4">Distributor</th>
                        <th className="py-3 px-4">Batch</th>
                        <th className="py-3 px-4">Expiry</th>
                        <th className="py-3 px-4 text-right">Cost Rate</th>
                        <th className="py-3 px-4 text-right">MRP</th>
                        <th className="py-3 px-4 text-right">Disc %</th>
                        <th className="py-3 px-4 text-right">GST %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistory.map((item, idx) => {
                        const dateStr = item.date ? formatDisplayDate(item.date) : 'N/A';
                        const gstPer = (item.cgst_per || 0) + (item.sgst_per || 0) + (item.igst_per || 0);
                        return (
                          <tr key={idx} className="border-b border-glass-border/30 hover:bg-bg3/30 transition-colors">
                            <td className="py-3 px-4 font-mono text-muted">{dateStr}</td>
                            <td className="py-3 px-4 text-text font-semibold">{item.distributor_name || 'N/A'}</td>
                            <td className="py-3 px-4 font-mono text-text">{item.batch_no || '-'}</td>
                            <td className="py-3 px-4 font-mono text-muted">{item.expiry_date || '-'}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-green-400">₹{item.rate?.toFixed(2) || '0.00'}</td>
                            <td className="py-3 px-4 text-right font-mono text-text">₹{item.mrp?.toFixed(2) || '0.00'}</td>
                            <td className="py-3 px-4 text-right font-mono text-muted">{item.cd_per ? `${item.cd_per}%` : (item.cd_rs ? `₹${item.cd_rs}` : '-')}</td>
                            <td className="py-3 px-4 text-right font-mono text-muted">{gstPer}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end px-6 py-4 border-t border-glass-border bg-bg3/50">
              <button
                onClick={() => setShowPriceHistoryModal(false)}
                className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-bold uppercase transition-all"
              >
                Close View
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isUniversalModalOpen && (
        <UniversalMedicineEditModal 
          medicineId={universalEditMedicineId} 
          mode={universalEditMode}
          initialData={universalEditItem}
          onClose={() => {
            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
          }} 
          onSave={() => {
            setPage(1);
            loadDatabase();
            queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
          }} 
          onDelete={(delId) => {
            setMedicines(prev => prev.filter(m => m.id !== delId));
            setTotalItems(prev => Math.max(0, prev - 1));
            queryClient.invalidateQueries({ queryKey: ['database-medicines'] });
            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
          }}
        />
      )}
      
      {/* Bulk Multi-Add Medicine Modal */}
      {showBulkAddModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center text-green-400">
                  <Upload size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text leading-tight">Bulk Multi-Add Medicines</h3>
                  <p className="text-xs text-muted mt-0.5">Paste multiple medicine names to batch register into master catalog</p>
                </div>
              </div>
              <button 
                onClick={() => { setShowBulkAddModal(false); setAddMessage(null); }}
                className="p-2 rounded-full hover:bg-bg2 text-muted hover:text-text transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-custom space-y-4">
              {addMessage && (
                <div className={`p-3 rounded-lg text-xs font-medium border ${addMessage.includes('Added') || addMessage.includes('Adding') ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                  {addMessage}
                </div>
              )}

              <form id="bulk-add-form" onSubmit={handleBulkSubmit} className="space-y-4 text-left">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Medicine Names (One per line) *</label>
                  <textarea 
                    required 
                    rows={8}
                    className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all font-mono resize-none"
                    value={bulkText}
                    onChange={e => setBulkText(e.target.value)}
                    placeholder="Paracetamol 500mg&#10;Amoxicillin 250mg&#10;Ibuprofen 400mg&#10;Azithromycin 500mg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Category for all listed medicines</label>
                  <select 
                    className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all cursor-pointer"
                    value={bulkCategory}
                    onChange={e => setBulkCategory(e.target.value)}
                  >
                    <option value="">Select Category</option>
                    <option value="Allopathy">Allopathy</option>
                    <option value="Homeopathy">Homeopathy</option>
                    <option value="Ayurvedic">Ayurvedic</option>
                    <option value="General">General OTC</option>
                  </select>
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-glass-border bg-bg3 flex justify-end gap-3 shrink-0">
              <button 
                type="button" 
                onClick={() => { setShowBulkAddModal(false); setAddMessage(null); }}
                className="px-5 py-2 rounded-xl border border-glass-border hover:bg-bg2 text-muted hover:text-text font-medium transition-colors text-xs"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                form="bulk-add-form"
                disabled={adding || !bulkText.trim()}
                className="px-6 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-colors flex items-center gap-2 text-xs shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                {adding ? 'Registering...' : 'Bulk Register Medicines'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default DatabasePage;
