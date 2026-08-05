import React, { useState, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Save, RefreshCw, AlertTriangle, Pill, Package, Factory, 
  Barcode, Tag, MapPin, Database, ChevronDown, Eye, Shield, 
  Percent, FileText, Settings, Sparkles, Check
} from 'lucide-react';
import { api } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../utils/cacheInvalidation';

export const updateMedicineNameWithPackSize = (currentName: string, newPackaging: string, oldPackaging?: string): string => {
  if (!currentName) return '';
  const trimmedName = currentName.trim();
  const trimmedNewPkg = newPackaging.trim();

  if (!trimmedNewPkg) return trimmedName;

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

  const commonTypes = ['TAB', 'CAP', 'STRIP', 'SUSPENSION', 'BOTTLE', 'VIAL', 'AMP', 'GEL', 'CREAM', 'INJ', 'OINT', 'SYP', 'SUSP', 'LIQ', 'DROP', 'DROPS', 'RESPULE', 'SACHET'];
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

  if (cleanPkg === 'STRIP OF 10 TAB' || cleanPkg === '10 TAB') return '10_TAB';
  if (cleanPkg === 'STRIP OF 15 TAB' || cleanPkg === '15 TAB') return '15_TAB';
  if (cleanPkg === 'STRIP OF 4 TAB' || cleanPkg === '4 TAB') return '4_TAB';
  if (cleanPkg === '1 TAB') return '1_TAB';
  if (cleanPkg === '30 TAB') return '30_TAB';

  if (cleanPkg === 'STRIP OF 10 CAP' || cleanPkg === '10 CAP') return '10_CAP';
  if (cleanPkg === 'STRIP OF 15 CAP' || cleanPkg === '15 CAP') return '15_CAP';
  if (cleanPkg === 'STRIP OF 4 CAP' || cleanPkg === '4 CAP') return '4_CAP';
  if (cleanPkg === '1 CAP') return '1_CAP';
  if (cleanPkg === '30 CAP') return '30_CAP';

  if (cleanPkg === 'BOTTLE OF 30ML' || cleanPkg === '30 ML') return '30_ML';
  if (cleanPkg === 'BOTTLE OF 60ML' || cleanPkg === '60 ML') return '60_ML';
  if (cleanPkg === 'BOTTLE OF 100ML' || cleanPkg === '100 ML') return '100_ML';
  if (cleanPkg === 'BOTTLE OF 200ML' || cleanPkg === '200 ML') return '200_ML';

  if (cleanPkg === '1 VIAL') return '1_VIAL';
  if (cleanPkg === '1 AMP') return '1_AMP';
  if (cleanPkg === '1 TUBE') return '1_TUBE';

  return 'CUSTOM';
};

const getPackagingString = (preset: string, packType: string, customVal: string): string => {
  if (preset === 'CUSTOM') return customVal;
  if (preset === '10_TAB') return 'STRIP OF 10 TAB';
  if (preset === '15_TAB') return 'STRIP OF 15 TAB';
  if (preset === '4_TAB') return 'STRIP OF 4 TAB';
  if (preset === '1_TAB') return '1 TAB';
  if (preset === '30_TAB') return '30 TAB';

  if (preset === '10_CAP') return 'STRIP OF 10 CAP';
  if (preset === '15_CAP') return 'STRIP OF 15 CAP';
  if (preset === '4_CAP') return 'STRIP OF 4 CAP';
  if (preset === '1_CAP') return '1 CAP';
  if (preset === '30_CAP') return '30 CAP';

  if (preset === '30_ML') return 'BOTTLE OF 30ML';
  if (preset === '60_ML') return 'BOTTLE OF 60ML';
  if (preset === '100_ML') return 'BOTTLE OF 100ML';
  if (preset === '200_ML') return 'BOTTLE OF 200ML';

  if (preset === '1_VIAL') return '1 VIAL';
  if (preset === '1_AMP') return '1 AMP';
  if (preset === '1_TUBE') return '1 TUBE';

  const [num, unit] = preset.split('_');
  if (num && unit) return `${num} ${unit}`;

  return customVal;
};

const THERAPEUTIC_CLASSES = [
  'Analgesic / Antipyretic',
  'Antibiotic / Anti-infective',
  'Antihypertensive',
  'Antidiabetic',
  'Antacid / Anti-ulcer',
  'Antihistamine / Anti-allergic',
  'Bronchodilator / Respiratory',
  'Cardiovascular',
  'Dermatological',
  'Gastrointestinal',
  'Neurological / Neuroprotective',
  'Ophthalmic',
  'Psychiatric / Anti-anxiety',
  'Vitamin / Mineral Supplement',
  'Other / Unclassified'
];

interface Props {
  medicineId: number;
  initialData?: any;
  ocrData?: {
    potentialName?: string;
    genericName?: string;
    strength?: string;
    manufacturer?: string;
    packaging?: string;
    dosageForm?: string;
    mrp?: number;
    batchNumber?: string;
    expiryDate?: string;
  };
  onClose: () => void;
  onSave: () => void;
}

type TabType = 'basic' | 'classification' | 'codes' | 'tax' | 'stock' | 'substitutes';

const UniversalMedicineEditModalInner: React.FC<Props> = ({ medicineId, initialData, ocrData, onClose, onSave }) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any>(() => {
    if (!initialData) return {};
    const nameVal = initialData.name || '';
    const packagingVal = initialData.packaging || '';
    return {
      name: ocrData?.potentialName || nameVal,
      item_type: ocrData?.dosageForm || initialData.item_type || 'TABLET',
      category: initialData.category || 'Allopathy',
      pack_unit: initialData.pack_unit || 'TAB',
      packaging: ocrData?.packaging || packagingVal,
      pack_size: initialData.pack_size || 10,
      therapeutic: initialData.therapeutic || '',
      sub_therapeutic: initialData.sub_therapeutic || '',
      schedule_type: initialData.schedule_type || 'None',
      generic_name: ocrData?.genericName || initialData.generic_name || '',
      manufacturer: ocrData?.manufacturer || initialData.manufacturer || '',
      marketed_by: initialData.marketed_by || '',
      item_code: initialData.item_code || '',
      short_code: initialData.short_code || '',
      ucode: initialData.ucode || '',
      hsn_code: initialData.hsn_code || '',
      cgst_per: initialData.cgst_per ?? 6,
      sgst_per: initialData.sgst_per ?? 6,
      igst_per: initialData.igst_per ?? 12,
      api_reference: initialData.api_reference || '',
      quantity: initialData.quantity || 0,
      reorder_level: initialData.reorder_level ?? 10,
      max_stock_level: initialData.max_stock_level ?? 500,
      rack_location: initialData.rack_location || initialData.rack || '',
      is_loose: false,
      disable_auto_barcode: !!initialData.disable_auto_barcode,
      tb_medicine: !!initialData.tb_medicine,
    };
  });
  const [inventoryId, setInventoryId] = useState<number | null>(null);
  const [totalStock, setTotalStock] = useState<number>(initialData?.quantity || 0);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);
  const [mrkSuggestions, setMrkSuggestions] = useState<string[]>([]);
  const [showMrkSuggestions, setShowMrkSuggestions] = useState(false);

  const [baseName, setBaseName] = useState(() => {
    if (!initialData) return '';
    return splitMedicineName(initialData.name || '', initialData.packaging || '').baseName;
  });
  const [packType, setPackType] = useState(() => {
    if (!initialData) return 'TAB';
    return splitMedicineName(initialData.name || '', initialData.packaging || '').packType;
  });
  const [packQtyUnit, setPackQtyUnit] = useState(() => {
    if (!initialData) return '10_TAB';
    const parsed = splitMedicineName(initialData.name || '', initialData.packaging || '');
    return getMatchingPreset(initialData.packaging || '', parsed.packType);
  });
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
    if (!initialData) {
      setLoading(true);
    }
    api.getQuickEditMedicine(medicineId)
      .then((data: any) => {
        if (data && data.medicine) {
          const med = data.medicine;
          const nameVal = med.name || '';
          const packagingVal = med.packaging || '';
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

          let isLooseVal = false;
          if (med.metadata) {
            try {
              const meta = typeof med.metadata === 'string' ? JSON.parse(med.metadata) : med.metadata;
              isLooseVal = !!meta.is_loose;
            } catch (_) {}
          }

          const initialForm = {
            name: ocrData?.potentialName || nameVal,
            item_type: ocrData?.dosageForm || med.item_type || 'TABLET',
            category: med.category || 'Allopathy',
            pack_unit: med.pack_unit || 'TAB',
            packaging: ocrData?.packaging || packagingVal,
            pack_size: med.pack_size || 10,
            therapeutic: med.therapeutic || '',
            sub_therapeutic: med.sub_therapeutic || '',
            schedule_type: med.schedule_type || 'None',
            generic_name: ocrData?.genericName || med.generic_name || '',
            manufacturer: ocrData?.manufacturer || med.manufacturer || '',
            marketed_by: med.marketed_by || '',
            item_code: med.item_code || '',
            short_code: med.short_code || '',
            ucode: med.ucode || '',
            hsn_code: med.hsn_code || '',
            cgst_per: med.cgst_per ?? 6,
            sgst_per: med.sgst_per ?? 6,
            igst_per: med.igst_per ?? 12,
            api_reference: med.api_reference || '',
            quantity: data.inventory?.quantity || 0,
            reorder_level: data.inventory?.reorder_level ?? 10,
            max_stock_level: med.max_stock_level ?? 500,
            rack_location: data.inventory?.rack_location || med.rack || '',
            is_loose: isLooseVal,
            disable_auto_barcode: !!med.disable_auto_barcode,
            tb_medicine: !!med.tb_medicine,
          };
          setForm(initialForm);
          setInventoryId(data.inventory?.inventory_id || null);
          setTotalStock(data.total_stock || 0);
          setIsManualName(false);
        } else if (!initialData) {
          setError("Failed to load medicine details.");
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        if (!initialData) {
          setError("Failed to load medicine details.");
        }
        setLoading(false);
      });
  }, [medicineId]);

  useEffect(() => {
    if (!medicineId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [medicineId, onClose]);

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
    const { name, value, type } = e.target as any;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setForm((prev: any) => ({
      ...prev,
      [name]: name === 'quantity' || name === 'reorder_level' || name === 'max_stock_level'
        ? (parseInt(value, 10) || 0)
        : name === 'cgst_per' || name === 'sgst_per' || name === 'igst_per'
        ? (parseFloat(value) || 0)
        : val
    }));
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsManualName(true);
    setForm((prev: any) => ({ ...prev, name: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const metadataObj = {
        is_loose: !!form.is_loose
      };

      await api.updateQuickEditMedicine(medicineId, {
        ...form,
        inventory_id: inventoryId,
        metadata: JSON.stringify(metadataObj)
      });

      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});

      setSaving(false);
      onSave();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError("Failed to save 26-field medicine updates.");
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-3 sm:p-5 fade-in">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      <div className="relative bg-bg border border-glass-border rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden slide-up">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-glass-border bg-bg3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <Pill size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-text leading-tight">Universal Medicine Editor</h3>
                <span className="bg-primary/15 text-primary text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border border-primary/30">
                  26 Fields
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">Medicine ID #{medicineId} • Form-Aware Packaging & Regulatory Compliance</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-bg2 text-muted hover:text-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Live Preview Banner */}
        {!loading && (
          <div className="bg-bg2 border-b border-glass-border px-5 py-3 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-emerald-400" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">Live Preview — Compiled Medicine Name</span>
              </div>
              {isManualName ? (
                <button
                  type="button"
                  onClick={() => setIsManualName(false)}
                  className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-bold"
                >
                  ✏ Manual Override (Click to Re-sync)
                </button>
              ) : (
                <span className="text-[10px] text-emerald-400/80 font-medium">Auto-sync active</span>
              )}
            </div>
            <p className="text-lg font-black text-text tracking-tight break-words">
              {form.name || <span className="text-muted italic font-normal text-sm">Enter base name...</span>}
            </p>
          </div>
        )}

        {/* Tab Navigation Header */}
        <div className="flex overflow-x-auto border-b border-glass-border bg-bg3 px-4 shrink-0 scrollbar-none">
          {[
            { id: 'basic', label: 'Basic Info', icon: Pill },
            { id: 'classification', label: 'Classification & H1', icon: Shield },
            { id: 'codes', label: 'Manufacturer & Codes', icon: Barcode },
            { id: 'tax', label: 'Tax & Pricing', icon: Percent },
            { id: 'stock', label: 'Stock & Location', icon: Database },
            { id: 'substitutes', label: 'Options & Substitutes', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 font-bold text-xs whitespace-nowrap transition-all ${
                  isActive 
                    ? 'border-primary text-primary bg-primary/10' 
                    : 'border-transparent text-muted hover:text-text hover:bg-bg2'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 scrollbar-custom">
          {error && (
            <div className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 text-red-400 text-sm">
              <AlertTriangle className="shrink-0 mt-0.5" size={18} />
              <p>{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted">
              <RefreshCw size={32} className="animate-spin mb-3 text-primary" />
              <p className="text-sm font-medium">Hydrating 26 medicine fields...</p>
            </div>
          ) : (
            <form id="universal-edit-form" onSubmit={handleSubmit} className="space-y-6">
              
              {/* TAB 1: BASIC INFO */}
              {activeTab === 'basic' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Base Name & Strength *</label>
                      <input 
                        type="text" 
                        required 
                        value={baseName} 
                        onChange={(e) => setBaseName(e.target.value)}
                        placeholder="e.g. PAN 40MG"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-bold focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Item Type / Dosage Form</label>
                      <select 
                        name="item_type" 
                        value={form.item_type || 'TABLET'} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      >
                        <option value="TABLET">TABLET (Solid oral dosage)</option>
                        <option value="CAPSULE">CAPSULE (Gelatin/Vegetable)</option>
                        <option value="SYRUP">SYRUP / SUSPENSION (Liquid)</option>
                        <option value="INJECTION">INJECTION (Ampoule/Vial)</option>
                        <option value="CREAM">CREAM / OINTMENT (Topical)</option>
                        <option value="DROPS">DROPS (Eye/Ear/Pediatric)</option>
                        <option value="POWDER">POWDER / SACHET</option>
                        <option value="DEVICE">MEDICAL DEVICE / CONSUMABLE</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Form Suffix Type</label>
                      <select 
                        value={packType} 
                        onChange={(e) => setPackType(e.target.value)}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      >
                        <option value="TAB">TAB (Tablet)</option>
                        <option value="CAP">CAP (Capsule)</option>
                        <option value="STRIP">STRIP (Strip)</option>
                        <option value="SUSPENSION">SUSPENSION (Liquid)</option>
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
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Form-Aware Packaging Preset</label>
                      <select 
                        value={packQtyUnit} 
                        onChange={(e) => setPackQtyUnit(e.target.value)}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      >
                        <optgroup label="── Tablet / Capsule Strips">
                          <option value="10_TAB">STRIP OF 10 TAB</option>
                          <option value="15_TAB">STRIP OF 15 TAB</option>
                          <option value="4_TAB">STRIP OF 4 TAB</option>
                          <option value="1_TAB">1 TAB</option>
                          <option value="30_TAB">30 TAB</option>
                          <option value="10_CAP">STRIP OF 10 CAP</option>
                          <option value="15_CAP">STRIP OF 15 CAP</option>
                        </optgroup>
                        <optgroup label="── Liquids & Syrups">
                          <option value="30_ML">BOTTLE OF 30ML</option>
                          <option value="60_ML">BOTTLE OF 60ML</option>
                          <option value="100_ML">BOTTLE OF 100ML</option>
                          <option value="200_ML">BOTTLE OF 200ML</option>
                        </optgroup>
                        <optgroup label="── Injections & Topicals">
                          <option value="1_VIAL">1 VIAL</option>
                          <option value="1_AMP">1 AMP</option>
                          <option value="1_TUBE">1 TUBE</option>
                          <option value="CUSTOM">Custom Packaging String...</option>
                        </optgroup>
                      </select>
                    </div>

                    {packQtyUnit === 'CUSTOM' && (
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-muted mb-1.5">Custom Packaging Description</label>
                        <input 
                          type="text" 
                          value={customPackaging} 
                          onChange={(e) => setCustomPackaging(e.target.value)}
                          placeholder="e.g. BOTTLE OF 150ML or BOX OF 5 AMP"
                          className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-bold focus:border-primary focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Category</label>
                      <select 
                        name="category" 
                        value={form.category || 'Allopathy'} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      >
                        <option value="Allopathy">Allopathy</option>
                        <option value="Ayurvedic">Ayurvedic</option>
                        <option value="Homeopathy">Homeopathy</option>
                        <option value="General Health">General Health</option>
                        <option value="Surgical">Surgical</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Units Per Strip / Pack Size</label>
                      <input 
                        type="number" 
                        name="pack_size" 
                        value={form.pack_size || 10} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CLASSIFICATION & H1 */}
              {activeTab === 'classification' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Therapeutic Class</label>
                      <select 
                        name="therapeutic" 
                        value={form.therapeutic || ''} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      >
                        <option value="">Select Therapeutic Class...</option>
                        {THERAPEUTIC_CLASSES.map((cls) => (
                          <option key={cls} value={cls}>{cls}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Sub-Therapeutic Class</label>
                      <input 
                        type="text" 
                        name="sub_therapeutic" 
                        value={form.sub_therapeutic || ''} 
                        onChange={handleChange}
                        placeholder="e.g. NSAID, Fluoroquinolone, ACE Inhibitor"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Regulatory Schedule Type *</label>
                      <select 
                        name="schedule_type" 
                        value={form.schedule_type || 'None'} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-bold focus:border-primary focus:outline-none"
                      >
                        <option value="None">None (Unrestricted / OTC)</option>
                        <option value="Schedule H">Schedule H (Prescription Drug)</option>
                        <option value="Schedule H1">Schedule H1 (Restricted Antibiotic / Narcotic)</option>
                        <option value="Schedule X">Schedule X (Strict Narcotic Logged)</option>
                        <option value="Schedule G">Schedule G (Medical Supervision)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Generic Name / Composition (Salts)</label>
                      <input 
                        type="text" 
                        name="generic_name" 
                        value={form.generic_name || ''} 
                        onChange={handleChange}
                        placeholder="e.g. Paracetamol 500mg + Aceclofenac 100mg"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  {form.schedule_type === 'Schedule H1' && (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs space-y-1">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <Shield size={16} /> Schedule H1 Regulatory Notice
                      </div>
                      <p>
                        Selling this medicine will automatically require Doctor Assignment in POS and populate the H1 Compliance Register for statutory Drug Inspector audits.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: MANUFACTURER & CODES */}
              {activeTab === 'codes' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="block text-xs font-semibold text-muted mb-1.5">Manufacturer</label>
                      <input 
                        type="text" 
                        name="manufacturer" 
                        value={form.manufacturer || ''} 
                        onChange={(e) => handleMfgChange(e.target.value)}
                        onFocus={(e) => handleMfgFocus(e.target.value)}
                        onBlur={() => setTimeout(() => setShowMfgSuggestions(false), 200)}
                        placeholder="e.g. Sun Pharmaceutical Industries"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      />
                      {showMfgSuggestions && mfgSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown">
                          {mfgSuggestions.map((mfgName, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setForm((prev: any) => ({ ...prev, manufacturer: mfgName }))}
                              className="w-full text-left px-3 py-2 hover:bg-primary/20 text-text border-b border-glass-border/10 text-xs font-medium"
                            >
                              {mfgName}
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
                        placeholder="e.g. Cipla Ltd"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-medium focus:border-primary focus:outline-none"
                      />
                      {showMrkSuggestions && mrkSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-bg2 border border-glass-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-dropdown">
                          {mrkSuggestions.map((mrkName, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setForm((prev: any) => ({ ...prev, marketed_by: mrkName }))}
                              className="w-full text-left px-3 py-2 hover:bg-primary/20 text-text border-b border-glass-border/10 text-xs font-medium"
                            >
                              {mrkName}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Medicine Barcode / EAN Code</label>
                      <input 
                        type="text" 
                        name="item_code" 
                        value={form.item_code || ''} 
                        onChange={handleChange}
                        placeholder="e.g. 8901234567890"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-medium focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Short Search Code</label>
                      <input 
                        type="text" 
                        name="short_code" 
                        value={form.short_code || ''} 
                        onChange={handleChange}
                        placeholder="e.g. PAN40"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold uppercase focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Universal Integration UCode</label>
                      <input 
                        type="text" 
                        name="ucode" 
                        value={form.ucode || ''} 
                        onChange={handleChange}
                        placeholder="e.g. UC-9921"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">HSN Code</label>
                      <input 
                        type="text" 
                        name="hsn_code" 
                        value={form.hsn_code || ''} 
                        onChange={handleChange}
                        placeholder="e.g. 30049099"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: TAX & PRICING */}
              {activeTab === 'tax' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">CGST %</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        name="cgst_per" 
                        value={form.cgst_per ?? 6} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">SGST %</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        name="sgst_per" 
                        value={form.sgst_per ?? 6} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">IGST %</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        name="igst_per" 
                        value={form.igst_per ?? 12} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-bg2 border border-glass-border flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-text">Standard GST Tax Rate Applied</p>
                      <p className="text-[11px] text-muted">Total Tax: {((form.cgst_per || 0) + (form.sgst_per || 0))}% (CGST + SGST)</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((prev: any) => ({ ...prev, hsn_code: '30049099', cgst_per: 6, sgst_per: 6, igst_per: 12 }))}
                      className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-bold border border-primary/30 hover:bg-primary/25 transition-colors"
                    >
                      Reset Standard 12% Pharma HSN
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: STOCK & LOCATION */}
              {activeTab === 'stock' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Current Physical Stock Qty (Strips/Units)</label>
                      <input 
                        type="number" 
                        name="quantity" 
                        value={form.quantity || 0} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-extrabold focus:border-emerald-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-muted mt-1">Total aggregated stock across all batches: {totalStock}</p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Rack Location / Shelf Code</label>
                      <input 
                        type="text" 
                        name="rack_location" 
                        value={form.rack_location || ''} 
                        onChange={handleChange}
                        placeholder="e.g. RACK-A-12"
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold uppercase focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Minimum Stock Reorder Level</label>
                      <input 
                        type="number" 
                        name="reorder_level" 
                        value={form.reorder_level ?? 10} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1.5">Maximum Stock Ceiling</label>
                      <input 
                        type="number" 
                        name="max_stock_level" 
                        value={form.max_stock_level ?? 500} 
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-bg3 border border-glass-border flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-text">Allow Loose Unit Sales (Fractional Strips)</p>
                      <p className="text-[11px] text-muted">Pharmacists can break strips to sell individual tablets in POS.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        name="is_loose" 
                        checked={!!form.is_loose} 
                        onChange={handleChange}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-bg2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 6: OPTIONS & SUBSTITUTES */}
              {activeTab === 'substitutes' && (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-bg3 border border-glass-border space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-text">Disable Automatic Barcode Generation</p>
                        <p className="text-[11px] text-muted">Prevent system from auto-printing barcodes during receiving.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          name="disable_auto_barcode" 
                          checked={!!form.disable_auto_barcode} 
                          onChange={handleChange}
                          className="sr-only peer" 
                        />
                        <div className="w-11 h-6 bg-bg2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                      </label>
                    </div>

                    <div className="border-t border-glass-border pt-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-text">Tuberculosis (TB) Restricted Drug Flag</p>
                        <p className="text-[11px] text-muted">Logs sales for state government TB health department reports.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          name="tb_medicine" 
                          checked={!!form.tb_medicine} 
                          onChange={handleChange}
                          className="sr-only peer" 
                        />
                        <div className="w-11 h-6 bg-bg2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Additional Storage & Clinical Notes</label>
                    <textarea 
                      name="api_reference" 
                      value={form.api_reference || ''} 
                      onChange={handleChange}
                      rows={3}
                      placeholder="Storage temperature, clinical contraindications, or distributor remarks..."
                      className="w-full px-4 py-3 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}

            </form>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-glass-border bg-bg3 flex justify-end gap-3 shrink-0">
          <button 
            type="button" 
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-glass-border hover:bg-bg2 text-muted hover:text-text font-medium transition-colors text-xs"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            form="universal-edit-form"
            disabled={saving || loading}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold transition-colors flex items-center gap-2 text-xs shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving 26 Fields...' : 'Save Universal Changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const UniversalMedicineEditModal = memo(UniversalMedicineEditModalInner);
