import React, { useState, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, RefreshCw, AlertTriangle, Pill, Package, Factory, LayoutGrid, Barcode, Tag, MapPin, Database, ChevronDown, Eye } from 'lucide-react';
import { api } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../utils/cacheInvalidation';

export const updateMedicineNameWithPackSize = (currentName: string, newPackaging: string, oldPackaging?: string): string => {
  if (!currentName) return '';
  const trimmedName = currentName.trim();
  const trimmedNewPkg = newPackaging.trim();

  if (!trimmedNewPkg) return trimmedName;

  // 1. If oldPackaging is provided and the name ends with it, do a direct replacement
  if (oldPackaging) {
    const trimmedOldPkg = oldPackaging.trim();
    if (trimmedOldPkg) {
      const escapedOldPkg = trimmedOldPkg.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const directRegex = new RegExp(`\\b${escapedOldPkg}\\s*$`, 'i');
      if (directRegex.test(trimmedName)) {
        return trimmedName.replace(directRegex, trimmedNewPkg);
      }
    }
  }

  // 2. Fallback: Parse the new packaging value to extract the number and unit
  const pkgParts = trimmedNewPkg.match(/^(\d+(?:x\d+)?)\s*(.*)$/i);
  const newNum = pkgParts ? pkgParts[1] : trimmedNewPkg;
  const newUnit = pkgParts ? pkgParts[2].trim() : '';

  const packPatternRegex = /\b(\d+(?:x\d+)?)\s*([a-zA-Z'’]+)?\s*$/i;
  const match = trimmedName.match(packPatternRegex);

  const STRENGTH_FORM_UNITS = /^(mg|mcg|g|ml|l|kg|%|iu|inj|syp|susp|gel|cream|lotion|drops|pf|md|spray|ointment|respu?l|caplet|liq|liquid|drop)$/i;

  if (match) {
    const matchedStr = match[0];
    const oldNumInName = match[1];
    const oldUnitInName = match[2] || '';

    if (!oldUnitInName || !STRENGTH_FORM_UNITS.test(oldUnitInName)) {
      const targetUnit = newUnit || oldUnitInName || 'TAB';
      const replacement = `${newNum} ${targetUnit}`.trim();
      const startIndex = trimmedName.lastIndexOf(matchedStr);
      if (startIndex !== -1) {
        return trimmedName.substring(0, startIndex) + replacement;
      }
    }
  }

  const suffix = newUnit ? `${newNum} ${newUnit}` : `${newNum} TAB`;
  return `${trimmedName} ${suffix}`;
};

const splitMedicineName = (name: string, packaging: string) => {
  const trimmedName = name.trim();
  const trimmedPkg = packaging.trim();

  let nameWithoutPkg = trimmedName;
  if (trimmedPkg && trimmedName.toLowerCase().endsWith(trimmedPkg.toLowerCase())) {
    nameWithoutPkg = trimmedName.substring(0, trimmedName.toLowerCase().lastIndexOf(trimmedPkg.toLowerCase())).trim();
  } else {
    const packPatternRegex = /\b(\d+(?:x\d+)?)\s*([a-zA-Z'’]+)?\s*$/i;
    const match = trimmedName.match(packPatternRegex);
    if (match) {
      nameWithoutPkg = trimmedName.substring(0, trimmedName.lastIndexOf(match[0])).trim();
    }
  }

  const commonTypes = ['TAB', 'CAP', 'STRIP', 'SUSPENSION', 'BOTTLE', 'VIAL', 'AMP', 'GEL', 'CREAM', 'INJ', 'OINT', 'SYP', 'SUSP', 'LIQ', 'DROP', 'DROPS', 'RESPULE', 'RESPULES', 'SACHET', 'SACHETS', 'TABLET', 'TABLETS', 'CAPSULE', 'CAPSULES'];
  let detectedType = 'TAB';
  let baseName = nameWithoutPkg;

  for (const type of commonTypes) {
    const regex = new RegExp(`\\b${type}\\s*$`, 'i');
    if (regex.test(nameWithoutPkg)) {
      detectedType = type.toUpperCase();
      baseName = nameWithoutPkg.replace(regex, '').trim();
      break;
    }
  }

  return { baseName, packType: detectedType };
};

const getMatchingPreset = (packaging: string, packType: string): string => {
  const cleanPkg = packaging.trim().toUpperCase();

  // Specific TAB presets
  if (cleanPkg === '1 TAB')  return '1_TAB';
  if (cleanPkg === '4 TAB')  return '4_TAB';
  if (cleanPkg === '10 TAB') return '10_TAB';
  if (cleanPkg === '14 TAB') return '14_TAB';
  if (cleanPkg === '15 TAB') return '15_TAB';
  if (cleanPkg === '30 TAB') return '30_TAB';
  // Specific CAP presets
  if (cleanPkg === '1 CAP')  return '1_CAP';
  if (cleanPkg === '4 CAP')  return '4_CAP';
  if (cleanPkg === '10 CAP') return '10_CAP';
  if (cleanPkg === '14 CAP') return '14_CAP';
  if (cleanPkg === '15 CAP') return '15_CAP';
  if (cleanPkg === '30 CAP') return '30_CAP';
  // Liquid / other containers
  if (cleanPkg === '1 BOTTLE') return '1_BOTTLE';
  if (cleanPkg === '1 VIAL')   return '1_VIAL';
  if (cleanPkg === '1 AMP' || cleanPkg === '1 AMPULE') return '1_AMP';

  return 'CUSTOM';
};

// Derive the packaging string directly from the preset key (no packType needed anymore)
const getPackagingString = (preset: string, _packType: string, customVal: string): string => {
  if (preset === 'CUSTOM')    return customVal;
  if (preset === '1_BOTTLE')  return '1 BOTTLE';
  if (preset === '1_VIAL')    return '1 VIAL';
  if (preset === '1_AMP')     return '1 AMP';

  // Format: '<num>_<UNIT>'  e.g. '10_TAB' → '10 TAB'
  const [num, unit] = preset.split('_');
  if (num && unit) return `${num} ${unit}`;

  return customVal;
};

interface Props {
  medicineId: number;
  onClose: () => void;
  onSave: () => void;
}

const UniversalMedicineEditModalInner: React.FC<Props> = ({ medicineId, onClose, onSave }) => {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [inventoryId, setInventoryId] = useState<number | null>(null);
  const [totalStock, setTotalStock] = useState<number>(0);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);
  const [mrkSuggestions, setMrkSuggestions] = useState<string[]>([]);
  const [showMrkSuggestions, setShowMrkSuggestions] = useState(false);

  // Redesigned structured name components
  const [baseName, setBaseName] = useState('');
  const [packType, setPackType] = useState('TAB');
  const [packQtyUnit, setPackQtyUnit] = useState('10_TAB');
  const [customPackaging, setCustomPackaging] = useState('');
  const [isManualName, setIsManualName] = useState(false);

  const handleMfgChange = async (val: string) => {
    setForm((prev: any) => ({ ...prev, manufacturer: val }));
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

  const handleMrkChange = async (val: string) => {
    setForm((prev: any) => ({ ...prev, marketed_by: val }));
    try {
      const res = await api.getMarketedBy(val);
      setMrkSuggestions(res || []);
      setShowMrkSuggestions(true);
    } catch (err) {
      console.error('Error fetching marketed-by list:', err);
    }
  };

  const handleMrkFocus = async (val: string) => {
    try {
      const res = await api.getMarketedBy(val);
      setMrkSuggestions(res || []);
      setShowMrkSuggestions(true);
    } catch (err) {
      console.error('Error fetching marketed-by list:', err);
    }
  };

  useEffect(() => {
    setLoading(true);
    api.getQuickEditMedicine(medicineId)
      .then((data: any) => {
        if (data && data.medicine) {
          const nameVal = data.medicine.name || '';
          const packagingVal = data.medicine.packaging || '';
          const parsed = splitMedicineName(nameVal, packagingVal);
          setBaseName(parsed.baseName);
          setPackType(parsed.packType);
          
          const matchingPreset = getMatchingPreset(packagingVal, parsed.packType);
          setPackQtyUnit(matchingPreset);
          if (matchingPreset === 'CUSTOM') {
            setCustomPackaging(packagingVal);
          } else {
            setCustomPackaging('');
          }

          setForm({
            name: nameVal,
            generic_name: data.medicine.generic_name || '',
            manufacturer: data.medicine.manufacturer || '',
            marketed_by: data.medicine.marketed_by || '',
            packaging: packagingVal,
            pack_unit: data.medicine.pack_unit || '',
            item_code: data.medicine.item_code || '',
            category: data.medicine.category || '',
            api_reference: data.medicine.api_reference || '',
            hsn_code: data.medicine.hsn_code || '',
            // Inventory primary record data
            quantity: data.inventory?.quantity || 0,
            rack_location: data.inventory?.rack_location || ''
          });
          setInventoryId(data.inventory?.inventory_id || null);
          setTotalStock(data.total_stock || 0);
          setIsManualName(false);
        } else {
          setError("Failed to load medicine details.");
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to load medicine details.");
        setLoading(false);
      });
  }, [medicineId]);

  // Reactive Effect to Auto-Compile Medicine Name
  useEffect(() => {
    if (loading) return;
    const packagingStr = getPackagingString(packQtyUnit, packType, customPackaging);
    
    setForm((prev: any) => {
      const updated = { 
        ...prev, 
        packaging: packagingStr,
        pack_unit: packType !== 'NONE' ? packType : (prev.pack_unit || '')
      };
      if (!isManualName) {
        const compiled = packType && packType !== 'NONE'
          ? `${baseName} ${packType} ${packagingStr}`.trim()
          : `${baseName} ${packagingStr}`.trim();
        updated.name = compiled;
      }
      return updated;
    });
  }, [baseName, packType, packQtyUnit, customPackaging, isManualName, loading]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev: any) => ({
      ...prev,
      [name]: name === 'quantity' ? parseInt(value) || 0 : value
    }));
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsManualName(true);
    setForm((prev: any) => ({ ...prev, name: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateQuickEditMedicine(medicineId, {
        ...form,
        inventory_id: inventoryId
      });

      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});

      setSaving(false);
      onSave(); // Trigger parent refresh
      onClose(); // Close modal
    } catch (err: any) {
      console.error(err);
      setError("Failed to save changes.");
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden slide-up">
        {/* Header */}
        <div className="p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <Pill size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text leading-tight">Quick Edit Medicine</h3>
              <p className="text-xs text-muted mt-0.5">ID: {medicineId} • Universal Sync</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-bg2 text-muted hover:text-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-custom">

          {/* ── Live Name Preview Banner ── */}
          {!loading && (
            <div className="sticky top-0 z-10 bg-bg3 border-b border-glass-border px-6 py-4 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Eye size={14} className="text-emerald-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Live Preview — Final Medicine Name</span>
                {isManualName && (
                  <span className="ml-auto text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider">
                    ✏ Manual Override
                  </span>
                )}
              </div>

              {/* Compiled name — large and prominent */}
              <p className="text-xl font-extrabold text-text tracking-tight leading-snug mb-3 break-words">
                {form.name || <span className="text-muted italic font-normal text-base">Start typing…</span>}
              </p>

              {/* Part breakdown chips */}
              {!isManualName && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/30 text-primary font-bold">
                    <span className="text-[9px] text-primary/60 font-semibold uppercase tracking-wider mr-0.5">Base</span>
                    {baseName || <span className="italic font-normal opacity-50">—</span>}
                  </span>

                  {packType && packType !== 'NONE' && (
                    <>
                      <span className="text-muted/40 text-base leading-none">+</span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold">
                        <span className="text-[9px] text-sky-400/60 font-semibold uppercase tracking-wider mr-0.5">Form</span>
                        {packType}
                      </span>
                    </>
                  )}

                  <span className="text-muted/40 text-base leading-none">+</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold">
                    <span className="text-[9px] text-emerald-400/60 font-semibold uppercase tracking-wider mr-0.5">Pack</span>
                    {getPackagingString(packQtyUnit, packType, customPackaging) || <span className="italic font-normal opacity-50">—</span>}
                  </span>

                  <span className="ml-auto text-[10px] text-muted italic">↑ changes reflect instantly</span>
                </div>
              )}

              {isManualName && (
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-amber-400/80 italic">Name edited manually — auto-sync is paused.</p>
                  <button
                    type="button"
                    onClick={() => setIsManualName(false)}
                    className="text-[10px] text-primary font-bold hover:underline"
                  >
                    🔄 Re-enable auto-sync
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Scrollable form area */}
          <div className="p-6 space-y-0">

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red/10 border border-red/20 flex items-start gap-3">
              <AlertTriangle className="text-red shrink-0" size={20} />
              <p className="text-sm text-red">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted">
              <RefreshCw size={32} className="animate-spin mb-4 text-primary" />
              <p>Loading medicine details...</p>
            </div>
          ) : (
            <form id="quick-edit-form" onSubmit={handleSubmit} className="space-y-8">
              
              {/* Section 1: Medicine Profile & Codes */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Pill size={16} className="text-primary" /> Medicine Profile & Codes
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Structured Name Builder */}
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Base Name & Strength *</label>
                    <input 
                      type="text" 
                      required 
                      value={baseName} 
                      onChange={(e) => setBaseName(e.target.value)}
                      placeholder="e.g. PAN 40MG"
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Form / Suffix Type</label>
                    <div className="relative">
                      <select 
                        value={packType} 
                        onChange={(e) => setPackType(e.target.value)}
                        className="w-full pl-4 pr-8 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all appearance-none cursor-pointer font-medium"
                      >
                        <option value="TAB">TAB (Tablet)</option>
                        <option value="CAP">CAP (Capsule)</option>
                        <option value="STRIP">STRIP (Strip)</option>
                        <option value="SUSPENSION">SUSPENSION (Suspension)</option>
                        <option value="BOTTLE">BOTTLE (Bottle)</option>
                        <option value="VIAL">VIAL (Vial)</option>
                        <option value="AMP">AMP (Ampoule)</option>
                        <option value="GEL">GEL (Gel)</option>
                        <option value="CREAM">CREAM (Cream)</option>
                        <option value="INJ">INJ (Injection)</option>
                        <option value="OINT">OINT (Ointment)</option>
                        <option value="SYP">SYP (Syrup)</option>
                        <option value="NONE">NONE (Skip Suffix)</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Pack Quantity Preset</label>
                    <div className="relative">
                      <select 
                        value={packQtyUnit} 
                        onChange={(e) => setPackQtyUnit(e.target.value)}
                        className="w-full pl-4 pr-8 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all appearance-none cursor-pointer font-medium"
                      >
                        <optgroup label="── Tablets (TAB)">
                          <option value="1_TAB">1 TAB</option>
                          <option value="4_TAB">4 TAB</option>
                          <option value="10_TAB">10 TAB</option>
                          <option value="14_TAB">14 TAB</option>
                          <option value="15_TAB">15 TAB</option>
                          <option value="30_TAB">30 TAB</option>
                        </optgroup>
                        <optgroup label="── Capsules (CAP)">
                          <option value="1_CAP">1 CAP</option>
                          <option value="4_CAP">4 CAP</option>
                          <option value="10_CAP">10 CAP</option>
                          <option value="14_CAP">14 CAP</option>
                          <option value="15_CAP">15 CAP</option>
                          <option value="30_CAP">30 CAP</option>
                        </optgroup>
                        <optgroup label="── Other">
                          <option value="1_BOTTLE">1 BOTTLE</option>
                          <option value="1_VIAL">1 VIAL</option>
                          <option value="1_AMP">1 AMP</option>
                          <option value="CUSTOM">Custom Size…</option>
                        </optgroup>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                    </div>
                  </div>
                  {packQtyUnit === 'CUSTOM' ? (
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Custom Pack Size</label>
                      <input 
                        type="text" 
                        value={customPackaging} 
                        onChange={(e) => setCustomPackaging(e.target.value)}
                        placeholder="e.g. 10x10 Tab"
                        className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                      />
                    </div>
                  ) : (
                    <div className="flex items-end pb-1.5 text-xs text-muted font-medium">
                      <span>Auto-Packaging: <strong className="text-text">{getPackagingString(packQtyUnit, packType, customPackaging)}</strong></span>
                    </div>
                  )}

                  {/* Generated Full Medicine Name Preview / Editable Input */}
                  <div className="md:col-span-2 border-t border-glass-border/30 pt-4 mt-2">
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="block text-xs font-semibold text-muted">Compiled Medicine Name *</label>
                      {isManualName && (
                        <button 
                          type="button" 
                          onClick={() => setIsManualName(false)}
                          className="text-xs text-primary font-bold hover:underline flex items-center gap-1 transition-all"
                        >
                          🔄 Sync with Parts
                        </button>
                      )}
                    </div>
                    <input 
                      type="text" 
                      name="name" 
                      required 
                      value={form.name || ''} 
                      onChange={handleNameChange}
                      className={`w-full px-4 py-2.5 bg-bg3 border rounded-xl text-text focus:outline-none transition-all font-bold text-lg ${
                        isManualName ? 'border-amber-500/40 focus:border-amber-500' : 'border-glass-border focus:border-primary'
                      }`}
                    />
                    {!isManualName && (
                      <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                        ● Automatically synced with structured components above
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Generic Name (Formula)</label>
                    <input 
                      type="text" name="generic_name" value={form.generic_name || ''} onChange={handleChange}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Category</label>
                    <div className="relative">
                      <Tag size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <select 
                        name="category" 
                        value={form.category || ''} 
                        onChange={handleChange}
                        className="w-full pl-9 pr-8 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all appearance-none cursor-pointer"
                      >
                        <option value="" className="bg-bg text-muted">Select Category</option>
                        <option value="Allopathy" className="bg-bg text-text">Allopathy</option>
                        <option value="Homeopathy" className="bg-bg text-text">Homeopathy</option>
                        <option value="Ayurvedic" className="bg-bg text-text">Ayurvedic</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                    </div>
                  </div>

                  {/* Manufacturers & Codes integrated here */}
                  <div className="relative">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Manufacturer</label>
                    <input 
                      type="text" 
                      name="manufacturer" 
                      value={form.manufacturer || ''} 
                      onChange={(e) => handleMfgChange(e.target.value)}
                      onFocus={(e) => handleMfgFocus(e.target.value)}
                      onBlur={() => setTimeout(() => setShowMfgSuggestions(false), 200)}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all font-medium"
                    />
                    {showMfgSuggestions && mfgSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown text-left">
                        {mfgSuggestions.map((mfgName, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setForm((prev: any) => ({ ...prev, manufacturer: mfgName }))}
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

                  <div className="relative">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Marketed By</label>
                    <input 
                      type="text" 
                      name="marketed_by" 
                      value={form.marketed_by || ''} 
                      onChange={(e) => handleMrkChange(e.target.value)}
                      onFocus={(e) => handleMrkFocus(e.target.value)}
                      onBlur={() => setTimeout(() => setShowMrkSuggestions(false), 200)}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all font-medium"
                    />
                    {showMrkSuggestions && mrkSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown text-left">
                        {mrkSuggestions.map((mrkName, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setForm((prev: any) => ({ ...prev, marketed_by: mrkName }))}
                            className="w-full text-left px-3 py-2 hover:bg-white/10 text-text border-b border-glass-border/10 last:border-0 flex items-center justify-between text-xs"
                          >
                            <span className="truncate pr-2 font-medium">{mrkName}</span>
                            <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0">
                              In Database
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Barcode / Item Code</label>
                    <div className="relative">
                      <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input 
                        type="text" name="item_code" value={form.item_code || ''} onChange={handleChange}
                        className="w-full pl-9 pr-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">HSN Code</label>
                    <div className="relative">
                      <Tag size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input 
                        type="text" name="hsn_code" value={form.hsn_code || ''} onChange={handleChange}
                        className="w-full pl-9 pr-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                        placeholder="e.g. 30049099"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Section 2: Inventory & Stock Location */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Database size={16} className="text-emerald-500" /> Inventory & Stock Info
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {inventoryId ? (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-emerald-500/80 mb-1.5">Primary Batch Quantity</label>
                        <input 
                          type="number" name="quantity" value={form.quantity} onChange={handleChange}
                          className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-emerald-500 focus:outline-none transition-all font-mono font-bold"
                        />
                        <p className="text-[10px] text-muted mt-1.5">Total stock across all batches: <strong>{totalStock}</strong></p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-emerald-500/80 mb-1.5">Rack Location</label>
                        <div className="relative">
                          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                          <input 
                            type="text" name="rack_location" value={form.rack_location} onChange={handleChange}
                            className="w-full pl-9 pr-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-emerald-500 focus:outline-none transition-all uppercase font-medium"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-2 p-4 rounded-xl bg-bg2 border border-glass-border text-center text-sm text-muted">
                      No physical inventory stock recorded for this medicine yet.
                    </div>
                  )}
                  
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Additional Notes</label>
                    <textarea 
                      name="api_reference" 
                      value={form.api_reference || ''} 
                      onChange={handleChange}
                      rows={3}
                      placeholder="Composition details, storage instructions, or general notes..."
                      className="w-full px-4 py-3 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all resize-none"
                    />
                  </div>
                </div>
              </section>

            </form>
          )}
          </div> {/* end p-6 form area */}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-glass-border bg-bg3 flex justify-end gap-3 shrink-0">
          <button 
            type="button" 
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-glass-border hover:bg-bg2 text-muted hover:text-text font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            form="quick-edit-form"
            disabled={saving || loading}
            className="px-6 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold transition-colors flex items-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Universal Changes'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};

export const UniversalMedicineEditModal = memo(UniversalMedicineEditModalInner);
