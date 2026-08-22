import React, { useState, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Save, RefreshCw, AlertTriangle, Pill, Barcode, Tag, Database, Eye, Shield, 
  Percent, Settings, Trash2, History
} from 'lucide-react';
import { api, type HistoryPrefillResult } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../utils/cacheInvalidation';
import { toastEvent } from '../services/events';

export const parsePackSizeFromPackaging = (packaging: string | null | undefined): number | null => {
  if (!packaging) return null;
  const trimmed = packaging.trim();
  const stripOfMatch = trimmed.match(/^\s*(?:STRIP|PACK|BOX|BLISTER)\s+OF\s+(\d+)/i);
  if (stripOfMatch) {
    const size = parseInt(stripOfMatch[1], 10);
    if (size > 0) return size;
  }
  const bottleOfMatch = trimmed.match(/^\s*BOTTLE\s+OF\s+(\d+)/i);
  if (bottleOfMatch) {
    const size = parseInt(bottleOfMatch[1], 10);
    if (size > 0) return size;
  }
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }
  const match = trimmed.match(/^(\d+)/);
  if (match) {
    const size = parseInt(match[1], 10);
    if (size > 0) return size;
  }
  return null;
};

const splitMedicineName = (name: string, packaging: string) => {
  const trimmedName = name.trim();
  const trimmedPkg = packaging.trim();

  let nameWithoutPkg = trimmedName;
  if (trimmedPkg && trimmedName.toLowerCase().endsWith(trimmedPkg.toLowerCase())) {
    nameWithoutPkg = trimmedName.substring(0, trimmedName.toLowerCase().lastIndexOf(trimmedPkg.toLowerCase())).trim();
  } else {
    const packPatternRegex = /\b(\d+(?:x\d+)?)\s*([a-zA-Z'â€™]+)?\s*$/i;
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

const getMatchingPreset = (packaging: string, _packType: string): string => {
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

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

interface LocalUniversalMedicineSeed {
  name?: string;
  packaging?: string;
  mrp?: number | string | null;
  rate?: number | string | null;
  sell_price?: number | string | null;
  item_type?: string;
  category?: string;
  pack_unit?: string;
  pack_size?: number | null;
  therapeutic?: string;
  sub_therapeutic?: string;
  schedule_type?: string;
  generic_name?: string;
  manufacturer?: string;
  marketed_by?: string;
  item_code?: string;
  short_code?: string;
  ucode?: string;
  hsn_code?: string;
  cgst_per?: number | null;
  sgst_per?: number | null;
  igst_per?: number | null;
  api_reference?: string;
  quantity?: number | null;
  reorder_level?: number | null;
  max_stock_level?: number | null;
  rack_location?: string;
  rack?: string;
  is_loose?: boolean | number | null;
  allow_loose_sale?: boolean | number | null;
  disable_auto_barcode?: boolean | number | null;
  tb_medicine?: boolean | number | null;
}

interface LocalUniversalMedicineForm {
  name: string;
  item_type: string;
  category: string;
  pack_unit: string;
  packaging: string;
  pack_size: number;
  therapeutic: string;
  sub_therapeutic: string;
  schedule_type: string;
  generic_name: string;
  manufacturer: string;
  marketed_by: string;
  item_code: string;
  short_code: string;
  ucode: string;
  hsn_code: string;
  cgst_per: number;
  sgst_per: number;
  igst_per: number;
  api_reference: string;
  mrp: number | string;
  rate: number | string;
  sell_price: number | string;
  quantity: number;
  reorder_level: number;
  max_stock_level: number;
  rack_location: string;
  is_loose: boolean;
  allow_loose_sale: number;
  disable_auto_barcode: boolean;
  tb_medicine: boolean;
}

interface LocalQuickEditResponse {
  medicine: {
    name?: string;
    packaging?: string;
    metadata?: string | Record<string, unknown>;
    item_type?: string;
    category?: string;
    pack_unit?: string;
    pack_size?: number | null;
    therapeutic?: string;
    sub_therapeutic?: string;
    schedule_type?: string;
    generic_name?: string;
    manufacturer?: string;
    marketed_by?: string;
    item_code?: string;
    short_code?: string;
    ucode?: string;
    hsn_code?: string;
    cgst_per?: number | null;
    sgst_per?: number | null;
    igst_per?: number | null;
    api_reference?: string;
    mrp?: number | null;
    rate?: number | null;
    sell_price?: number | null;
    max_stock_level?: number | null;
    rack?: string;
    allow_loose_sale?: number | boolean | null;
    disable_auto_barcode?: boolean | number | null;
    tb_medicine?: boolean | number | null;
  };
  inventory?: {
    inventory_id?: number;
    quantity?: number | null;
    reorder_level?: number | null;
    rack_location?: string;
  } | null;
  total_stock?: number;
}

interface LocalSavedMedicine {
  id?: number;
  name: string;
  generic_name: string;
  manufacturer: string;
  pack_unit: string;
  pack_size: number | string;
  hsn_code?: string;
  strength?: string;
  cgst_per?: number;
  sgst_per?: number;
  sell_price?: number | string | null;
  mrp: number & string;
  rate: number & string;
}

export interface UniversalMedicineEditModalProps {
  medicineId?: number | null;
  mode?: 'create' | 'edit';
  initialData?: LocalUniversalMedicineSeed | null;
  ocrData?: {
    potentialName?: string;
    genericName?: string;
    strength?: string;
    manufacturer?: string;
    packaging?: string;
    dosageForm?: string;
    mrp?: number;
    rate?: number;
    sell_price?: number;
    batchNumber?: string;
    expiryDate?: string;
    hsn_code?: string;
    cgst_per?: number;
    sgst_per?: number;
  } | null;
  onClose: () => void;
  onSave?: (savedMedicine?: LocalSavedMedicine) => void;
  onDelete?: (deletedMedicineId: number) => void;
}

type TabType = 'basic' | 'classification' | 'codes' | 'tax' | 'stock' | 'substitutes';

const UniversalMedicineEditModalInner: React.FC<UniversalMedicineEditModalProps> = ({ 
  medicineId, 
  mode, 
  initialData, 
  ocrData, 
  onClose, 
  onSave, 
  onDelete 
}) => {
  const queryClient = useQueryClient();
  const isCreateMode = mode === 'create' || !medicineId || medicineId <= 0;

  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [loading, setLoading] = useState(!isCreateMode && !initialData);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyPrefill, setHistoryPrefill] = useState<HistoryPrefillResult | null>(null);
  const [prefillDismissed, setPrefillDismissed] = useState(false);

  const [form, setForm] = useState<LocalUniversalMedicineForm>(() => {
    const nameVal = initialData?.name || '';
    const packagingVal = initialData?.packaging || (isCreateMode ? '10 TAB' : '');
    const mrpVal = ocrData?.mrp ?? initialData?.mrp ?? '';
    const rateVal = ocrData?.rate ?? initialData?.rate ?? '';
    const sellPriceVal = ocrData?.sell_price ?? initialData?.sell_price ?? (mrpVal !== '' ? mrpVal : '');

    return {
      name: ocrData?.potentialName || nameVal,
      item_type: ocrData?.dosageForm || initialData?.item_type || 'TABLET',
      category: initialData?.category || 'Allopathy',
      pack_unit: initialData?.pack_unit || 'TAB',
      packaging: ocrData?.packaging || packagingVal,
      pack_size: initialData?.pack_size ?? (parsePackSizeFromPackaging(ocrData?.packaging || packagingVal) || 1),
      therapeutic: initialData?.therapeutic || '',
      sub_therapeutic: initialData?.sub_therapeutic || '',
      schedule_type: initialData?.schedule_type || 'None',
      generic_name: ocrData?.genericName || initialData?.generic_name || '',
      manufacturer: ocrData?.manufacturer || initialData?.manufacturer || '',
      marketed_by: initialData?.marketed_by || '',
      item_code: initialData?.item_code || '',
      short_code: initialData?.short_code || '',
      ucode: initialData?.ucode || '',
      hsn_code: ocrData?.hsn_code || initialData?.hsn_code || '',
      cgst_per: ocrData?.cgst_per ?? initialData?.cgst_per ?? 6,
      sgst_per: ocrData?.sgst_per ?? initialData?.sgst_per ?? 6,
      igst_per: initialData?.igst_per ?? 12,
      api_reference: initialData?.api_reference || '',
      mrp: mrpVal,
      rate: rateVal,
      sell_price: sellPriceVal,
      quantity: initialData?.quantity || 0,
      reorder_level: initialData?.reorder_level ?? 10,
      max_stock_level: initialData?.max_stock_level ?? 500,
      rack_location: initialData?.rack_location || initialData?.rack || '',
      is_loose: !!initialData?.is_loose,
      allow_loose_sale: initialData?.allow_loose_sale !== undefined ? (initialData.allow_loose_sale ? 1 : 0) : 1,
      disable_auto_barcode: !!initialData?.disable_auto_barcode,
      tb_medicine: !!initialData?.tb_medicine,
    };
  });

  const [inventoryId, setInventoryId] = useState<number | null>(null);
  const [totalStock, setTotalStock] = useState<number>(initialData?.quantity || 0);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);
  const [mrkSuggestions, setMrkSuggestions] = useState<string[]>([]);
  const [showMrkSuggestions, setShowMrkSuggestions] = useState(false);

  const [baseName, setBaseName] = useState(() => {
    const rawInitName = ocrData?.potentialName || initialData?.name || '';
    const rawInitPkg = ocrData?.packaging || initialData?.packaging || (isCreateMode ? '10 TAB' : '');
    return splitMedicineName(rawInitName, rawInitPkg).baseName;
  });
  const [packType, setPackType] = useState(() => {
    const rawInitName = ocrData?.potentialName || initialData?.name || '';
    const rawInitPkg = ocrData?.packaging || initialData?.packaging || (isCreateMode ? '10 TAB' : '');
    return splitMedicineName(rawInitName, rawInitPkg).packType;
  });
  const [packQtyUnit, setPackQtyUnit] = useState(() => {
    const rawInitName = ocrData?.potentialName || initialData?.name || '';
    const rawInitPkg = ocrData?.packaging || initialData?.packaging || (isCreateMode ? '10 TAB' : '');
    const parsed = splitMedicineName(rawInitName, rawInitPkg);
    return getMatchingPreset(rawInitPkg, parsed.packType);
  });
  const [customPackaging, setCustomPackaging] = useState('');
  const [isManualName, setIsManualName] = useState(false);

  const handleMfgChange = async (val: string) => {
    setForm(prev => ({ ...prev, manufacturer: val }));
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
    setForm(prev => ({ ...prev, marketed_by: val }));
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
    if (isCreateMode || !medicineId) {
      setLoading(false);
      return;
    }
    if (!initialData) {
      setLoading(true);
    }
    api.getQuickEditMedicine(medicineId)
      .then((data: LocalQuickEditResponse) => {
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
            pack_size: med.pack_size ?? (parsePackSizeFromPackaging(packagingVal) || 1),
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
            mrp: med.mrp || 0,
            rate: med.rate || 0,
            sell_price: med.sell_price !== null && med.sell_price !== undefined ? med.sell_price : '',
            quantity: data.inventory?.quantity || 0,
            reorder_level: data.inventory?.reorder_level ?? 10,
            max_stock_level: med.max_stock_level ?? 500,
            rack_location: data.inventory?.rack_location || med.rack || '',
            is_loose: med.allow_loose_sale !== undefined ? !!med.allow_loose_sale : isLooseVal,
            allow_loose_sale: med.allow_loose_sale !== undefined ? (med.allow_loose_sale ? 1 : 0) : 1,
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
  }, [medicineId, isCreateMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (loading) return;
    const packagingStr = getPackagingString(packQtyUnit, packType, customPackaging);
    
    setForm(prev => {
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

  // History prefill (create mode): debounced lookup once the typed base name is >=3 chars.
  useEffect(() => {
    if (!isCreateMode || loading) return;
    const term = baseName.trim();
    if (term.length < 3) {
      setHistoryPrefill(null);
      return;
    }
    const t = setTimeout(() => {
      api.historyPrefill(term)
        .then((r) => {
          setHistoryPrefill(r?.found ? r : null);
          setPrefillDismissed(false);
        })
        .catch(() => setHistoryPrefill(null));
    }, 300);
    return () => clearTimeout(t);
  }, [baseName, isCreateMode, loading]);

  const applyHistoryPrefill = () => {
    if (!historyPrefill) return;
    setForm(prev => ({
      ...prev,
      hsn_code: historyPrefill.hsn_code ?? prev.hsn_code,
      cgst_per: historyPrefill.cgst_per ?? prev.cgst_per,
      sgst_per: historyPrefill.sgst_per ?? prev.sgst_per,
      mrp: historyPrefill.mrp ?? prev.mrp,
      rate: historyPrefill.rate ?? prev.rate
    }));
    setPrefillDismissed(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setForm(prev => ({
      ...prev,
      [name]: name === 'quantity' || name === 'reorder_level' || name === 'max_stock_level'
        ? (parseInt(value, 10) || 0)
        : name === 'cgst_per' || name === 'sgst_per' || name === 'igst_per'
        ? (parseFloat(value) || 0)
        : val
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.name.trim()) {
      setError('Medicine name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const metadataObj = {
        is_loose: !!form.is_loose
      };

      const parsedSellPrice = form.sell_price !== '' && form.sell_price !== null && form.sell_price !== undefined && !isNaN(Number(form.sell_price))
        ? parseFloat(form.sell_price as string)
        : null;
      const parsedMrp = form.mrp !== '' && form.mrp !== null && form.mrp !== undefined && !isNaN(Number(form.mrp))
        ? parseFloat(form.mrp as string)
        : 0;
      const parsedRate = form.rate !== '' && form.rate !== null && form.rate !== undefined && !isNaN(Number(form.rate))
        ? parseFloat(form.rate as string)
        : 0;

      let savedResult: LocalSavedMedicine | undefined;

      if (isCreateMode) {
        const response = await api.createMedicine({
          ...form,
          mrp: parsedMrp,
          rate: parsedRate,
          sell_price: parsedSellPrice,
          allow_loose_sale: form.allow_loose_sale !== undefined ? (form.allow_loose_sale ? 1 : 0) : (form.is_loose ? 1 : 0),
          metadata: JSON.stringify(metadataObj)
        });
        savedResult = response?.data || response;
        toastEvent.trigger(`Medicine "${form.name}" registered to Master Database!`, 'success');
      } else {
        await api.updateQuickEditMedicine(medicineId!, {
          ...form,
          mrp: parsedMrp,
          rate: parsedRate,
          allow_loose_sale: form.allow_loose_sale !== undefined ? (form.allow_loose_sale ? 1 : 0) : (form.is_loose ? 1 : 0),
          sell_price: parsedSellPrice,
          inventory_id: inventoryId,
          metadata: JSON.stringify(metadataObj)
        });
        savedResult = { id: medicineId!, ...form, mrp: parsedMrp, rate: parsedRate, sell_price: parsedSellPrice } as unknown as LocalSavedMedicine;
        toastEvent.trigger(`Medicine "${form.name}" updated successfully across 26 fields!`, 'success');
      }

      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});

      setSaving(false);
      if (onSave) onSave(savedResult);
      onClose();
    } catch (err) {
      const e = err as LocalApiError;
      console.error(err);
      const errMsg = e.response?.data?.error || e.message || (isCreateMode ? "Failed to create medicine." : "Failed to save 26-field medicine updates.");
      setError(errMsg);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!medicineId || isCreateMode) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteMedicine(medicineId);
      invalidateAfterStockWrite(queryClient);
      api.getCompactInventory().catch(() => {});
      toastEvent.trigger(`Medicine #${medicineId} permanently deleted.`, 'success');
      if (onDelete) onDelete(medicineId);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      const e = err as LocalApiError;
      console.error('Failed to delete medicine:', err);
      const errMsg = e.response?.data?.error || e.message || 'Cannot delete medicine. It has associated sales, purchases, or ledger transactions.';
      setError(errMsg);
      setDeleting(false);
      setShowDeleteConfirm(false);
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
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
              isCreateMode 
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
                : 'bg-primary/20 border-primary/30 text-primary'
            }`}>
              <Pill size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-text leading-tight">
                  {isCreateMode ? 'Register New Medicine to Master Database' : 'Universal Medicine Editor'}
                </h3>
                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${
                  isCreateMode
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-primary/15 text-primary border-primary/30'
                }`}>
                  {isCreateMode ? 'New Catalog Item' : '26 Fields'}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                {isCreateMode 
                  ? 'Form-Aware Packaging, Tax & Regulatory Compliance Master Profile'
                  : `Medicine ID #${medicineId} â€¢ Form-Aware Packaging & Regulatory Compliance`}
              </p>
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
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">Live Preview â€” Compiled Medicine Name</span>
              </div>
              {isManualName ? (
                <button
                  type="button"
                  onClick={() => setIsManualName(false)}
                  className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-bold"
                >
                  âœ Manual Override (Click to Re-sync)
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
                        <optgroup label="â”€â”€ Tablet / Capsule Strips">
                          <option value="10_TAB">STRIP OF 10 TAB</option>
                          <option value="15_TAB">STRIP OF 15 TAB</option>
                          <option value="4_TAB">STRIP OF 4 TAB</option>
                          <option value="1_TAB">1 TAB</option>
                          <option value="30_TAB">30 TAB</option>
                          <option value="10_CAP">STRIP OF 10 CAP</option>
                          <option value="15_CAP">STRIP OF 15 CAP</option>
                        </optgroup>
                        <optgroup label="â”€â”€ Liquids & Syrups">
                          <option value="30_ML">BOTTLE OF 30ML</option>
                          <option value="60_ML">BOTTLE OF 60ML</option>
                          <option value="100_ML">BOTTLE OF 100ML</option>
                          <option value="200_ML">BOTTLE OF 200ML</option>
                        </optgroup>
                        <optgroup label="â”€â”€ Injections & Topicals">
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
                        value={form.pack_size !== undefined && form.pack_size !== null ? form.pack_size : ''} 
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
                              onClick={() => setForm((prev) => ({ ...prev, manufacturer: mfgName }))}
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
                              onClick={() => setForm((prev) => ({ ...prev, marketed_by: mrkName }))}
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
                      onClick={() => setForm((prev) => ({ ...prev, hsn_code: '30049099', cgst_per: 6, sgst_per: 6, igst_per: 12 }))}
                      className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-bold border border-primary/30 hover:bg-primary/25 transition-colors"
                    >
                      Reset Standard 12% Pharma HSN
                    </button>
                  </div>

                  <div className="pt-4 border-t border-glass-border space-y-4">
                    <h4 className="text-xs font-bold uppercase text-muted tracking-wider">Pricing & Sell Price (Special Rates)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1.5">Cost Price / Rate (â‚¹)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          name="rate" 
                          value={form.rate ?? 0} 
                          onChange={handleChange}
                          className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1.5">MRP (â‚¹)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          name="mrp" 
                          value={form.mrp ?? 0} 
                          onChange={handleChange}
                          className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono font-bold focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1.5">Sell Price / Special Rate (â‚¹)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          name="sell_price" 
                          placeholder={form.mrp ? `${form.mrp}` : 'Optional'}
                          value={form.sell_price ?? ''} 
                          onChange={(e) => {
                            const val = e.target.value;
                            const numVal = parseFloat(val);
                            if (!isNaN(numVal) && (form.mrp as number) > 0 && numVal <= (form.mrp as number)) {
                              setForm((prev) => ({ ...prev, sell_price: val }));
                            } else if (val === '') {
                              setForm((prev) => ({ ...prev, sell_price: '' }));
                            }
                          }}
                          className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-sm text-emerald-400 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                          <Tag size={14} /> Special Offer Discount
                        </span>
                        {(form.mrp as number) > 0 && form.sell_price !== '' && Number(form.sell_price) > 0 && Number(form.sell_price) < (form.mrp as number) ? (
                          <button
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, sell_price: '' }))}
                            className="text-[11px] font-semibold text-muted hover:text-text underline"
                          >
                            Reset to Full MRP
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                        <div>
                          <label className="block text-[11px] font-semibold text-muted mb-1">Discount % Off MRP</label>
                          <div className="relative flex items-center">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              placeholder="0"
                              value={
                                (form.mrp as number) > 0 && form.sell_price !== '' && Number(form.sell_price) > 0 && Number(form.sell_price) < (form.mrp as number)
                                  ? ((((form.mrp as number) - Number(form.sell_price)) / (form.mrp as number)) * 100).toFixed(2)
                                  : ''
                              }
                              onChange={(e) => {
                                const disc = parseFloat(e.target.value);
                                if (!isNaN(disc) && disc >= 0 && disc <= 100 && (form.mrp as number) > 0) {
                                  const sp = Math.round(((form.mrp as number) * (1 - disc / 100)) * 100) / 100;
                                  setForm((prev) => ({ ...prev, sell_price: disc > 0 ? String(sp) : '' }));
                                } else if (e.target.value === '') {
                                  setForm((prev) => ({ ...prev, sell_price: '' }));
                                }
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-bg3 border border-glass-border rounded-lg text-amber-400 font-bold focus:border-amber-500 focus:outline-none pr-6"
                            />
                            <Percent size={12} className="text-amber-400 absolute right-2 pointer-events-none" />
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] text-muted">POS Billing Effect:</p>
                          <p className="text-xs font-semibold text-text">
                            {(form.mrp as number) > 0 && form.sell_price !== '' && Number(form.sell_price) > 0 && Number(form.sell_price) < (form.mrp as number)
                              ? `POS auto-applies ${((((form.mrp as number) - Number(form.sell_price)) / (form.mrp as number)) * 100).toFixed(1)}% discount (à¤¹${Number(form.sell_price).toFixed(2)} instead of à¤¹${Number(form.mrp).toFixed(2)})`
                              : 'No special discount active. POS defaults to full MRP.'}
                          </p>
                        </div>
                      </div>
                    </div>
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
                        name="allow_loose_sale" 
                        checked={form.allow_loose_sale !== undefined ? !!form.allow_loose_sale : !!form.is_loose} 
                        onChange={(e) => setForm((prev) => ({ ...prev, allow_loose_sale: e.target.checked ? 1 : 0, is_loose: e.target.checked }))}
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

              {isCreateMode && historyPrefill && !prefillDismissed && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-text flex items-center gap-1.5">
                      <History size={13} className="text-primary shrink-0" />
                      Found in past bills
                      {historyPrefill.source === 'pending_email' && (
                        <span className="text-[10px] font-semibold text-muted">(from a pending email invoice)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {[
                        historyPrefill.hsn_code ? `HSN ${historyPrefill.hsn_code}` : '',
                        historyPrefill.cgst_per != null && Number(historyPrefill.cgst_per) > 0 ? `GST ${historyPrefill.cgst_per}%` : '',
                        historyPrefill.mrp != null && Number(historyPrefill.mrp) > 0 ? `MRP ₹${historyPrefill.mrp}` : '',
                        historyPrefill.rate != null && Number(historyPrefill.rate) > 0 ? `Rate ₹${historyPrefill.rate}` : ''
                      ].filter(Boolean).join(' · ') || 'Historical match found'}
                      {historyPrefill.matched_name ? ` — matched "${historyPrefill.matched_name}"` : ''}
                      {historyPrefill.provenance ? ` · ${historyPrefill.provenance}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPrefillDismissed(true)}
                      className="px-3 py-1.5 rounded-lg border border-glass-border text-muted hover:text-text text-[11px] font-semibold transition-colors"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={applyHistoryPrefill}
                      className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-glass-border bg-bg3 flex items-center justify-between gap-3 shrink-0">
          <div>
            {!isCreateMode && (
              <button 
                type="button" 
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving || deleting}
                className="px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                title="Delete medicine from master database"
              >
                <Trash2 size={14} />
                Delete Medicine
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
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
              disabled={saving || loading || deleting || !form.name?.trim()}
              className={`px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 text-xs shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                isCreateMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20'
              }`}
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? (isCreateMode ? 'Registering Medicine...' : 'Saving 26 Fields...') : (isCreateMode ? 'Register New Medicine' : 'Save Universal Changes')}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-bg2 border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2.5 bg-red-500/20 rounded-xl border border-red-500/30">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h4 className="font-bold text-text text-base">Permanently Delete Medicine?</h4>
                <p className="text-xs text-muted">ID #{medicineId} â€¢ {form.name}</p>
              </div>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              This will permanently delete this medicine record and its aliases from the master catalog.
              If this medicine has linked sales, purchases, or ledger transactions, deletion will be safely rejected to protect accounting history.
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-glass-border">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl border border-glass-border hover:bg-bg3 text-xs font-semibold text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-red-900/30 transition-all disabled:opacity-50"
              >
                {deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export const UniversalMedicineEditModal = memo(UniversalMedicineEditModalInner);
