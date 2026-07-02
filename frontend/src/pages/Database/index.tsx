import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Database as DatabaseIcon, Search, RefreshCw, BookOpen, ArrowDownAZ, Clock, X, Edit, Trash2, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';

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
  last_purchase_rate?: number;
  last_purchase_mrp?: number;
  last_distributor_name?: string;
}

// Module-level cache for instant re-mount
let cachedMedicines: MedicineRow[] | null = null;

const DatabasePage = () => {
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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [allSelectedAcrossPages, setAllSelectedAcrossPages] = useState(false);
  const [sort, setSort] = useState('name_asc');
  const [letter, setLetter] = useState('');
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);

  // Add / Delete features
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'single' | 'bulk'>('single');
  const [singleForm, setSingleForm] = useState({
    name: '',
    generic_name: '',
    category: '',
    manufacturer: '',
    marketed_by: '',
    packaging: '',
    strength: '',
    pack_unit: 'Tablet',
    mrp: '',
    hsn_code: '',
    cgst_per: 6,
    sgst_per: 6
  });
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);

  const handleMfgChange = async (val: string) => {
    setSingleForm(prev => ({ ...prev, manufacturer: val }));
    try {
      const res = await api.getManufacturers(val);
      setMfgSuggestions(res || []);
      setShowMfgSuggestions(true);
    } catch (err) {
      console.error('Error fetching manufacturers:', err);
    }
  };

  const handleMfgFocus = async (val: string) => {
    try {
      const res = await api.getManufacturers(val);
      setMfgSuggestions(res || []);
      setShowMfgSuggestions(true);
    } catch (err) {
      console.error('Error fetching manufacturers:', err);
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
    try {
      await api.deleteMedicine(id);
      alert('Medicine deleted successfully');
      setSelectedIds(prev => prev.filter(item => item !== id));
      setPage(1);
      loadDatabase();
    } catch (err: any) {
      console.error(err);
      const errorMsg = err.response?.data?.error || 'Failed to delete medicine.';
      alert(errorMsg);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(medicines.map(m => m.id));
    } else {
      setSelectedIds([]);
      setAllSelectedAcrossPages(false);
    }
  };

  const handleSelectRow = (id: number) => {
    setSelectedIds(prev => {
      const updated = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
      if (updated.length !== medicines.length) {
        setAllSelectedAcrossPages(false);
      }
      return updated;
    });
  };

  const handleBulkDelete = async () => {
    const countToDelete = allSelectedAcrossPages ? totalItems : selectedIds.length;
    if (!window.confirm(`Are you sure you want to delete all ${countToDelete} selected medicines? This cannot be undone.`)) {
      return;
    }
    
    setLoading(true);
    try {
      const res = await api.bulkDeleteMedicines({
        ids: allSelectedAcrossPages ? undefined : selectedIds,
        all: allSelectedAcrossPages,
        productName: productNameTerm,
        mrpFilter: mrpTerm,
        apiFilter: apiTerm,
        packagingFilter: packagingTerm,
        distributorFilter: distributorTerm,
      });

      setLoading(false);
      setSelectedIds([]);
      setAllSelectedAcrossPages(false);
      setPage(1);
      loadDatabase();

      const successCount = res.successCount || 0;
      const failCount = res.failCount || 0;
      const failedNames = res.failedNames || [];

      if (failCount === 0) {
        alert(`Successfully deleted all ${successCount} selected medicines.`);
      } else {
        alert(
          `Deleted ${successCount} medicines.\n` +
          `Failed to delete ${failCount} medicines because they have associated transactions:\n` +
          failedNames.slice(0, 5).join(', ') + 
          (failedNames.length > 5 ? `, and ${failedNames.length - 5} more...` : '')
        );
      }
    } catch (err: any) {
      console.error(err);
      setLoading(false);
      const errorMsg = err.response?.data?.error || 'Failed to bulk delete medicines.';
      alert(errorMsg);
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleForm.name) {
      alert('Medicine name is required');
      return;
    }
    setAdding(true);
    setAddMessage(null);
    try {
      await api.createMedicine(singleForm);
      setAdding(false);
      setAddMessage('Medicine registered successfully!');
      setSingleForm({
        name: '',
        generic_name: '',
        category: '',
        manufacturer: '',
        marketed_by: '',
        packaging: '',
        strength: '',
        pack_unit: 'Tablet',
        mrp: '',
        hsn_code: '',
        cgst_per: 6,
        sgst_per: 6
      });
      setPage(1);
      loadDatabase();
      setTimeout(() => setAddMessage(null), 3000);
    } catch (err: any) {
      console.error(err);
      setAdding(false);
      const errorMsg = err.response?.data?.error || 'Failed to create medicine.';
      alert(errorMsg);
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
    setPage(1);
    loadDatabase();
    setTimeout(() => setAddMessage(null), 3000);
  };

  const limit = 100;
  
  const observerTarget = useRef<HTMLTableRowElement>(null);

  const loadDatabase = useCallback(() => {
    if (page === 1) setLoading(true);
    else setAppending(true);

    api.getMedicines(page, limit, '', sort, letter, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm, '')
      .then((res: any) => {
        if (page === 1) {
          setMedicines(res.data || []);
          cachedMedicines = res.data || [];
          setSelectedIds([]);
          setAllSelectedAcrossPages(false);
        } else {
          setMedicines(prev => {
            const newIds = new Set((res.data || []).map((m: any) => m.id));
            const filteredPrev = prev.filter(p => !newIds.has(p.id));
            return [...filteredPrev, ...(res.data || [])];
          });
        }
        setTotalPages(res.totalPages || 1);
        setTotalItems(res.totalItems || 0);
        setLoading(false);
        setAppending(false);
      })
      .catch((err) => {
        console.error('Failed to load medicines database:', err);
        setLoading(false);
        setAppending(false);
      });
  }, [page, limit, sort, letter, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm]);

  useEffect(() => {
    loadDatabase();
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
    }, 500);
    return () => clearTimeout(timer);
  }, [productNameInput, mrpInput, apiInput, packagingInput, distributorInput, productNameTerm, mrpTerm, apiTerm, packagingTerm, distributorTerm]);

  return (
    <div className="h-full flex flex-col fade-in relative gap-2">
      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        
        {/* Floating Actions */}
        <div className="absolute bottom-8 right-8 flex flex-col gap-3 z-30">
          <button 
            className="w-12 h-12 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)] bg-bg3 border border-glass-border hover:bg-bg2 text-green-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={() => setShowAddModal(true)} 
            title="Add Medicines"
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
            className="w-12 h-12 rounded-full shadow-[0_0_20px_rgba(14,165,233,0.5)] bg-sky-500 text-white hover:bg-sky-400 flex items-center justify-center transition-all group hover:-translate-y-1"
            onClick={() => { setPage(1); loadDatabase(); }} 
            title="Refresh Data"
          >
            <RefreshCw size={20} className={loading && page === 1 ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} /> 
          </button>
        </div>



        {/* Bulk Delete Action Bar */}
        {selectedIds.length > 0 && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0 animate-fade-in z-20">
            <div className="text-xs font-semibold text-red-400">
              {allSelectedAcrossPages ? (
                <span>Selected all {totalItems} medicines in the database matching current filters.</span>
              ) : (
                <span>
                  Selected {selectedIds.length} {selectedIds.length === 1 ? 'medicine' : 'medicines'} on this page.
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
                    setSelectedIds([]);
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
                    checked={medicines.length > 0 && selectedIds.length === medicines.length}
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
                  >
                    <td className="p-4 text-center align-middle w-12">
                      <input 
                        type="checkbox"
                        className="rounded bg-bg3 border-glass-border text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                        checked={selectedIds.includes(item.id)}
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
                          onClick={() => openPriceHistory(item.name)}
                          className="px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-white transition-all font-bold text-[10px] uppercase"
                          title="View Supplier Price History"
                        >
                          Rates
                        </button>
                        <button
                          onClick={() => setUniversalEditMedicineId(item.id)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-white transition-all font-bold text-[10px] uppercase flex items-center gap-0.5"
                          title="Edit global medicine details"
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

      {/* Price History Modal */}
      {showPriceHistoryModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-md">
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
                        const dateStr = item.date ? new Date(item.date).toLocaleDateString() : 'N/A';
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
        </div>
      )}

      {universalEditMedicineId && (
        <UniversalMedicineEditModal 
          medicineId={universalEditMedicineId} 
          onClose={() => setUniversalEditMedicineId(null)} 
          onSave={() => {
            setPage(1);
            loadDatabase();
          }} 
        />
      )}

      {/* Add Medicine Modal */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center text-green-400">
                  <Plus size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text leading-tight">Add New Medicine</h3>
                  <p className="text-xs text-muted mt-0.5">Register single or multiple catalog products</p>
                </div>
              </div>
              <button 
                onClick={() => { setShowAddModal(false); setAddMessage(null); }}
                className="p-2 rounded-full hover:bg-bg2 text-muted hover:text-text transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-glass-border bg-bg2 shrink-0">
              <button
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${addTab === 'single' ? 'border-green-500 text-green-400 bg-green-500/5' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => setAddTab('single')}
              >
                Single Medicine
              </button>
              <button
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${addTab === 'bulk' ? 'border-green-500 text-green-400 bg-green-500/5' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => setAddTab('bulk')}
              >
                Bulk Add
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-custom space-y-4">
              {addMessage && (
                <div className={`p-3 rounded-lg text-xs font-medium border ${addMessage.includes('Added') || addMessage.includes('Adding') ? 'bg-sky-500/10 border-sky-500/20 text-sky-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                  {addMessage}
                </div>
              )}

              {addTab === 'single' ? (
                <form id="single-add-form" onSubmit={handleSingleSubmit} className="space-y-4 text-left">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Medicine Name *</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all font-bold"
                      value={singleForm.name}
                      onChange={e => setSingleForm({...singleForm, name: e.target.value})}
                      placeholder="e.g. Paracetamol 500mg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Generic Name (Formula)</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all"
                        value={singleForm.generic_name}
                        onChange={e => setSingleForm({...singleForm, generic_name: e.target.value})}
                        placeholder="e.g. Paracetamol"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Category</label>
                      <select 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all cursor-pointer"
                        value={singleForm.category}
                        onChange={e => setSingleForm({...singleForm, category: e.target.value})}
                      >
                        <option value="">Select Category</option>
                        <option value="Allopathy">Allopathy</option>
                        <option value="Homeopathy">Homeopathy</option>
                        <option value="Ayurvedic">Ayurvedic</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="block text-xs font-semibold text-muted mb-1">Manufacturer</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all"
                        value={singleForm.manufacturer}
                        onChange={(e) => handleMfgChange(e.target.value)}
                        onFocus={(e) => handleMfgFocus(e.target.value)}
                        onBlur={() => setTimeout(() => setShowMfgSuggestions(false), 200)}
                        placeholder="e.g. Cipla Ltd"
                      />
                      {showMfgSuggestions && mfgSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown text-left">
                          {mfgSuggestions.map((mfgName, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSingleForm(prev => ({ ...prev, manufacturer: mfgName }))}
                              className="w-full text-left px-3 py-2 hover:bg-white/10 text-text border-b border-glass-border/10 last:border-0 flex items-center justify-between text-xs"
                            >
                              <span className="truncate pr-2 font-medium">{mfgName}</span>
                              <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0">
                                In Database
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Marketed By</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all"
                        value={singleForm.marketed_by}
                        onChange={e => setSingleForm({...singleForm, marketed_by: e.target.value})}
                        placeholder="e.g. Cipla Pvt Ltd"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Pack Size (e.g., 10x10)</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all"
                        value={singleForm.packaging}
                        onChange={e => setSingleForm({...singleForm, packaging: e.target.value})}
                        placeholder="e.g. 10x10 Tab"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Strength</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all"
                        value={singleForm.strength}
                        onChange={e => setSingleForm({...singleForm, strength: e.target.value})}
                        placeholder="e.g. 500mg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Type</label>
                      <select 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all cursor-pointer"
                        value={singleForm.pack_unit}
                        onChange={e => setSingleForm({...singleForm, pack_unit: e.target.value})}
                      >
                        <option value="Tablet">Tablet</option>
                        <option value="Capsule">Capsule</option>
                        <option value="Syrup">Syrup</option>
                        <option value="Drop">Drop</option>
                        <option value="Injection">Injection</option>
                        <option value="Ointment">Ointment</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">MRP ₹</label>
                      <input 
                        type="number" 
                        step="0.01"
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all font-mono"
                        value={singleForm.mrp}
                        onChange={e => setSingleForm({...singleForm, mrp: e.target.value})}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">HSN Code</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all font-mono"
                        value={singleForm.hsn_code}
                        onChange={e => setSingleForm({...singleForm, hsn_code: e.target.value})}
                        placeholder="3004"
                      />
                    </div>
                  </div>
                </form>
              ) : (
                <form id="bulk-add-form" onSubmit={handleBulkSubmit} className="space-y-4 text-left">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Medicine Names (One per line) *</label>
                    <textarea 
                      required 
                      rows={6}
                      className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-lg text-sm text-text focus:border-green-500 focus:outline-none transition-all font-mono resize-none"
                      value={bulkText}
                      onChange={e => setBulkText(e.target.value)}
                      placeholder="Paracetamol 500mg&#10;Amoxicillin 250mg&#10;Ibuprofen 400mg"
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
                    </select>
                  </div>
                </form>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-glass-border bg-bg3 flex justify-end gap-3 shrink-0">
              <button 
                type="button" 
                onClick={() => { setShowAddModal(false); setAddMessage(null); }}
                className="px-5 py-2 rounded-xl border border-glass-border hover:bg-bg2 text-muted hover:text-text font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                form={addTab === 'single' ? 'single-add-form' : 'bulk-add-form'}
                disabled={adding}
                className="px-6 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-colors flex items-center gap-2 shadow-lg shadow-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
                {adding ? 'Registering...' : addTab === 'single' ? 'Add Single Medicine' : 'Bulk Register'}
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
