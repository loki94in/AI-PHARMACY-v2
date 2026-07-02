import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  UploadCloud, Database, ArrowRight, CheckCircle, Loader2, AlertTriangle,
  FileText, X, RefreshCw, Eye, ChevronDown,
  Package, ShoppingCart, Users, RotateCcw, Zap, FileCheck, Trash2
} from 'lucide-react';
import { api, apiClient } from '../../services/api';

const getTodayString = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ─── Types ────────────────────────────────────────────────────────────────────
type WizardStep = 1 | 2 | 3 | 4;
type DataType = 'inventory' | 'purchases' | 'sales' | 'customers' | 'returns' | 'combined' | 'unknown';

interface FileEntry {
  uploadedFileName: string;     // server file name
  originalName: string;         // user-facing name
  ext: string;                  // csv / xlsx / xls / sql / zip
  headers: string[];
  samples: any[];
  sheetNames?: string[];
  activeSheet?: string;
  detected: { type: DataType; confidence: number };
  userSelectedType: DataType;   // human override
  mapping: Record<string, string>;
  status: 'pending' | 'analyzing' | 'ready' | 'error';
  errorMsg?: string;
  rowCount?: number;
  skipLines?: number;           // number of lines to skip
}

interface ImportReport {
  fileName: string;
  recordsRead: number;
  recordsImported: number;
  recordsSkipped: number;
  validationErrors: number;
  duplicateRecords: number;
  modulesUpdated: {
    inventory: boolean;
    purchase: boolean;
    sales: boolean;
    expiry: boolean;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DATA_TYPE_LABELS: Record<DataType, string> = {
  combined: '✨ All In One Migration',
  inventory: '📦 Inventory',
  purchases: '🛒 Purchase History',
  sales: '💰 Sales History',
  customers: '👥 Customers / Patients',
  returns: '🔄 Expiry / Return',
  unknown: '❓ Unknown',
};

const DATA_TYPE_ORDER: DataType[] = ['combined', 'inventory', 'purchases', 'customers', 'sales', 'returns'];

const TYPE_COLORS: Record<DataType, string> = {
  combined: 'text-fuchsia-400 border-fuchsia-400/40 bg-fuchsia-400/10',
  inventory: 'text-sky border-sky/40 bg-sky/10',
  purchases: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  sales: 'text-green border-green/40 bg-green/10',
  customers: 'text-purple-400 border-purple-400/40 bg-purple-400/10',
  returns: 'text-rose-400 border-rose-400/40 bg-rose-400/10',
  unknown: 'text-muted border-glass-border bg-white/5',
};

const TYPE_ICONS: Record<DataType, React.ReactNode> = {
  combined: <Database size={14} />,
  inventory: <Package size={14} />,
  purchases: <ShoppingCart size={14} />,
  sales: <FileCheck size={14} />,
  customers: <Users size={14} />,
  returns: <RotateCcw size={14} />,
  unknown: <FileText size={14} />,
};

const DB_TARGET_SECTIONS = [
  {
    label: 'Common Fields',
    fields: [
      { value: 'name', label: 'Medicine Name ⭐' },
      { value: 'batch_no', label: 'Batch ⭐' },
      { value: 'expiry_date', label: 'Expiry Date ⭐' },
      { value: 'mrp', label: 'MRP (₹)' }
    ]
  },
  {
    label: '📦 Inventory',
    fields: [
      { value: 'manufacturing_date', label: 'Manufacturing Date' },
      { value: 'manufactured_by', label: 'Manufactured By' },
      { value: 'marketed_by', label: 'Marketed By' },
      { value: 'hsn_code', label: 'HSN Code' },
      { value: 'category', label: 'Category' },
      { value: 'packing_type', label: 'Packing Type' },
      { value: 'packaging', label: 'Product Packing / Packaging' },
      { value: 'distributor_name', label: 'Distributor Name' },
      { value: 'cgst', label: 'CGST %' },
      { value: 'sgst', label: 'SGST %' },
      { value: 'total_tax', label: 'Total Tax %' },
      { value: 'cost_price', label: 'Rate (₹)' },
      { value: 'quantity', label: 'Current Stock' },
      { value: 'loose_qty', label: 'Loose Quantity' },
      { value: 'minimum_stock', label: 'Minimum Stock' },
      { value: 'maximum_stock', label: 'Maximum Stock' },
      { value: 'rack_location', label: 'Rack Location' }
    ]
  },
  {
    label: '🛒 Purchase History',
    fields: [
      { value: 'invoice_no', label: 'Invoice Number' },
      { value: 'date', label: 'Purchase Date' },
      { value: 'bill_id', label: 'Bill ID' },
      { value: 'additional_tax', label: 'Additional Tax (₹)' },
      { value: 'additional_discount', label: 'Additional Discount (₹)' },
      { value: 'discount', label: 'Discount On Rate %' },
      { value: 'total_amount', label: 'Total Value (₹)' }
    ]
  },
  {
    label: '💰 Sales History',
    fields: [
      { value: 'bill_no', label: 'Bill Number' },
      { value: 'patient_name', label: 'Customer Name' },
      { value: 'quantity_sold', label: 'Quantity Sold' },
      { value: 'salesperson', label: 'Salesperson' },
      { value: 'payment_mode', label: 'Payment Mode' }
    ]
  },
  {
    label: '🔄 Expiry / Return',
    fields: [
      { value: 'return_quantity', label: 'Return Quantity' },
      { value: 'return_no', label: 'Credit Note Number' },
      { value: 'return_date', label: 'Return Date' },
      { value: 'return_status', label: 'Return Status' }
    ]
  }
];

const DB_TARGET_COLUMNS = [
  { value: '', label: '-- Ignore Column --' },
  ...DB_TARGET_SECTIONS.flatMap(s => s.fields)
];

const getFieldLabelAndSection = (value: string) => {
  for (const section of DB_TARGET_SECTIONS) {
    const field = section.fields.find(f => f.value === value);
    if (field) return { section: section.label, label: field.label };
  }
  return { section: 'Unknown', label: value };
};

// ─── Smart auto-mapping: guess target field from column header ─────────────────
function autoMapColumn(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (h.includes('name') && (h.includes('med') || h.includes('prod') || h.includes('item') || h.includes('drug'))) return 'name';
  if (h.includes('prodname') || h === 'product' || h === 'medicine' || h === 'itemname' || h === 'medname') return 'name';
  if (h.includes('loose')) return 'loose_qty';
  if (h.includes('pack') || h.includes('packaging') || h.includes('packing')) return 'packaging';
  if (h.includes('phone') || h.includes('mobile') || h.includes('contact')) return 'phone';
  if (h.includes('address')) return 'address';
  if (h.includes('note') || h.includes('remark')) return 'notes';
  if (h.includes('batch')) return 'batch_no';
  if (h.includes('exp')) return 'expiry_date';
  if (h.includes('qty') || h.includes('quantity') || h.includes('stock')) return 'quantity';
  if (h === 'mrp' || h.includes('retail') || h.includes('salerate')) return 'mrp';
  if (h.includes('cost') || h.includes('purch') || h.includes('rate')) return 'cost_price';
  if (h.includes('rack') || h.includes('location') || h.includes('shelf')) return 'rack_location';
  if (h.includes('return') || h === 'retno') return 'return_no';
  if (h.includes('invoice') || h.includes('billno') || h.includes('bill')) return 'invoice_no';
  if (h === 'date' || h.includes('billdate') || h.includes('saledate') || h.includes('purchdate')) return 'date';
  if (h.includes('total') || h.includes('amount') || h.includes('value')) return 'total_amount';
  if (h.includes('patient') || h.includes('customer') || h.includes('client')) return 'patient_name';
  if (h.includes('dist') || h.includes('supplier') || h.includes('vendor') || h.includes('party')) return 'distributor_name';
  if (h.includes('doctor') || h.includes('dr')) return 'doctor_name';
  if (h.includes('cgst')) return 'cgst';
  if (h.includes('sgst')) return 'sgst';
  if (h.includes('disc')) return 'discount';
  return '';
}

const getMappingColor = (targetCol: string) => {
  if (!targetCol) return 'ignored';
  if (targetCol.startsWith('custom_col_')) return 'blue';
  
  const blueFields = ['name'];
  if (blueFields.includes(targetCol)) return 'blue';
  
  const greenFields = ['batch_no', 'expiry_date', 'quantity', 'loose_qty', 'packaging', 'mrp', 'cost_price', 'rack_location'];
  if (greenFields.includes(targetCol)) return 'green';
  
  const yellowFields = ['invoice_no', 'return_no', 'date', 'total_amount', 'cgst', 'sgst', 'discount'];
  if (yellowFields.includes(targetCol)) return 'yellow';
  
  const purpleFields = ['patient_name', 'distributor_name', 'doctor_name', 'phone', 'mobile', 'address', 'notes'];
  if (purpleFields.includes(targetCol)) return 'purple';
  
  return 'ignored';
};

const getHighlightStyles = (targetCol: string, isHovered: boolean) => {
  const color = getMappingColor(targetCol);
  
  if (color === 'blue') {
    return {
      header: isHovered ? 'bg-blue-500/20 text-blue-300 border-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      cell: isHovered ? 'bg-blue-500/15 border-r border-blue-500/30 text-blue-300' : 'bg-blue-500/5 border-r border-blue-500/20 text-blue-400/90'
    };
  }
  if (color === 'green') {
    return {
      header: isHovered ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/80 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      cell: isHovered ? 'bg-emerald-500/15 border-r border-emerald-500/30 text-emerald-300' : 'bg-emerald-500/5 border-r border-emerald-500/20 text-emerald-400/90'
    };
  }
  if (color === 'yellow') {
    return {
      header: isHovered ? 'bg-amber-500/20 text-amber-300 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      cell: isHovered ? 'bg-amber-500/15 border-r border-amber-500/30 text-amber-300' : 'bg-amber-500/5 border-r border-amber-500/20 text-amber-400/90'
    };
  }
  if (color === 'purple') {
    return {
      header: isHovered ? 'bg-purple-500/20 text-purple-300 border-purple-500/80 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      cell: isHovered ? 'bg-purple-500/15 border-r border-purple-500/30 text-purple-300' : 'bg-purple-500/5 border-r border-purple-500/20 text-purple-400/90'
    };
  }
  
  return {
    header: isHovered ? 'bg-white/10 text-gray-200 border-white/40' : 'bg-white/5 text-gray-500 border-glass-border opacity-50 grayscale',
    cell: isHovered ? 'bg-white/5 border-r border-white/10 text-gray-200' : 'border-r border-glass-border/10 text-gray-500 opacity-50 grayscale'
  };
};

function detectDataType(samples: any[], header: string): 'Text' | 'Numeric' | 'Date' {
  if (!samples || samples.length === 0) return 'Text';
  
  let hasNumber = false;
  let hasDate = false;
  let hasText = false;
  let nonNullCount = 0;
  
  for (const sample of samples) {
    const val = sample[header];
    if (val === undefined || val === null || String(val).trim() === '') continue;
    
    nonNullCount++;
    const valStr = String(val).trim();
    
    // Check if it's a number
    const num = Number(valStr.replace(/[^\d.-]/g, ''));
    if (!isNaN(num) && valStr.match(/^[\d.,₹\s+-]+$/)) {
      hasNumber = true;
      continue;
    }
    
    // Check if it's a date
    const date = Date.parse(valStr);
    if (!isNaN(date) && (valStr.includes('-') || valStr.includes('/') || valStr.match(/^\d{2,4}$/))) {
      hasDate = true;
      continue;
    }
    
    hasText = true;
  }
  
  if (nonNullCount === 0) return 'Text';
  if (hasText) return 'Text';
  if (hasDate) return 'Date';
  if (hasNumber) return 'Numeric';
  return 'Text';
}

// ─── Component ────────────────────────────────────────────────────────────────
const Migration = () => {
  const [step, setStep] = useState<WizardStep>(1);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeFileIdx, setActiveFileIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<any>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [stagingData, setStagingData] = useState<{ inventory: any[]; sales: any[]; purchases: any[]; returns: any[]; errors: any[] }>({ inventory: [], sales: [], purchases: [], returns: [], errors: [] });
  const [previewOpen, setPreviewOpen] = useState<number | null>(null);
  const [preset, setPreset] = useState<'auto' | 'redbook'>('auto');
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isPolling]);



  const handleSkipLinesChange = async (idx: number, newSkipLines: number) => {
    const file = files[idx];
    if (!file) return;

    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, status: 'analyzing', skipLines: newSkipLines } : f));
    try {
      let analyzed: any = {};
      if (file.ext === 'csv') {
        analyzed = await api.analyzeMigrationFile(file.uploadedFileName, newSkipLines);
      } else if (file.ext === 'xlsx' || file.ext === 'xls') {
        analyzed = await api.analyzeExcelFile(file.uploadedFileName, 0, newSkipLines);
      } else {
        analyzed = { headers: file.headers, samples: file.samples };
      }
      
      const headers = analyzed.headers || [];
      const detectedType = (analyzed.detected?.type as DataType) || file.userSelectedType;
      const autoMapping = Object.fromEntries(headers.map((h: string) => [h, autoMapColumn(h)]));

      // Reset ignored rows in moduleFilters when headers change
      setModuleFilters(prev => {
        const current = prev[file.uploadedFileName] || {};
        return {
          ...prev,
          [file.uploadedFileName]: { ...current, ignoredRows: [] }
        };
      });

      setFiles(prev => prev.map((f, i) => i === idx ? {
        ...f,
        headers,
        samples: analyzed.samples || [],
        detected: analyzed.detected || f.detected,
        mapping: autoMapping,
        status: 'ready'
      } : f));
    } catch (err: any) {
      setFiles(prev => prev.map((f, i) => i === idx ? {
        ...f,
        status: 'error',
        errorMsg: err.message || 'Analysis failed'
      } : f));
    }
  };

  // Staging Items Preview modal state
  const [viewingItemsRecord, setViewingItemsRecord] = useState<{ id: number; type: 'sales' | 'purchases' | 'returns'; name: string; patient_name?: string; doctor_name?: string; distributor_name?: string } | null>(null);
  const [viewingItems, setViewingItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemData, setEditingItemData] = useState<any>(null);
  const [newItemData, setNewItemData] = useState<any>({});
  const [addingNewItem, setAddingNewItem] = useState<boolean>(false);
  const [rollingBack, setRollingBack] = useState(false);
  
  // Mapping Modal State
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [activeMappingFileIdx, setActiveMappingFileIdx] = useState<number | null>(null);
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoOpenedRef = useRef<Record<string, boolean>>({});

  // Mapping Session & Reversibility States
  const [tempMapping, setTempMapping] = useState<Record<string, string>>({});
  const [customColumns, setCustomColumns] = useState<string[]>([]);
  const [mappingHistory, setMappingHistory] = useState<Record<string, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [showOnlyMapped, setShowOnlyMapped] = useState<boolean>(false);
  const [rightPreviewTab, setRightPreviewTab] = useState<'grid' | 'preview'>('preview');

  // Sync mapping modal local state with file analysis state when active file changes or re-analyzes
  useEffect(() => {
    if (activeMappingFileIdx !== null && files[activeMappingFileIdx]) {
      const currentFile = files[activeMappingFileIdx];
      if (currentFile.status === 'ready') {
        const tempKeys = Object.keys(tempMapping);
        const headersMatch = currentFile.headers.length === tempKeys.length && currentFile.headers.every(h => tempKeys.includes(h));
        if (!headersMatch) {
          setTempMapping(currentFile.mapping);
          const initialCustom = Object.values(currentFile.mapping).filter((val: any) => typeof val === 'string' && val.startsWith('custom_col_')) as string[];
          setCustomColumns(Array.from(new Set(initialCustom)));
          setMappingHistory([currentFile.mapping]);
          setHistoryIndex(0);
        }
      }
    }
  }, [activeMappingFileIdx, files, tempMapping]);

  // Guided Configurator State
  const [configSubStep, setConfigSubStep] = useState<'modules' | 'filters' | 'medicines' | 'preview'>('modules');
  const [selectedModules, setSelectedModules] = useState<Record<string, boolean>>({
    combined: true,
    inventory: true,
    purchases: true,
    sales: true,
    customers: true,
    returns: true,
    unknown: true,
  });
  const [moduleFilters, setModuleFilters] = useState<Record<string, {
    rangeStart?: string;
    rangeEnd?: string;
    onlyActiveStock?: boolean;
    excludeExpired?: boolean;
    minPurchaseDate?: string;
    ignoredRows?: number[];
  }>>({});
  const [medicineActions, setMedicineActions] = useState<Record<string, {
    action: 'import' | 'skip' | 'merge';
    target?: string;
  }>>({});
  const [preMigrationAnalysis, setPreMigrationAnalysis] = useState<any>(null);
  const [analyzingPreMigration, setAnalyzingPreMigration] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<{ isValid: boolean; warnings: any[] } | null>(null);
  const [ignoreValidationWarnings, setIgnoreValidationWarnings] = useState<boolean>(false);
  const [simulatingPreMigration, setSimulatingPreMigration] = useState(false);

  // V2 Migration projects, templates, snapshots and conflicts states
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProject, setActiveProject] = useState<any>(null);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [saveTemplateName, setSaveTemplateName] = useState<string>('');
  const [stagingConflicts, setStagingConflicts] = useState<any[]>([]);
  const [activePreviewHeader, setActivePreviewHeader] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);

  // Advanced Filters State
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [advFilters, setAdvFilters] = useState({
    medicineName: '',
    batch: '',
    expiry: '',
    distributor: '',
    invoiceNumber: '',
    hsnCode: '',
    category: '',
    tax: '',
    mrp: '',
    rate: '',
    manufacturer: '',
    marketer: '',
    startDate: getNDaysAgoString(15),
    endDate: getTodayString()
  });

  const [manualToDate, setManualToDate] = useState(false);

  useEffect(() => {
    if (!manualToDate) {
      setAdvFilters(prev => ({ ...prev, endDate: getTodayString() }));
    }
  }, [manualToDate]);

  const handleDateFromChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setAdvFilters(prev => ({ ...prev, startDate: '2020-01-01' }));
    } else {
      setAdvFilters(prev => ({ ...prev, startDate: val }));
    }
  };

  const handleDateToChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setAdvFilters(prev => ({ ...prev, endDate: '2020-01-01' }));
    } else {
      setAdvFilters(prev => ({ ...prev, endDate: val }));
    }
  };

  // Final Ingestion Summary Report
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  const fetchV2Data = useCallback(async () => {
    try {
      const [projs, temps, snaps] = await Promise.all([
        api.getProjects(),
        api.getTemplates(),
        api.getSnapshots(),
      ]);
      setProjects(projs || []);
      setTemplates(temps || []);
      setSnapshots(snaps || []);
      if (projs && projs.length > 0 && !activeProject) {
        setActiveProject(projs[0]);
      }
    } catch (e) {
      console.error('Failed to load V2 migration data:', e);
    }
  }, [activeProject]);

  useEffect(() => {
    fetchV2Data();
  }, []);

  const fetchConflicts = useCallback(async () => {
    try {
      const conflicts = await api.getStagingConflicts();
      setStagingConflicts(conflicts || []);
    } catch (e) {
      console.error('Failed to fetch staging conflicts:', e);
    }
  }, []);

  useEffect(() => {
    if (step === 3) {
      fetchConflicts();
    }
  }, [step, fetchConflicts]);

  const handleResolveConflict = async (conflict: any, resolution: string) => {
    try {
      await api.resolveStagingConflict(conflict.id, resolution);
      await fetchConflicts();
      await fetchStagingData();
    } catch (err: any) {
      alert(err.message || 'Failed to resolve conflict');
    }
  };

  const openMappingModal = (idx: number) => {
    const file = files[idx];
    if (!file) return;
    
    setTempMapping(file.mapping);
    
    // Initialize custom columns
    const initialCustom = Object.values(file.mapping).filter((val: any) => typeof val === 'string' && val.startsWith('custom_col_')) as string[];
    setCustomColumns(Array.from(new Set(initialCustom)));
    
    // Initialize history
    setMappingHistory([file.mapping]);
    setHistoryIndex(0);
    
    setActiveMappingFileIdx(idx);
    setShowMappingModal(true);
  };

  const updateTempMappingWithHistory = (newMapping: Record<string, string>) => {
    setTempMapping(newMapping);
    const newHistory = mappingHistory.slice(0, historyIndex + 1);
    setMappingHistory([...newHistory, newMapping]);
    setHistoryIndex(newHistory.length);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setTempMapping(mappingHistory[prevIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < mappingHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setTempMapping(mappingHistory[nextIndex]);
    }
  };

  const handleDeleteCustomColumn = (targetCol: string) => {
    if (window.confirm(`Are you sure you want to delete the custom column "${targetCol.replace('custom_col_', '')}"? This will unmap any headers currently mapped to it.`)) {
      setCustomColumns(prev => prev.filter(c => c !== targetCol));
      const updatedMapping = { ...tempMapping };
      Object.keys(updatedMapping).forEach(key => {
        if (updatedMapping[key] === targetCol) {
          updatedMapping[key] = '';
        }
      });
      updateTempMappingWithHistory(updatedMapping);
    }
  };

  const commitMappings = () => {
    if (activeMappingFileIdx !== null) {
      setFiles(prev => prev.map((f, i) => i === activeMappingFileIdx ? { ...f, mapping: tempMapping } : f));
    }
    setShowMappingModal(false);
    setActiveMappingFileIdx(null);
  };

  // Staging Explorer & Editing States
  const [activeStagingTab, setActiveStagingTab] = useState<'inventory' | 'sales' | 'purchases' | 'returns' | 'errors' | 'skipped_rows'>('inventory');
  const [stagingSearchQuery, setStagingSearchQuery] = useState('');
  const [editingRecordType, setEditingRecordType] = useState<'inventory' | 'sales' | 'purchases' | 'returns' | null>(null);
  const [editingRecordData, setEditingRecordData] = useState<any>(null);
  const [savingRecord, setSavingRecord] = useState(false);

  const handleEditRecord = (type: 'inventory' | 'sales' | 'purchases' | 'returns', record: any) => {
    setEditingRecordType(type);
    setEditingRecordData({ ...record });
  };

  const handleSaveRecord = async () => {
    if (!editingRecordType || !editingRecordData) return;
    setSavingRecord(true);
    try {
      const { id } = editingRecordData;
      if (editingRecordType === 'inventory') {
        await api.updateStagingInventory(id, {
          medicine_name: editingRecordData.medicine_name,
          api_reference: editingRecordData.api_reference,
          batch_no: editingRecordData.batch_no,
          expiry_date: editingRecordData.expiry_date,
          quantity: editingRecordData.quantity,
          loose_quantity: editingRecordData.loose_quantity,
          mrp: editingRecordData.mrp,
          cost_price: editingRecordData.cost_price,
          rack_location: editingRecordData.rack_location,
        });
      } else if (editingRecordType === 'sales') {
        await api.updateStagingSales(id, {
          invoice_no: editingRecordData.invoice_no,
          date: editingRecordData.date,
          total_amount: editingRecordData.total_amount,
          patient_name: editingRecordData.patient_name,
          doctor_name: editingRecordData.doctor_name,
        });
      } else if (editingRecordType === 'purchases') {
        await api.updateStagingPurchases(id, {
          invoice_no: editingRecordData.invoice_no,
          date: editingRecordData.date,
          total_amount: editingRecordData.total_amount,
          distributor_name: editingRecordData.distributor_name,
        });
      } else if (editingRecordType === 'returns') {
        await api.updateStagingReturns(id, {
          return_no: editingRecordData.return_no,
          date: editingRecordData.date,
          total_amount: editingRecordData.total_amount,
          distributor_name: editingRecordData.distributor_name,
          return_invoice_id: editingRecordData.return_invoice_id,
          return_sub_type: editingRecordData.return_sub_type,
          raw_return_type: editingRecordData.raw_return_type,
          return_date_time: editingRecordData.return_date_time,
        });
      }
      await fetchStagingData();
      setEditingRecordType(null);
      setEditingRecordData(null);
    } catch (err: any) {
      alert(`Failed to update record: ${err.message || 'Unknown error'}`);
    } finally {
      setSavingRecord(false);
    }
  };

  const handleDeleteRecord = async (type: 'inventory' | 'sales' | 'purchases' | 'returns', id: number) => {
    if (!confirm('Are you sure you want to delete this staged record? This cannot be undone.')) return;
    try {
      if (type === 'inventory') {
        await api.deleteStagingInventory(id);
      } else if (type === 'sales') {
        await api.deleteStagingSales(id);
      } else if (type === 'purchases') {
        await api.deleteStagingPurchases(id);
      } else if (type === 'returns') {
        await api.deleteStagingReturns(id);
      }
      await fetchStagingData();
    } catch (err: any) {
      alert(`Failed to delete record: ${err.message || 'Unknown error'}`);
    }
  };

  const handleViewItems = async (type: 'sales' | 'purchases' | 'returns', record: any) => {
    setViewingItemsRecord({
      id: record.id,
      type,
      name: record.invoice_no || record.return_no || `ID: ${record.id}`,
      patient_name: record.patient_name,
      doctor_name: record.doctor_name,
      distributor_name: record.distributor_name,
    });
    setViewingItems([]);
    setLoadingItems(true);
    try {
      let items = [];
      if (type === 'sales') {
        items = await api.getStagingSaleItems(record.id);
      } else if (type === 'purchases') {
        items = await api.getStagingPurchaseItems(record.id);
      } else if (type === 'returns') {
        items = await api.getStagingReturnItems(record.id);
      }
      setViewingItems(Array.isArray(items) ? items : []);
    } catch (err: any) {
      alert(`Failed to fetch items: ${err.message || 'Unknown error'}`);
    } finally {
      setLoadingItems(false);
    }
  };
  const handleSaveStagedItem = async (itemId: number) => {
    if (!viewingItemsRecord || !editingItemData) return;
    try {
      const type = viewingItemsRecord.type;
      const invoiceId = viewingItemsRecord.id;
      if (type === 'sales') {
        await api.updateStagingSaleItem(invoiceId, itemId, editingItemData);
      } else if (type === 'purchases') {
        await api.updateStagingPurchaseItem(invoiceId, itemId, editingItemData);
      } else if (type === 'returns') {
        await api.updateStagingReturnItem(invoiceId, itemId, editingItemData);
      }
      setEditingItemId(null);
      setEditingItemData(null);
      await handleViewItems(type, { id: invoiceId, invoice_no: viewingItemsRecord.name, return_no: viewingItemsRecord.name });
    } catch (err: any) {
      alert(`Failed to update item: ${err.message || 'Unknown error'}`);
    }
  };

  const handleDeleteStagedItem = async (itemId: number) => {
    if (!viewingItemsRecord) return;
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      const type = viewingItemsRecord.type;
      const invoiceId = viewingItemsRecord.id;
      if (type === 'sales') {
        await api.deleteStagingSaleItem(invoiceId, itemId);
      } else if (type === 'purchases') {
        await api.deleteStagingPurchaseItem(invoiceId, itemId);
      } else if (type === 'returns') {
        await api.deleteStagingReturnItem(invoiceId, itemId);
      }
      await handleViewItems(type, { id: invoiceId, invoice_no: viewingItemsRecord.name, return_no: viewingItemsRecord.name });
    } catch (err: any) {
      alert(`Failed to delete item: ${err.message || 'Unknown error'}`);
    }
  };

  const handleAddStagedItem = async () => {
    if (!viewingItemsRecord) return;
    try {
      const type = viewingItemsRecord.type;
      const invoiceId = viewingItemsRecord.id;
      if (type === 'sales') {
        await api.addStagingSaleItem(invoiceId, newItemData);
      } else if (type === 'purchases') {
        await api.addStagingPurchaseItem(invoiceId, newItemData);
      } else if (type === 'returns') {
        await api.addStagingReturnItem(invoiceId, newItemData);
      }
      setNewItemData({});
      setAddingNewItem(false);
      await handleViewItems(type, { id: invoiceId, invoice_no: viewingItemsRecord.name, return_no: viewingItemsRecord.name });
    } catch (err: any) {
      alert(`Failed to add item: ${err.message || 'Unknown error'}`);
    }
  };

  const fetchStagingData = useCallback(async () => {
    try {
      const [inv, sales, pur, rets, errs] = await Promise.all([
        api.getStagingInventory(),
        api.getStagingSales(),
        api.getStagingPurchases(),
        api.getStagingReturns(),
        api.getStagingErrors()
      ]);
      setStagingData({ 
        inventory: Array.isArray(inv) ? inv : [], 
        sales: Array.isArray(sales) ? sales : [], 
        purchases: Array.isArray(pur) ? pur : [], 
        returns: Array.isArray(rets) ? rets : [], 
        errors: Array.isArray(errs) ? errs : [] 
      });
    } catch (e) { console.error(e); }
  }, []);

  // Fetch staging data on initial render
  useEffect(() => {
    fetchStagingData();
  }, [fetchStagingData]);

  // Check active migration status on initial mount to resume progress view if needed
  useEffect(() => {
    const checkActiveMigration = async () => {
      try {
        const status = await api.getMigrationStatus();
        if (status && status.active) {
          setMigrationStatus(status);
          setIsPolling(true);
          setStep(3);
        }
      } catch (err) {
        console.warn('Failed to check active migration status on mount:', err);
      }
    };
    checkActiveMigration();
  }, []);

  // Auto-advance to step 3 if staging data already exists (e.g. after page refresh)
  useEffect(() => {
    const hasData =
      stagingData.inventory.length > 0 ||
      stagingData.sales.length > 0 ||
      stagingData.purchases.length > 0 ||
      stagingData.returns.length > 0;
    if (hasData && step === 1 && files.length === 0) {
      setStep(3);
    }
  }, [stagingData]);

  // SSE EventSource tracking for migration progress
  useEffect(() => {
    if (!isPolling) return;

    const backendUrl = apiClient.defaults.baseURL || window.location.origin;
    const cleanBaseUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
    const sseUrl = cleanBaseUrl.startsWith('/api')
      ? `${cleanBaseUrl}/notifications/stream`
      : `${cleanBaseUrl}/api/notifications/stream`;

    let eventSource: EventSource | null = new EventSource(sseUrl);

    eventSource.onmessage = async (event) => {
      try {
        const eventData = JSON.parse(event.data);
        const { type, payload } = eventData;

        if (type === 'migration_update' && payload) {
          setMigrationStatus(payload);
          if (payload.isStagingReady) {
            setIsPolling(false);
            await fetchStagingData();
            setStep(3);
          }
        }
      } catch (err) {
        console.error('Failed to parse migration SSE message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('Migration SSE connection error, retrying in 5 seconds...', err);
      eventSource?.close();
    };

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isPolling, fetchStagingData]);

  useEffect(() => {
    if (hoveredHeader && scrollContainerRef.current) {
      const thElement = scrollContainerRef.current.querySelector(
        `th[data-header="${CSS.escape(hoveredHeader)}"]`
      );
      if (thElement) {
        thElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [hoveredHeader]);

  useEffect(() => {
    const readyCSVFiles = files.filter(f => f.status === 'ready' && !['sql'].includes(f.ext) && f.headers.length > 0);
    if (readyCSVFiles.length === 1) {
      const file = readyCSVFiles[0];
      const idx = files.findIndex(f => f.uploadedFileName === file.uploadedFileName);
      if (idx !== -1 && !autoOpenedRef.current[file.uploadedFileName]) {
        autoOpenedRef.current[file.uploadedFileName] = true;
        openMappingModal(idx);
      }
    }
  }, [files]);

  // ─── Upload Handler ─────────────────────────────────────────────────────────
  const handleFileDrop = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, targetType?: DataType) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    setUploading(true);
    setError(null);

    for (const file of selected) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const entry: FileEntry = {
        uploadedFileName: '',
        originalName: file.name,
        ext,
        headers: [],
        samples: [],
        detected: { type: 'unknown', confidence: 0 },
        userSelectedType: preset === 'redbook' ? 'combined' : (targetType || 'unknown'),
        mapping: {},
        status: 'analyzing',
        skipLines: 0,
      };
      setFiles(prev => [...prev, entry]);
      const idx = files.length + selected.indexOf(file);

      try {
        // 1. Upload
        const res = await api.uploadMigrationFile(file);
        const serverName: string = res.file;

        // 2. Analyze based on type
        let analyzed: any = {};
        if (ext === 'zip') {
          analyzed = await api.analyzeZipFile(serverName);
          // ZIP returns multiple files — add each as separate entry
          setFiles(prev => {
            const withoutPlaceholder = prev.filter(f => f.originalName !== file.name || f.status !== 'analyzing');
            const zipEntries: FileEntry[] = (analyzed.files || []).map((zf: any) => {
              const rawType = zf.detected?.type === 'full_database' ? 'combined' : zf.detected?.type;
              return {
                uploadedFileName: zf.extractedFileName,
                originalName: zf.originalName,
                ext: zf.ext,
                headers: zf.headers || [],
                samples: zf.samples || [],
                sheetNames: zf.sheetNames,
                detected: { ...zf.detected, type: rawType },
                userSelectedType: preset === 'redbook' ? 'combined' : (targetType || (rawType as DataType) || 'unknown'),
                mapping: Object.fromEntries((zf.headers || []).map((h: string) => [h, autoMapColumn(h)])),
                status: 'ready' as const,
                skipLines: 0,
              };
            });
            return [...withoutPlaceholder, ...zipEntries];
          });
          continue;
        } else if (ext === 'xlsx' || ext === 'xls') {
          analyzed = await api.analyzeExcelFile(serverName);
        } else if (ext === 'csv') {
          analyzed = await api.analyzeMigrationFile(serverName, 0);
        } else if (ext === 'sql') {
          analyzed = { headers: ['[SQL — auto-import]'], samples: [], detected: { type: 'combined', confidence: 100 } };
        }

        const headers: string[] = analyzed.headers || [];
        const rawDetectedType = analyzed.detected?.type === 'full_database' ? 'combined' : (analyzed.detected?.type as DataType || 'unknown');
        const detectedType = preset === 'redbook' ? 'combined' : (targetType || rawDetectedType || 'unknown');
        const autoMapping = Object.fromEntries(headers.map((h: string) => [h, autoMapColumn(h)]));

        setFiles(prev => prev.map(f =>
          f.originalName === file.name && f.status === 'analyzing'
            ? {
                ...f,
                uploadedFileName: serverName,
                headers,
                samples: analyzed.samples || [],
                sheetNames: analyzed.sheetNames,
                detected: analyzed.detected || { type: 'unknown', confidence: 0 },
                userSelectedType: detectedType,
                mapping: autoMapping,
                status: 'ready',
                skipLines: 0,
              }
            : f
        ));
      } catch (err: any) {
        setFiles(prev => prev.map(f =>
          f.originalName === file.name && f.status === 'analyzing'
            ? { ...f, status: 'error', errorMsg: err.message || 'Analysis failed' }
            : f
        ));
      }
    }
    setUploading(false);
  }, [files.length, preset]);


  // ─── Start all migrations in correct order ──────────────────────────────────
  const startMigration = async () => {
    const readyFiles = DATA_TYPE_ORDER.flatMap(type =>
      files.filter(f => f.status === 'ready' && f.userSelectedType === type && selectedModules[type])
    ).concat(files.filter(f => f.status === 'ready' && f.userSelectedType === 'unknown' && selectedModules['unknown']));

    if (readyFiles.length === 0) { setError('No files selected for import.'); return; }
    setError(null);

    const tasks = readyFiles.map(f => {
      const filtersForFile = moduleFilters[f.uploadedFileName] || {};
      return {
        fileName: f.uploadedFileName,
        dataType: f.userSelectedType,
        mapping: f.mapping,
        skipLines: f.skipLines || 0,
        sheetIndex: 0,
        filters: filtersForFile,
        medicineActions
      };
    });

    setStep(3);
    setMigrationStatus({ message: 'Initializing migration queue...', isStagingReady: false });
    setIsPolling(true);

    try {
      await api.runMigrationQueue(tasks);
    } catch (err: any) {
      setError(`Failed to start migration queue: ${err.message}`);
      setIsPolling(false);
    }
  };

  const runPreMigrationAnalysis = async () => {
    const mainFile = files.find(f => f.status === 'ready' && selectedModules[f.userSelectedType]);
    if (!mainFile) {
      setConfigSubStep('preview');
      return;
    }
    setAnalyzingPreMigration(true);
    try {
      const data = await api.preMigrationAnalyze(mainFile.uploadedFileName, mainFile.skipLines || 0, 0, mainFile.mapping);
      setPreMigrationAnalysis(data);
      
      const initialActions: Record<string, any> = {};
      if (data.medicineCandidates) {
        data.medicineCandidates.forEach((cand: string) => {
          const suggestions = data.mergeSuggestions?.[cand] || [];
          if (suggestions.length > 0) {
            initialActions[cand] = { action: 'merge', target: suggestions[0] };
          } else {
            initialActions[cand] = { action: 'import' };
          }
        });
      }
      setMedicineActions(initialActions);
      setConfigSubStep('medicines');
    } catch (err: any) {
      setError(`Analysis failed: ${err.message}`);
    } finally {
      setAnalyzingPreMigration(false);
    }
  };

  const runPreMigrationSimulation = async () => {
    const mainFile = files.find(f => f.status === 'ready' && selectedModules[f.userSelectedType]);
    if (!mainFile) {
      setConfigSubStep('preview');
      return;
    }
    setSimulatingPreMigration(true);
    try {
      const filtersForFile = moduleFilters[mainFile.uploadedFileName] || {};
      const data = await api.preMigrationSimulate(
        mainFile.uploadedFileName,
        mainFile.userSelectedType,
        mainFile.mapping,
        mainFile.skipLines || 0,
        0,
        filtersForFile
      );
      setSimulationResult(data.simulation);
      setValidationResult(data.validation || null);
      setIgnoreValidationWarnings(false);
      setConfigSubStep('preview');
    } catch (err: any) {
      setError(`Simulation failed: ${err.message}`);
    } finally {
      setSimulatingPreMigration(false);
    }
  };

  const finalizeMigration = async () => {
    try {
      const fileNames = files.map(f => f.originalName).join(', ');
      const inventoryCount = stagingData.inventory.length;
      const salesCount = stagingData.sales.length;
      const purchasesCount = stagingData.purchases.length;
      const returnsCount = stagingData.returns.length;
      const errorsCount = stagingData.errors.length;
      const totalImported = inventoryCount + salesCount + purchasesCount + returnsCount;
      const totalRead = totalImported + errorsCount;

      setImportReport({
        fileName: fileNames || 'Uploaded File',
        recordsRead: totalRead,
        recordsImported: totalImported,
        recordsSkipped: errorsCount,
        validationErrors: errorsCount,
        duplicateRecords: stagingConflicts.length,
        modulesUpdated: {
          inventory: inventoryCount > 0,
          purchase: purchasesCount > 0,
          sales: salesCount > 0,
          expiry: returnsCount > 0
        }
      });

      await api.finalizeMigration(false);
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Failed to finalize');
    }
  };

  const handleRollback = async () => {
    if (!confirm('This will DELETE the staged data and let you start fresh. Continue?')) return;
    setRollingBack(true);
    try {
      await api.rollbackMigration();
      setFiles([]);
      setStep(1);
      setMigrationStatus(null);
      setStagingData({ inventory: [], sales: [], purchases: [], returns: [], errors: [] });
    } catch (err: any) {
      setError(err.message);
    } finally { setRollingBack(false); }
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));
  const updateType = (idx: number, type: DataType) => setFiles(prev => prev.map((f, i) => i === idx ? { ...f, userSelectedType: type } : f));
  const updateMapping = (fileIdx: number, header: string, target: string) =>
    setFiles(prev => prev.map((f, i) => i === fileIdx ? { ...f, mapping: { ...f.mapping, [header]: target } } : f));

  const readyCount = files.filter(f => f.status === 'ready').length;
  const hasNameMapped = (f: FileEntry) =>
    ['sql', 'unknown'].includes(f.ext) || Object.values(f.mapping).includes('name');

  const matchRecord = (record: any, type: string) => {
    // Check main search query first
    if (stagingSearchQuery) {
      const query = stagingSearchQuery.toLowerCase();
      const matchesQuery = 
        (record.medicine_name || record.name || '').toLowerCase().includes(query) ||
        (record.invoice_no || '').toLowerCase().includes(query) ||
        (record.return_no || '').toLowerCase().includes(query) ||
        (record.batch_no || '').toLowerCase().includes(query) ||
        (record.distributor_name || '').toLowerCase().includes(query) ||
        (record.patient_name || '').toLowerCase().includes(query) ||
        (record.doctor_name || '').toLowerCase().includes(query);
      if (!matchesQuery) return false;
    }

    // Advanced Filters
    if (advFilters.medicineName) {
      const medName = (record.medicine_name || record.name || '').toLowerCase();
      if (!medName.includes(advFilters.medicineName.toLowerCase())) return false;
    }
    if (advFilters.batch) {
      const batch = (record.batch_no || '').toLowerCase();
      if (!batch.includes(advFilters.batch.toLowerCase())) return false;
    }
    if (advFilters.expiry) {
      const exp = (record.expiry_date || '').toLowerCase();
      if (!exp.includes(advFilters.expiry.toLowerCase())) return false;
    }
    if (advFilters.distributor) {
      const dist = (record.distributor_name || '').toLowerCase();
      if (!dist.includes(advFilters.distributor.toLowerCase())) return false;
    }
    if (advFilters.invoiceNumber) {
      const inv = (record.invoice_no || record.return_no || record.return_invoice_id || '').toLowerCase();
      if (!inv.includes(advFilters.invoiceNumber.toLowerCase())) return false;
    }
    if (advFilters.hsnCode) {
      const hsn = (record.hsn_code || '').toLowerCase();
      if (!hsn.includes(advFilters.hsnCode.toLowerCase())) return false;
    }
    if (advFilters.category) {
      const cat = (record.category || '').toLowerCase();
      if (!cat.includes(advFilters.category.toLowerCase())) return false;
    }
    if (advFilters.tax) {
      const taxQuery = parseFloat(advFilters.tax);
      if (!isNaN(taxQuery)) {
        const rowCgst = parseFloat(record.cgst || record.cgst_value || 0);
        const rowSgst = parseFloat(record.sgst || record.sgst_value || 0);
        const rowTotal = rowCgst + rowSgst;
        if (Math.abs(rowCgst - taxQuery) > 0.01 && Math.abs(rowSgst - taxQuery) > 0.01 && Math.abs(rowTotal - taxQuery) > 0.01) {
          return false;
        }
      }
    }
    if (advFilters.mrp) {
      const mrpQuery = parseFloat(advFilters.mrp);
      if (!isNaN(mrpQuery)) {
        const rowMrp = parseFloat(record.mrp || 0);
        if (Math.abs(rowMrp - mrpQuery) > 0.01) return false;
      }
    }
    if (advFilters.rate) {
      const rateQuery = parseFloat(advFilters.rate);
      if (!isNaN(rateQuery)) {
        const rowRate = parseFloat(record.cost_price || record.unit_price || 0);
        if (Math.abs(rowRate - rateQuery) > 0.01) return false;
      }
    }
    if (advFilters.manufacturer) {
      const mfg = (record.manufacturer || '').toLowerCase();
      if (!mfg.includes(advFilters.manufacturer.toLowerCase())) return false;
    }
    if (advFilters.marketer) {
      const mrk = (record.marketed_by || '').toLowerCase();
      if (!mrk.includes(advFilters.marketer.toLowerCase())) return false;
    }
    if (advFilters.startDate || advFilters.endDate) {
      const dateStr = record.date || record.return_date_time || record.expiry_date || '';
      if (dateStr) {
        const recTime = new Date(dateStr).getTime();
        if (advFilters.startDate) {
          const startTime = new Date(advFilters.startDate).getTime();
          if (!isNaN(startTime) && recTime < startTime) return false;
        }
        if (advFilters.endDate) {
          const endTime = new Date(advFilters.endDate).getTime() + 86400000;
          if (!isNaN(endTime) && recTime > endTime) return false;
        }
      }
    }
    return true;
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col fade-in space-y-5 overflow-y-auto pb-12">



      {/* Progress Steps */}
      <div className="flex items-center glass-panel p-4 bg-black/40 gap-1">
        {[
          { num: 1, label: 'Upload Files' },
          { num: 2, label: 'Map & Verify' },
          { num: 3, label: 'Review Staging' },
          { num: 4, label: 'Go Live ✅' },
        ].map((s, i) => (
          <React.Fragment key={s.num}>
            <div className={`flex items-center gap-2 ${step >= s.num ? 'text-primary' : 'text-muted'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm
                ${step > s.num ? 'bg-green/20 text-green border border-green/50'
                  : step === s.num ? 'bg-primary/20 text-primary border border-primary/50'
                  : 'bg-white/5 border border-glass-border'}`}>
                {step > s.num ? <CheckCircle size={14} /> : s.num}
              </div>
              <span className="font-semibold text-xs hidden md:block">{s.label}</span>
            </div>
            {i < 3 && <div className="flex-1 h-px bg-glass-border mx-1" />}
          </React.Fragment>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-bg text-red border border-red/20 rounded-xl flex items-center gap-3">
          <AlertTriangle size={18} /> <span className="font-semibold text-sm">{error}</span>
          <button className="ml-auto text-muted hover:text-white" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          {/* Project Management Bar */}
          <div className="glass-panel p-4 bg-bg2 border border-glass-border flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted uppercase">Active Migration Project:</span>
                {projects.length > 0 ? (
                  <select
                    value={activeProject?.id || ''}
                    onChange={(e) => {
                      const p = projects.find(proj => proj.id === parseInt(e.target.value));
                      setActiveProject(p);
                    }}
                    className="bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 font-bold outline-none cursor-pointer"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-muted">No projects found. Create one to get started.</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted uppercase">Source App Preset:</span>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as 'auto' | 'redbook')}
                  className="bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 font-bold outline-none cursor-pointer"
                >
                  <option value="auto">Auto-Detect Format</option>
                  <option value="redbook">Redbook (PostgreSQL Dump)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <input
                type="text"
                placeholder="New Project Name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="flex-1 md:flex-initial bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2.5 outline-none focus:border-primary transition-all"
              />
              <button
                onClick={async () => {
                  if (!newProjectName.trim()) return;
                  try {
                    const res = await api.createProject(newProjectName);
                    if (res.success) {
                      setNewProjectName('');
                      await fetchV2Data();
                    }
                  } catch (err: any) {
                    alert(err.message || 'Failed to create project');
                  }
                }}
                className="premium-btn bg-primary text-text text-xs font-bold py-2 px-4 shrink-0"
              >
                + Create Project
              </button>
            </div>
          </div>

          {/* 4 Dedicated Upload Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              { type: 'inventory', label: '📦 Inventory', desc: 'Medicine stocks, rack locations, batch numbers, and reorder levels.', color: 'border-sky/30 bg-sky/5 text-sky hover:border-sky/60' },
              { type: 'purchases', label: '🛒 Purchase History', desc: 'Distributor invoices, purchases, historical cost prices, and supply logs.', color: 'border-amber-400/30 bg-amber-400/5 text-amber-400 hover:border-amber-400/60' },
              { type: 'sales', label: '💰 Sales History', desc: 'Sales invoices, retail receipts, historical margins, and customer billing.', color: 'border-green/30 bg-green/5 text-green hover:border-green/60' },
              { type: 'returns', label: '🔄 Expiry / Return', desc: 'Expired medicine return notes, credit notes, and supplier return logs.', color: 'border-rose-400/30 bg-rose-400/5 text-rose-400 hover:border-rose-400/60' }
            ].map(module => {
              const moduleFiles = files.filter(f => f.userSelectedType === module.type);
              return (
                <div key={module.type} className={`glass-panel p-5 border flex flex-col justify-between gap-4 transition-all duration-300 relative group bg-bg ${module.color}`}>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-bold flex items-center gap-2 text-text">
                        {TYPE_ICONS[module.type as DataType]} {module.label}
                      </h3>
                      {moduleFiles.length > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                          {moduleFiles.length} file(s)
                        </span>
                      )}
                    </div>
                    <p className="text-muted text-xs leading-relaxed">{module.desc}</p>
                    
                    {/* List of files under this module */}
                    {moduleFiles.length > 0 && (
                      <div className="mt-4 space-y-2.5">
                        {moduleFiles.map((f, fIdx) => {
                          const originalIdx = files.indexOf(f);
                          return (
                            <div key={fIdx} className="bg-black/30 border border-glass-border/40 p-2.5 rounded-lg flex items-center justify-between gap-3 text-text">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <FileText size={13} className="text-muted shrink-0" />
                                  <span className="text-xs font-semibold truncate" title={f.originalName}>{f.originalName}</span>
                                </div>
                                {f.status === 'ready' && (
                                  <p className="text-[10px] text-muted font-mono mt-0.5">
                                    {f.ext.toUpperCase()} · {f.headers.length} columns
                                  </p>
                                )}
                                {f.status === 'analyzing' && (
                                  <div className="flex items-center gap-1 text-[10px] text-sky mt-0.5">
                                    <Loader2 size={10} className="animate-spin" /> Analyzing...
                                  </div>
                                )}
                                {f.status === 'error' && (
                                  <p className="text-[10px] text-red mt-0.5 truncate" title={f.errorMsg}>{f.errorMsg || 'Failed to extract'}</p>
                                )}
                              </div>
                              <button
                                onClick={() => removeFile(originalIdx)}
                                className="p-1 rounded text-muted hover:text-red hover:bg-red-bg transition-all shrink-0"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-2">
                    <label className="w-full flex items-center justify-center gap-1.5 border border-dashed border-glass-border/60 hover:border-primary/50 hover:bg-primary/5 rounded-lg py-3 cursor-pointer text-xs font-bold text-muted hover:text-text transition-all">
                      <UploadCloud size={14} className="text-muted group-hover:text-primary" />
                      Upload {module.label.replace(/[^a-zA-Z ]/g, '').trim()} File
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls,.zip,.sql"
                        className="hidden"
                        onChange={(e) => handleFileDrop(e, module.type as DataType)}
                        disabled={uploading}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fallback Combined Upload Zone */}
          <div className="glass-panel p-4 bg-bg2 border border-glass-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-muted uppercase">Or Upload Combined / Bulk Dump (SQL / ZIP)</h4>
              {files.filter(f => !['inventory', 'purchases', 'sales', 'returns'].includes(f.userSelectedType)).length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                  {files.filter(f => !['inventory', 'purchases', 'sales', 'returns'].includes(f.userSelectedType)).length} file(s)
                </span>
              )}
            </div>
            
            {/* List of general files */}
            {files.filter(f => !['inventory', 'purchases', 'sales', 'returns'].includes(f.userSelectedType)).length > 0 && (
              <div className="mb-3 space-y-2">
                {files.filter(f => !['inventory', 'purchases', 'sales', 'returns'].includes(f.userSelectedType)).map((f, fIdx) => {
                  const originalIdx = files.indexOf(f);
                  return (
                    <div key={fIdx} className="bg-black/30 border border-glass-border/40 p-2.5 rounded-lg flex items-center justify-between gap-3 text-text">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileText size={13} className="text-muted shrink-0" />
                          <span className="text-xs font-semibold truncate" title={f.originalName}>{f.originalName}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted font-bold uppercase">{f.userSelectedType}</span>
                        </div>
                        {f.status === 'ready' && (
                          <p className="text-[10px] text-muted font-mono mt-0.5">
                            {f.ext.toUpperCase()} · {f.headers.length} columns
                          </p>
                        )}
                        {f.status === 'analyzing' && (
                          <div className="flex items-center gap-1 text-[10px] text-sky mt-0.5">
                            <Loader2 size={10} className="animate-spin" /> Analyzing...
                          </div>
                        )}
                        {f.status === 'error' && (
                          <p className="text-[10px] text-red mt-0.5 truncate" title={f.errorMsg}>{f.errorMsg || 'Failed to extract'}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeFile(originalIdx)}
                        className="p-1 rounded text-muted hover:text-red hover:bg-red-bg transition-all shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <label className="flex flex-col items-center justify-center border-dashed border border-glass-border hover:border-primary/50 hover:bg-primary/5 rounded-xl py-6 cursor-pointer group transition-all">
              <UploadCloud size={32} className="text-muted/60 group-hover:text-primary mb-2 transition-all" />
              <span className="text-xs font-bold mb-1">Click to browse or drop combined migration files</span>
              <span className="text-[10px] text-muted">Supports SQL database dumps and bulk ZIP archives containing multiple modules</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.zip,.sql"
                multiple
                className="hidden"
                onChange={(e) => handleFileDrop(e)}
                disabled={uploading}
              />
            </label>
          </div>

          {/* Loader Overlay for analyzing state */}
          {uploading && (
            <div className="flex items-center justify-center gap-2 text-sky text-sm p-4 bg-sky/5 border border-sky/20 rounded-xl">
              <Loader2 size={16} className="animate-spin" />
              <span>Uploading and extracting headers...</span>
            </div>
          )}

          {/* Continue Action Button */}
          {files.length > 0 && (
            <div className="flex justify-end pt-3">
              <button
                onClick={() => setStep(2)}
                className="premium-btn bg-primary text-text text-xs font-bold py-2.5 px-6 shadow-[0_0_20px_rgba(59,130,246,0.3)] flex items-center gap-2"
              >
                Continue to Map & Verify <ArrowRight size={14} />
              </button>
            </div>
          )}


        </div>
      )}

      {/* ─── STEP 2: MAP & VERIFY ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {preset === 'redbook' && (
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl text-xs text-text flex items-center gap-3">
              <Zap size={16} className="text-primary shrink-0 animate-pulse" />
              <div>
                <strong className="text-primary font-bold">Redbook Preset Enabled:</strong> All tables and schemas from your Redbook PostgreSQL backup will be auto-imported. No manual column adjustments are required. You can review mappings or click "Continue to Cart Preview" to simulate or start the ingestion.
              </div>
            </div>
          )}
          {/* Guided Configurator Sub-steps progress indicator */}
          <div className="flex items-center gap-2 pb-2 border-b border-glass-border/30 overflow-x-auto">
            {[
              { key: 'modules', label: '1. Select Modules' },
              { key: 'filters', label: '2. Mappings & Filters' },
              { key: 'medicines', label: '3. Medicine Matcher' },
              { key: 'preview', label: '4. Cart Preview' }
            ].map((sub, i) => {
              const active = configSubStep === sub.key;
              return (
                <React.Fragment key={sub.key}>
                  <button
                    disabled={
                      (sub.key === 'filters' && readyCount === 0) ||
                      (sub.key === 'medicines' && readyCount === 0) ||
                      (sub.key === 'preview' && readyCount === 0)
                    }
                    onClick={() => {
                      if (sub.key === 'medicines') {
                        runPreMigrationAnalysis();
                      } else if (sub.key === 'preview') {
                        runPreMigrationSimulation();
                      } else {
                        setConfigSubStep(sub.key as any);
                      }
                    }}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                      active 
                        ? 'bg-primary/20 text-primary border border-primary/50' 
                        : 'text-muted hover:text-text bg-white/5 border border-glass-border'
                    }`}
                  >
                    {sub.label}
                  </button>
                  {i < 3 && <span className="text-muted/40 text-[10px]">➔</span>}
                </React.Fragment>
              );
            })}
          </div>

          {/* Sub-step 1: Choose Modules */}
          {configSubStep === 'modules' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-text">Choose Modules to Migrate</h3>
                <label className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 cursor-pointer text-xs">
                  <UploadCloud size={13} /> Add More Files
                  <input type="file" accept=".csv,.xlsx,.xls,.zip,.sql" multiple className="hidden" onChange={handleFileDrop} />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {files.map((file, idx) => {
                  const isChecked = selectedModules[file.userSelectedType];
                  return (
                    <div key={idx} className="glass-panel p-4 border border-glass-border/30 hover:border-glass-border/70 transition-all flex flex-col justify-between gap-3 bg-bg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`p-2 rounded-lg ${TYPE_COLORS[file.userSelectedType] || 'bg-white/5'}`}>
                            {TYPE_ICONS[file.userSelectedType] || <FileText size={16} />}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-text truncate">{file.originalName}</h4>
                            <p className="text-[10px] text-muted font-mono uppercase mt-0.5">{file.ext} · {file.headers.length} columns</p>
                          </div>
                        </div>
                        <button onClick={() => removeFile(idx)} className="p-1 rounded hover:bg-red-bg text-red" title="Remove">
                          <X size={14} />
                        </button>
                      </div>

                      {file.status === 'ready' && (
                        <div className="flex flex-col gap-2.5 bg-bg2 p-3 rounded-lg border border-glass-border/20">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted font-semibold">Enable Module:</span>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => setSelectedModules(prev => ({ ...prev, [file.userSelectedType]: e.target.checked }))}
                              className="w-4 h-4 rounded border-glass-border bg-transparent text-primary focus:ring-primary focus:ring-offset-bg"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted">Module Type:</span>
                            <select
                              className={`text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer bg-[#18181b] ${TYPE_COLORS[file.userSelectedType]}`}
                              value={file.userSelectedType}
                              onChange={e => updateType(idx, e.target.value as DataType)}
                            >
                              {Object.entries(DATA_TYPE_LABELS).map(([val, label]) => (
                                <option key={val} value={val} className="bg-[#18181b] text-text">{label}</option>
                              ))}
                            </select>
                          </div>

                          {file.detected.type !== 'unknown' && (
                            <p className="text-[10px] text-muted">
                              Heuristic confidence: <strong className="text-primary">{file.detected.confidence}%</strong>
                            </p>
                          )}

                          {file.headers.length > 0 && !['sql'].includes(file.ext) && (
                            <button
                              type="button"
                              onClick={() => openMappingModal(idx)}
                              className="mt-2 w-full premium-btn bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-[11px] font-bold py-1.5 flex items-center justify-center gap-1.5"
                            >
                              <Eye size={12} />
                              Preview & Map Columns
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {files.length > 0 && (
                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setConfigSubStep('filters')}
                    className="premium-btn bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                  >
                    Continue to Filters <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sub-step 2: Columns & Scope Filters */}
          {configSubStep === 'filters' && (
            <div className="space-y-4">
              <h3 className="font-bold text-lg text-text">Columns Mappings & Preprocessing Filters</h3>
              
              <div className="space-y-4">
                {files.filter(f => selectedModules[f.userSelectedType]).map((file, idx) => {
                  const absoluteIdx = files.indexOf(file);
                  const mappedCount = Object.values(file.mapping).filter(v => v !== '').length;
                  const totalCount = file.headers.length;
                  const fileFilter = moduleFilters[file.uploadedFileName] || {};
                  
                  return (
                    <div key={file.uploadedFileName} className="glass-panel p-4 border border-glass-border/30 space-y-4 bg-bg">
                      {/* File Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-glass-border/20 pb-3">
                        <div>
                          <h4 className="font-bold text-sm text-text flex items-center gap-1.5">
                            <span className={`p-1 rounded ${TYPE_COLORS[file.userSelectedType]}`}>
                              {TYPE_ICONS[file.userSelectedType]}
                            </span>
                            {file.originalName}
                          </h4>
                          <p className="text-[10px] text-muted mt-0.5 font-mono">
                            {mappedCount} of {totalCount} columns mapped.
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {file.headers.length > 0 && !['sql'].includes(file.ext) && (
                            <button
                              onClick={() => openMappingModal(absoluteIdx)}
                              className="premium-btn bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs px-3 py-1.5 font-bold flex items-center gap-1.5"
                            >
                              <Eye size={12} className="text-amber-400" />
                              Preview & Map Columns
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Warnings */}
                      {!hasNameMapped(file) && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                          ⚠ Please map at least one column to "Medicine Name" to enable import for this module.
                        </div>
                      )}

                      {/* Mapped Columns Summary */}
                      {mappedCount > 0 && (
                        <div className="bg-bg2/50 p-3 rounded-lg border border-glass-border/25 space-y-1.5">
                          <h5 className="text-[10px] font-bold text-muted uppercase tracking-wider">Active Column Mappings</h5>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(file.mapping)
                              .filter(([_, target]) => target !== '')
                              .map(([source, target]) => {
                                const customFieldName = target.startsWith('custom_col_') ? target.substring(11) : '';
                                const targetLabel = customFieldName 
                                  ? `Custom: ${customFieldName}` 
                                  : (DB_TARGET_COLUMNS.find(c => c.value === target)?.label.replace(' ⭐', '') || target);
                                return (
                                  <div key={source} className="text-[10px] bg-primary/10 border border-primary/20 text-primary rounded px-2 py-0.5 font-medium flex items-center gap-1">
                                    <span className="font-bold text-text truncate max-w-[100px]" title={source}>{source}</span>
                                    <span className="text-muted">➔</span>
                                    <span className="font-bold">{targetLabel}</span>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {/* Scope & Preprocessing Filters */}
                      {!['sql'].includes(file.ext) && (
                        <div className="bg-bg2 p-4 rounded-lg border border-glass-border/25 space-y-3">
                          <h5 className="font-bold text-xs text-text uppercase tracking-wider flex items-center gap-1">
                            <span className="text-primary font-bold">Filter Options</span>
                          </h5>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Row Index Range Selection */}
                            <div className="space-y-1.5">
                              <label className="text-xs text-muted block font-semibold">Row Index Range:</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  placeholder="Start Row (e.g. 1)"
                                  value={fileFilter.rangeStart || ''}
                                  onChange={(e) => setModuleFilters(prev => ({
                                    ...prev,
                                    [file.uploadedFileName]: { ...fileFilter, rangeStart: e.target.value }
                                  }))}
                                  className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary transition-all"
                                />
                                <span className="text-muted text-xs">to</span>
                                <input
                                  type="number"
                                  placeholder="End Row"
                                  value={fileFilter.rangeEnd || ''}
                                  onChange={(e) => setModuleFilters(prev => ({
                                    ...prev,
                                    [file.uploadedFileName]: { ...fileFilter, rangeEnd: e.target.value }
                                  }))}
                                  className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary transition-all"
                                />
                              </div>
                              <p className="text-[10px] text-muted">Leave empty to import all rows.</p>
                            </div>

                            {/* Manual Ignored Rows Selection */}
                            <div className="space-y-1.5">
                              <label className="text-xs text-muted block font-semibold">Ignore Specific Rows manually:</label>
                              <input
                                type="text"
                                placeholder="e.g. 1, 2, 5, 12, 15 (comma-separated)"
                                value={fileFilter.ignoredRows?.join(', ') || ''}
                                onChange={(e) => {
                                  const text = e.target.value;
                                  const parsed = text.split(',')
                                    .map(val => parseInt(val.trim()))
                                    .filter(val => !isNaN(val) && val > 0);
                                  setModuleFilters(prev => ({
                                    ...prev,
                                    [file.uploadedFileName]: { ...fileFilter, ignoredRows: parsed }
                                  }));
                                }}
                                className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary transition-all font-mono"
                              />
                              <p className="text-[10px] text-muted">Allows ignoring rows that aren't visible in the first 10 rows preview.</p>
                            </div>

                            {/* Conditional filters based on DataType */}
                            <div className="flex flex-col gap-2 justify-center">
                              {(file.userSelectedType === 'inventory' || file.userSelectedType === 'combined') && (
                                <>
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!fileFilter.onlyActiveStock}
                                      onChange={(e) => setModuleFilters(prev => ({
                                        ...prev,
                                        [file.uploadedFileName]: { ...fileFilter, onlyActiveStock: e.target.checked }
                                      }))}
                                      className="w-4 h-4 rounded border-glass-border bg-transparent text-primary focus:ring-primary focus:ring-offset-bg"
                                    />
                                    <span className="text-xs text-muted font-medium">Import only active stock (Quantity &gt; 0)</span>
                                  </label>

                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!fileFilter.excludeExpired}
                                      onChange={(e) => setModuleFilters(prev => ({
                                        ...prev,
                                        [file.uploadedFileName]: { ...fileFilter, excludeExpired: e.target.checked }
                                      }))}
                                      className="w-4 h-4 rounded border-glass-border bg-transparent text-primary focus:ring-primary focus:ring-offset-bg"
                                    />
                                    <span className="text-xs text-muted font-medium">Exclude expired products (Expiry &gt; Today)</span>
                                  </label>
                                </>
                              )}

                              {(file.userSelectedType === 'purchases' || file.userSelectedType === 'sales') && (
                                <div className="space-y-1">
                                  <label className="text-xs text-muted block font-semibold">Min Transaction Date:</label>
                                  <input
                                    type="date"
                                    value={fileFilter.minPurchaseDate || ''}
                                    onChange={(e) => setModuleFilters(prev => ({
                                      ...prev,
                                      [file.uploadedFileName]: { ...fileFilter, minPurchaseDate: e.target.value }
                                    }))}
                                    className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary transition-all"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-4">
                <button
                  onClick={() => setConfigSubStep('modules')}
                  className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 text-xs"
                >
                  Back
                </button>
                <button
                  onClick={runPreMigrationAnalysis}
                  className="premium-btn bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                >
                  {analyzingPreMigration ? (
                    <>
                      <Loader2 size={14} className="animate-spin mr-1" /> Analyzing composition...
                    </>
                  ) : (
                    <>
                      Verify Medicines <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Sub-step 3: Medicine Match & Merge Reviews */}
          {configSubStep === 'medicines' && (
            <div className="space-y-4">
              <h3 className="font-bold text-lg text-text">Medicine Verification & Merge Resolver</h3>
              <p className="text-xs text-muted">
                Review medicine names extracted from the file. You can choose to import as new, merge with suggested database matches, or skip them.
              </p>

              {analyzingPreMigration ? (
                <div className="glass-panel p-10 flex flex-col items-center justify-center border border-glass-border/30 bg-bg">
                  <Loader2 size={32} className="animate-spin text-primary mb-3" />
                  <p className="text-sm font-semibold text-text">Scanning Composition...</p>
                  <p className="text-xs text-muted mt-1">Cross-referencing unique medicine names with database master...</p>
                </div>
              ) : !preMigrationAnalysis ? (
                <div className="glass-panel p-10 text-center bg-bg border border-glass-border/30 rounded-xl max-w-md mx-auto space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                    <Database size={16} />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-text">Analysis Pending</h4>
                    <p className="text-xs text-muted mt-1">
                      Please go back to the previous step and click the "Verify Medicines" button to analyze this file.
                    </p>
                  </div>
                  <button 
                    onClick={() => setConfigSubStep('filters')}
                    className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 text-xs mt-3 mx-auto flex items-center gap-1.5"
                  >
                    Go Back to Mappings & Filters
                  </button>
                </div>
              ) : preMigrationAnalysis?.medicineCandidates?.length === 0 ? (
                <div className="glass-panel p-8 text-center bg-bg border border-glass-border/30 rounded-xl space-y-4 max-w-xl mx-auto">
                  <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                    <Database size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-text">Direct Bill/Invoice Ingestion (No Item Mapping)</h4>
                    <p className="text-xs text-muted mt-2 leading-relaxed">
                      This file does not have a column mapped to <strong className="text-primary">Medicine Name</strong> (or contains no medicine item data). 
                      It will be migrated directly as aggregate bill-wise records (e.g. return invoices, purchase bills, or sales invoices) containing total amounts, dates, and distributor/patient details.
                    </p>
                    <p className="text-xs text-muted mt-1">
                      No individual medicine mapping is required.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={runPreMigrationSimulation}
                      className="premium-btn bg-primary hover:bg-primary/90 text-white font-bold px-6 py-2.5 rounded-lg shadow-md hover:shadow-primary/20 transition-all text-xs flex items-center justify-center gap-1.5 mx-auto"
                    >
                      {simulatingPreMigration ? (
                        <>
                          <Loader2 size={14} className="animate-spin" /> Simulating...
                        </>
                      ) : (
                        <>
                          <span>Continue to Preview</span>
                          <ArrowRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="max-h-[400px] overflow-y-auto border border-glass-border/20 rounded-xl bg-bg divide-y divide-glass-border/10">
                    {preMigrationAnalysis?.medicineCandidates?.map((cand: string) => {
                      const suggestions = preMigrationAnalysis.mergeSuggestions?.[cand] || [];
                      const actionObj = medicineActions[cand] || { action: 'import' };
                      
                      return (
                        <div key={cand} className="p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                          <div className="flex-1 min-w-0">
                            <span className="font-bold text-text block truncate" title={cand}>{cand}</span>
                            {suggestions.length > 0 && actionObj.action === 'merge' && (
                              <span className="text-[10px] text-green block mt-0.5">
                                Maps to suggested master composition
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            {/* Action selector */}
                            <div className="flex rounded-lg bg-bg2 border border-glass-border/30 p-0.5">
                              {[
                                { val: 'import', label: 'Import New' },
                                { val: 'merge', label: 'Merge Suggestion', disabled: suggestions.length === 0 },
                                { val: 'skip', label: 'Skip' }
                              ].map(act => (
                                <button
                                  key={act.val}
                                  disabled={act.disabled}
                                  onClick={() => setMedicineActions(prev => ({
                                    ...prev,
                                    [cand]: { ...prev[cand], action: act.val as any }
                                  }))}
                                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all select-none ${
                                    act.disabled ? 'opacity-30 cursor-not-allowed' :
                                    actionObj.action === act.val 
                                      ? 'bg-primary/20 text-primary border border-primary/30' 
                                      : 'text-muted hover:text-text'
                                  }`}
                                >
                                  {act.label}
                                </button>
                              ))}
                            </div>

                            {/* Dropdown for suggested merges */}
                            {actionObj.action === 'merge' && suggestions.length > 0 && (
                              <select
                                className="bg-[#18181b] border border-glass-border/40 text-text text-[11px] rounded p-1 outline-none font-bold"
                                value={actionObj.target || suggestions[0]}
                                onChange={(e) => setMedicineActions(prev => ({
                                  ...prev,
                                  [cand]: { ...prev[cand], target: e.target.value }
                                }))}
                              >
                                {suggestions.map((sug: string) => (
                                  <option key={sug} value={sug} className="bg-[#18181b] text-text">{sug}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      onClick={() => setConfigSubStep('filters')}
                      className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 text-xs"
                    >
                      Back
                    </button>
                    <button
                      onClick={runPreMigrationSimulation}
                      className="premium-btn bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                    >
                      {simulatingPreMigration ? (
                        <>
                          <Loader2 size={14} className="animate-spin mr-1" /> Simulating changes...
                        </>
                      ) : (
                        <>
                          Continue to Simulation <ArrowRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-step 4: Migration Cart & Final Preview */}
          {configSubStep === 'preview' && (
            <div className="space-y-4">
              <h3 className="font-bold text-lg text-text">Staging Ingestion Cart Preview</h3>
              <p className="text-xs text-muted">
                Review your migration cart items and simulation predictions before launching the SQLite staging load.
              </p>

              {simulatingPreMigration ? (
                <div className="glass-panel p-10 flex flex-col items-center justify-center border border-glass-border/30 bg-bg">
                  <Loader2 size={32} className="animate-spin text-primary mb-3" />
                  <p className="text-sm font-semibold text-text">Running Simulation...</p>
                  <p className="text-xs text-muted mt-1">Estimating target insertions and merges...</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Cart and Ingestion Checklist summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="glass-panel p-4 border border-glass-border/20 bg-bg">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-muted mb-3">Cart Contents</h4>
                      <div className="space-y-2 text-xs">
                        {files.filter(f => selectedModules[f.userSelectedType]).map((f, i) => (
                          <div key={i} className="flex justify-between border-b border-glass-border/10 pb-1.5">
                            <span className="text-text font-medium truncate max-w-[200px]">{f.originalName}</span>
                            <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase font-mono ${TYPE_COLORS[f.userSelectedType]}`}>
                              {f.userSelectedType}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Simulation results prediction */}
                    <div className="glass-panel p-4 border border-glass-border/20 bg-bg flex flex-col justify-between">
                      <div>
                        <h4 className="font-bold text-xs uppercase tracking-wider text-muted mb-3">Simulation Prediction</h4>
                        {simulationResult ? (
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted">Will Create:</span>
                              <span className="font-bold text-green">{simulationResult.created} medicines</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Will Update / Merge:</span>
                              <span className="font-bold text-sky">{simulationResult.updated} medicines</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Will Skip:</span>
                              <span className="font-bold text-amber-500">{simulationResult.skipped} records</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted">No simulation details available.</p>
                        )}
                      </div>
                      <p className="text-[10px] text-muted mt-3">Prediction counts based on a sample run of up to 1,000 rows.</p>
                    </div>

                    {/* Ingestion Checklist Summary */}
                    {(() => {
                      const mainFile = files.find(f => f.status === 'ready' && selectedModules[f.userSelectedType]);
                      const mappedFieldsCount = mainFile ? Object.values(mainFile.mapping).filter(v => v && v !== 'IGNORE').length : 0;
                      const unmappedFieldsCount = mainFile ? mainFile.headers.length - mappedFieldsCount : 0;
                      const totalSimCount = simulationResult ? (simulationResult.created + simulationResult.updated) : 0;

                      const recordCounts = {
                        inventory: mainFile?.userSelectedType === 'inventory' ? totalSimCount : (mainFile?.userSelectedType === 'combined' ? totalSimCount : 0),
                        purchase: mainFile?.userSelectedType === 'purchases' ? totalSimCount : (mainFile?.userSelectedType === 'combined' ? totalSimCount : 0),
                        sales: mainFile?.userSelectedType === 'sales' ? totalSimCount : 0,
                        expiry: mainFile?.userSelectedType === 'returns' ? totalSimCount : 0,
                      };

                      return (
                        <div className="glass-panel p-4 border border-glass-border/20 bg-bg">
                          <h4 className="font-bold text-xs uppercase tracking-wider text-muted mb-3">Import Summary</h4>
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between border-b border-glass-border/10 pb-1">
                              <span className="text-muted">Inventory Records:</span>
                              <span className="font-bold text-text">{recordCounts.inventory}</span>
                            </div>
                            <div className="flex justify-between border-b border-glass-border/10 pb-1">
                              <span className="text-muted">Purchase Records:</span>
                              <span className="font-bold text-text">{recordCounts.purchase}</span>
                            </div>
                            <div className="flex justify-between border-b border-glass-border/10 pb-1">
                              <span className="text-muted">Sales Records:</span>
                              <span className="font-bold text-text">{recordCounts.sales}</span>
                            </div>
                            <div className="flex justify-between border-b border-glass-border/10 pb-1">
                              <span className="text-muted">Expiry Records:</span>
                              <span className="font-bold text-text">{recordCounts.expiry}</span>
                            </div>
                            <div className="flex justify-between border-b border-glass-border/10 pb-1">
                              <span className="text-muted">Mapped Fields:</span>
                              <span className="font-bold text-green">{mappedFieldsCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted">Unmapped Fields:</span>
                              <span className="font-bold text-amber-500">{unmappedFieldsCount}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Validation Checks checklist alerts */}
                  {validationResult && (
                    <div className={`p-4 rounded-xl border ${
                      validationResult.isValid
                        ? 'border-green/20 bg-green/5 text-green'
                        : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
                    }`}>
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={18} />
                        <h4 className="font-bold text-sm">
                          {validationResult.isValid 
                            ? 'All Data Validated Successfully!' 
                            : 'Data Validation Checklist & Warnings'}
                        </h4>
                      </div>

                      {validationResult.isValid ? (
                        <p className="text-xs">No formatting, date format, or duplicate issues were detected in the file mapping.</p>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1.5 max-h-56 overflow-y-auto">
                            {validationResult.warnings.map((w, idx) => (
                              <div key={idx} className="flex justify-between items-start gap-4 text-xs bg-bg2/40 p-2.5 rounded border border-glass-border/10">
                                <div>
                                  <span className="font-bold block text-text">{w.message}</span>
                                  <span className="text-[10px] text-muted">Validation rules checker result</span>
                                </div>
                                <span className="px-2 py-0.5 rounded bg-red-bg text-red font-mono text-[10px] font-bold shrink-0">
                                  {w.affectedCount} rows affected
                                </span>
                              </div>
                            ))}
                          </div>

                          <label className="flex items-start gap-2.5 pt-2 select-none cursor-pointer text-xs text-text font-semibold">
                            <input
                              type="checkbox"
                              checked={ignoreValidationWarnings}
                              onChange={(e) => setIgnoreValidationWarnings(e.target.checked)}
                              className="mt-0.5 w-4 h-4 rounded border-glass-border bg-transparent text-primary focus:ring-primary focus:ring-offset-bg cursor-pointer"
                            />
                            <span>Bypass warnings and proceed with data ingestion anyway.</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between pt-4">
                    <button
                      onClick={() => setConfigSubStep('medicines')}
                      className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 text-xs"
                    >
                      Back
                    </button>
                    <button
                      onClick={startMigration}
                      disabled={!!(validationResult && !validationResult.isValid && !ignoreValidationWarnings)}
                      className="premium-btn bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] font-bold disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Database size={15} className="mr-1" /> Confirm & Start Ingestion <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── STEP 3: STAGING REVIEW ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Progress — shown while import is running */}
          {(isPolling || migrationStatus) && (
            <div className="glass-panel p-5 border-primary/30">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-bold text-base">Import Progress</h3>
                  <p className="text-sky text-sm mt-1">{migrationStatus?.message || 'Processing...'}</p>
                </div>
                {isPolling && <Loader2 className="animate-spin text-primary" size={28} />}
                {!isPolling && migrationStatus?.isStagingReady && <CheckCircle className="text-green" size={28} />}
              </div>
              {isPolling && (
                <div className="space-y-2 mt-3">
                  <div className="w-full bg-white/5 rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: `${migrationStatus?.progress || 30}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted font-semibold">
                    <span>Progress: {migrationStatus?.progress || 0}%</span>
                    {migrationStatus?.startTime && migrationStatus?.progress > 2 ? (() => {
                      const elapsed = currentTime - migrationStatus.startTime;
                      const progress = migrationStatus.progress;
                      const estimatedTotal = elapsed / (progress / 100);
                      const remaining = Math.max(0, estimatedTotal - elapsed);
                      const min = Math.floor(remaining / 60000);
                      const sec = Math.floor((remaining % 60000) / 1000);
                      
                      const elapsedMin = Math.floor(elapsed / 60000);
                      const elapsedSec = Math.floor((elapsed % 60000) / 1000);
                      const elapsedStr = elapsedMin > 0 ? `${elapsedMin}m ${elapsedSec}s elapsed` : `${elapsedSec}s elapsed`;

                      if (progress >= 100) return <span>Complete!</span>;
                      
                      const remainingStr = min > 0 ? `${min}m ${sec}s remaining` : `${sec}s remaining`;
                      return <span>{elapsedStr} · Approx. {remainingStr}</span>;
                    })() : (
                      migrationStatus?.startTime ? (
                        <span>Analyzing database structure...</span>
                      ) : null
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Staging Summary — show whenever data exists OR migration just completed */}
          {!isPolling && (() => {
            const hasStagingData =
              stagingData.inventory.length > 0 ||
              stagingData.sales.length > 0 ||
              stagingData.purchases.length > 0 ||
              stagingData.returns.length > 0 ||
              stagingData.errors.length > 0;
            if (!hasStagingData && !migrationStatus?.isStagingReady) return null;
            return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Inventory Items', count: stagingData.inventory.length, color: 'text-sky' },
                  { label: 'Sales Invoices', count: stagingData.sales.length, color: 'text-green' },
                  { label: 'Purchase Bills', count: stagingData.purchases.length, color: 'text-primary' },
                  { label: 'Returns', count: stagingData.returns?.length || 0, color: 'text-rose-400' },
                ].map(s => (
                  <div key={s.label} className="glass-panel p-5 text-center">
                    <p className={`text-3xl font-black ${s.color}`}>{s.count}</p>
                    <p className="text-xs text-muted font-bold uppercase tracking-wider mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Conflict Resolution Center Panel */}
              {stagingConflicts.length > 0 && (
                <div className="glass-panel p-4 border border-amber-500/30 bg-amber-500/5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="text-amber-500" size={18} />
                      <div>
                        <h4 className="font-bold text-sm text-text">Migration Conflict Resolution Center ({stagingConflicts.length} pending)</h4>
                        <p className="text-[11px] text-muted">Some imported rows match existing items in the live database. Action is required.</p>
                      </div>
                    </div>
                  </div>

                  <div className="max-h-[250px] overflow-y-auto border border-glass-border/20 rounded-lg bg-bg divide-y divide-glass-border/10 font-sans">
                    {stagingConflicts.map((c: any) => {
                      const rawRow = JSON.parse(c.raw_imported_data);
                      return (
                        <div key={c.id} className="p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-text block">Medicine ID: {rawRow.medicine_id} — Batch: {rawRow.batch_no}</span>
                            <span className="text-[10px] text-muted block mt-0.5">Reason: {c.conflict_reason} | Staged Qty: {rawRow.quantity} | Staged Expiry: {rawRow.expiry_date}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleResolveConflict(c, 'merge')}
                              className="px-2.5 py-1.5 rounded bg-sky/10 border border-sky/30 text-sky text-[10px] font-bold hover:bg-sky/20 transition-all cursor-pointer"
                            >
                              Merge Stock
                            </button>
                            <button
                              onClick={() => handleResolveConflict(c, 'replace')}
                              className="px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/20 transition-all cursor-pointer"
                            >
                              Replace Live
                            </button>
                            <button
                              onClick={() => handleResolveConflict(c, 'skip')}
                              className="px-2.5 py-1.5 rounded bg-white/5 border border-glass-border text-muted text-[10px] font-bold hover:bg-white/10 transition-all cursor-pointer"
                            >
                              Skip Row
                            </button>
                            <button
                              onClick={() => handleResolveConflict(c, 'create_new')}
                              className="px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold hover:bg-amber-500/20 transition-all cursor-pointer"
                            >
                              Create New
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Database Recovery Snapshots Panel */}
              {snapshots.length > 0 && (
                <div className="glass-panel p-4 border border-glass-border bg-bg2/50 rounded-xl space-y-3">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <RotateCcw size={14} /> Database Recovery Snapshots / Rollbacks
                  </h4>
                  <div className="max-h-[150px] overflow-y-auto divide-y divide-glass-border/10 text-xs bg-bg/25 rounded-lg border border-glass-border/20 p-2">
                    {snapshots.map(snap => (
                      <div key={snap.id} className="py-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-muted text-[10px] truncate max-w-[400px]">{snap.backup_path.split('\\').pop() || snap.backup_path}</span>
                        <span className="text-muted text-[10px]">{snap.created_at}</span>
                        <button
                          onClick={async () => {
                            if (confirm('Are you sure you want to restore the database to this state? Current data will be replaced.')) {
                              try {
                                const res = await api.restoreSnapshot(snap.id);
                                alert(res.message);
                                window.location.reload();
                              } catch (err: any) {
                                alert(err.message || 'Failed to restore snapshot');
                              }
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-bold hover:bg-rose-500/20 transition-all cursor-pointer"
                        >
                          Restore DB
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Staging Explorer */}
              <div className="glass-panel overflow-hidden border border-glass-border">
                {/* Tabs Bar */}
                <div className="flex border-b border-glass-border bg-bg2 p-2 gap-2 overflow-x-auto">
                  <button
                    onClick={() => { setActiveStagingTab('inventory'); setStagingSearchQuery(''); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${activeStagingTab === 'inventory' ? 'bg-primary text-text' : 'text-muted hover:text-text bg-bg3/50'}`}
                  >
                    <Package size={14} /> Inventory ({stagingData.inventory.length})
                  </button>
                  <button
                    onClick={() => { setActiveStagingTab('sales'); setStagingSearchQuery(''); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${activeStagingTab === 'sales' ? 'bg-primary text-text' : 'text-muted hover:text-text bg-bg3/50'}`}
                  >
                    <FileCheck size={14} /> Sales Invoices ({stagingData.sales.length})
                  </button>
                  <button
                    onClick={() => { setActiveStagingTab('purchases'); setStagingSearchQuery(''); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${activeStagingTab === 'purchases' ? 'bg-primary text-text' : 'text-muted hover:text-text bg-bg3/50'}`}
                  >
                    <ShoppingCart size={14} /> Purchase Bills ({stagingData.purchases.length})
                  </button>
                  <button
                    onClick={() => { setActiveStagingTab('returns'); setStagingSearchQuery(''); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${activeStagingTab === 'returns' ? 'bg-primary text-text' : 'text-muted hover:text-text bg-bg3/50'}`}
                  >
                    <RotateCcw size={14} /> Returns ({stagingData.returns?.length || 0})
                  </button>
                  <button
                    onClick={() => { setActiveStagingTab('errors'); setStagingSearchQuery(''); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${activeStagingTab === 'errors' ? 'bg-primary text-text' : 'text-muted hover:text-text bg-bg3/50'}`}
                  >
                    <AlertTriangle size={14} /> Skipped Errors ({stagingData.errors.length})
                  </button>
                </div>

                {/* Filter and Search */}
                <div className="p-4 border-b border-glass-border bg-bg/50 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <input
                      type="text"
                      placeholder={`Search staged ${activeStagingTab} records...`}
                      value={stagingSearchQuery}
                      onChange={(e) => setStagingSearchQuery(e.target.value)}
                      className="w-full sm:max-w-md bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2.5 outline-none focus:border-primary transition-all"
                    />
                    
                    <div className="flex gap-2 w-full sm:w-auto shrink-0">
                      <button
                        onClick={() => setShowAdvFilters(!showAdvFilters)}
                        className={`premium-btn text-xs font-bold py-2 px-3.5 flex items-center gap-1.5 transition-all w-full sm:w-auto ${
                          showAdvFilters 
                            ? 'bg-primary/20 text-primary border border-primary/50' 
                            : 'bg-bg3 border border-glass-border text-muted hover:text-text'
                        }`}
                      >
                        <ChevronDown size={14} className={`transform transition-transform ${showAdvFilters ? 'rotate-180' : ''}`} />
                        Advanced Filters
                      </button>
                      
                      <button
                        onClick={() => {
                          setAdvFilters({
                            medicineName: '',
                            batch: '',
                            expiry: '',
                            distributor: '',
                            invoiceNumber: '',
                            hsnCode: '',
                            category: '',
                            tax: '',
                            mrp: '',
                            rate: '',
                            manufacturer: '',
                            marketer: '',
                            startDate: getNDaysAgoString(15),
                            endDate: getTodayString()
                          });
                          setManualToDate(false);
                        }}
                        className="premium-btn bg-bg3 border border-glass-border text-muted hover:text-text text-xs font-bold py-2 px-3.5 shrink-0"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {showAdvFilters && (
                    <div className="glass-panel p-4 bg-bg2/40 border border-glass-border/30 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Medicine Name</label>
                        <input
                          type="text"
                          value={advFilters.medicineName}
                          onChange={(e) => setAdvFilters({ ...advFilters, medicineName: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter medicine name"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Batch Number</label>
                        <input
                          type="text"
                          value={advFilters.batch}
                          onChange={(e) => setAdvFilters({ ...advFilters, batch: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none font-mono"
                          placeholder="Filter batch number"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Expiry Date</label>
                        <input
                          type="text"
                          value={advFilters.expiry}
                          onChange={(e) => setAdvFilters({ ...advFilters, expiry: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none font-mono"
                          placeholder="e.g. 12/2028"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Distributor</label>
                        <input
                          type="text"
                          value={advFilters.distributor}
                          onChange={(e) => setAdvFilters({ ...advFilters, distributor: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter distributor name"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Invoice / Bill Number</label>
                        <input
                          type="text"
                          value={advFilters.invoiceNumber}
                          onChange={(e) => setAdvFilters({ ...advFilters, invoiceNumber: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter invoice number"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">HSN Code</label>
                        <input
                          type="text"
                          value={advFilters.hsnCode}
                          onChange={(e) => setAdvFilters({ ...advFilters, hsnCode: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter HSN"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Category</label>
                        <input
                          type="text"
                          value={advFilters.category}
                          onChange={(e) => setAdvFilters({ ...advFilters, category: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter category"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Tax Percentage (%)</label>
                        <input
                          type="number"
                          value={advFilters.tax}
                          onChange={(e) => setAdvFilters({ ...advFilters, tax: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter tax rate"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">MRP (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={advFilters.mrp}
                          onChange={(e) => setAdvFilters({ ...advFilters, mrp: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter MRP"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Rate / Cost Price (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={advFilters.rate}
                          onChange={(e) => setAdvFilters({ ...advFilters, rate: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter cost rate"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Manufacturer</label>
                        <input
                          type="text"
                          value={advFilters.manufacturer}
                          onChange={(e) => setAdvFilters({ ...advFilters, manufacturer: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter manufacturer"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Marketer</label>
                        <input
                          type="text"
                          value={advFilters.marketer}
                          onChange={(e) => setAdvFilters({ ...advFilters, marketer: e.target.value })}
                          className="bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          placeholder="Filter marketer"
                        />
                      </div>
                      <div className="flex flex-col gap-1 sm:col-span-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-muted uppercase">Date Range</label>
                          <label className="text-[9px] text-muted flex items-center gap-0.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={manualToDate}
                              onChange={e => setManualToDate(e.target.checked)}
                              className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg w-2.5 h-2.5"
                            />
                            <span>Edit To Date</span>
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={advFilters.startDate}
                            min="2020-01-01"
                            max={getTodayString()}
                            onChange={(e) => handleDateFromChange(e.target.value)}
                            className="w-full bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none"
                          />
                          <span className="text-muted text-xs flex items-center">to</span>
                          <input
                            type="date"
                            value={advFilters.endDate}
                            min="2020-01-01"
                            max={getTodayString()}
                            disabled={!manualToDate}
                            onChange={(e) => handleDateToChange(e.target.value)}
                            className="w-full bg-bg3 border border-glass-border rounded-lg p-2 text-xs text-text focus:border-primary outline-none disabled:opacity-50"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Data Tables */}
                <div className="overflow-auto max-h-[450px] bg-bg/20">
                  {activeStagingTab === 'inventory' && (() => {
                    const filtered = stagingData.inventory.filter(i => matchRecord(i, 'inventory'));

                    return (
                      <table className="w-full text-xs text-left">
                        <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                          <tr>
                            <th className="p-3 text-muted font-bold">Medicine Name</th>
                            <th className="p-3 text-muted font-bold">Generic / Composition</th>
                            <th className="p-3 text-muted font-bold">Batch</th>
                            <th className="p-3 text-muted font-bold">Expiry</th>
                            <th className="p-3 text-muted font-bold text-center">Qty</th>
                            <th className="p-3 text-muted font-bold text-center">Loose Qty</th>
                            <th className="p-3 text-muted font-bold">MRP</th>
                            <th className="p-3 text-muted font-bold">Cost Price</th>
                            <th className="p-3 text-muted font-bold">Rack</th>
                            <th className="p-3 text-muted font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((i: any) => (
                            <tr key={i.id} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                              <td className="p-3 font-semibold text-text">{i.medicine_name}</td>
                              <td className="p-3 text-muted">{i.api_reference || '—'}</td>
                              <td className="p-3 font-mono text-muted">{i.batch_no || '—'}</td>
                              <td className="p-3 font-mono text-muted">{i.expiry_date || '—'}</td>
                              <td className="p-3 text-center font-bold text-sky">{i.quantity}</td>
                              <td className="p-3 text-center font-bold text-sky">{i.loose_quantity ?? 0}</td>
                              <td className="p-3 text-text">₹{i.mrp || '—'}</td>
                              <td className="p-3 text-text">₹{i.cost_price || '—'}</td>
                              <td className="p-3 text-muted font-mono">{i.rack_location || '—'}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => handleEditRecord('inventory', i)}
                                  className="text-primary hover:underline font-bold mr-3 text-[11px]"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteRecord('inventory', i.id)}
                                  className="text-red-400 hover:underline font-bold text-[11px]"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr><td colSpan={10} className="p-6 text-center text-muted">No matching staging inventory records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}

                  {activeStagingTab === 'sales' && (() => {
                    const filtered = stagingData.sales.filter(s => matchRecord(s, 'sales'));

                    return (
                      <table className="w-full text-xs text-left">
                        <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                          <tr>
                            <th className="p-3 text-muted font-bold">Invoice No</th>
                            <th className="p-3 text-muted font-bold">Date</th>
                            <th className="p-3 text-muted font-bold">Total Amount</th>
                            <th className="p-3 text-muted font-bold text-center">Total Qty</th>
                            <th className="p-3 text-muted font-bold text-center">Items</th>
                            <th className="p-3 text-muted font-bold">Patient Name</th>
                            <th className="p-3 text-muted font-bold">Doctor Name</th>
                            <th className="p-3 text-muted font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((s: any) => (
                            <tr key={s.id} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                              <td className="p-3 font-semibold text-text">{s.invoice_no}</td>
                              <td className="p-3 font-mono text-muted">{s.date || '—'}</td>
                              <td className="p-3 font-bold text-green">₹{s.total_amount || 0}</td>
                              <td className="p-3 text-center font-bold text-sky">{s.total_qty ?? 0}</td>
                              <td className="p-3 text-center text-muted">{s.item_count ?? 0}</td>
                              <td className="p-3 text-text">{s.patient_name || '—'}</td>
                              <td className="p-3 text-text">{s.doctor_name || '—'}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => handleViewItems('sales', s)}
                                  className="text-green hover:underline font-bold mr-3 text-[11px]"
                                >
                                  View Items
                                </button>
                                <button
                                  onClick={() => handleEditRecord('sales', s)}
                                  className="text-primary hover:underline font-bold mr-3 text-[11px]"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteRecord('sales', s.id)}
                                  className="text-red-400 hover:underline font-bold text-[11px]"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr><td colSpan={8} className="p-6 text-center text-muted">No matching staging sales records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}

                  {activeStagingTab === 'purchases' && (() => {
                    const filtered = stagingData.purchases.filter(p => matchRecord(p, 'purchases'));

                    return (
                      <table className="w-full text-xs text-left">
                        <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                          <tr>
                            <th className="p-3 text-muted font-bold">Invoice / Bill No</th>
                            <th className="p-3 text-muted font-bold">Date</th>
                            <th className="p-3 text-muted font-bold">Total Amount</th>
                            <th className="p-3 text-muted font-bold text-center">Total Qty</th>
                            <th className="p-3 text-muted font-bold text-center">Items</th>
                            <th className="p-3 text-muted font-bold">Distributor Name</th>
                            <th className="p-3 text-muted font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((p: any) => (
                            <tr key={p.id} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                              <td className="p-3 font-semibold text-text">{p.invoice_no}</td>
                              <td className="p-3 font-mono text-muted">{p.date || '—'}</td>
                              <td className="p-3 font-bold text-primary">₹{p.total_amount || 0}</td>
                              <td className="p-3 text-center font-bold text-sky">{p.total_qty ?? 0}</td>
                              <td className="p-3 text-center text-muted">{p.item_count ?? 0}</td>
                              <td className="p-3 text-text">{p.distributor_name || '—'}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => handleViewItems('purchases', p)}
                                  className="text-green hover:underline font-bold mr-3 text-[11px]"
                                >
                                  View Items
                                </button>
                                <button
                                  onClick={() => handleEditRecord('purchases', p)}
                                  className="text-primary hover:underline font-bold mr-3 text-[11px]"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteRecord('purchases', p.id)}
                                  className="text-red-400 hover:underline font-bold text-[11px]"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr><td colSpan={7} className="p-6 text-center text-muted">No matching staging purchases records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}

                  {activeStagingTab === 'returns' && (() => {
                    const filtered = stagingData.returns?.filter(r => matchRecord(r, 'returns')) || [];

                    return (
                      <table className="w-full text-xs text-left">
                        <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                          <tr>
                            <th className="p-3 text-muted font-bold">Return No</th>
                            <th className="p-3 text-muted font-bold">Return Invoice ID</th>
                            <th className="p-3 text-muted font-bold">Type</th>
                            <th className="p-3 text-muted font-bold">Raw Return Type</th>
                            <th className="p-3 text-muted font-bold">Date / Time</th>
                            <th className="p-3 text-muted font-bold">Total Amount</th>
                            <th className="p-3 text-muted font-bold text-center">Total Qty</th>
                            <th className="p-3 text-muted font-bold text-center">Items</th>
                            <th className="p-3 text-muted font-bold">Distributor Name</th>
                            <th className="p-3 text-muted font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((r: any) => (
                            <tr key={r.id} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                              <td className="p-3 font-semibold text-text">{r.return_no}</td>
                              <td className="p-3 font-mono text-muted">{r.return_invoice_id || '—'}</td>
                              <td className="p-3">
                                {r.return_sub_type === 'expiry' ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 border border-sky-500/20 text-sky-400">
                                    Expiry
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 border border-green-500/20 text-green-400">
                                    Good Return
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-text font-semibold">{r.raw_return_type || '—'}</td>
                              <td className="p-3 font-mono text-muted whitespace-nowrap">
                                {r.return_date_time || r.date || '—'}
                              </td>
                              <td className="p-3 font-bold text-rose-400">₹{r.total_amount || 0}</td>
                              <td className="p-3 text-center font-bold text-sky">{r.total_qty ?? 0}</td>
                              <td className="p-3 text-center text-muted">{r.item_count ?? 0}</td>
                              <td className="p-3 text-text">{r.distributor_name || '—'}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => handleViewItems('returns', r)}
                                  className="text-green hover:underline font-bold mr-3 text-[11px]"
                                >
                                  View Items
                                </button>
                                <button
                                  onClick={() => handleEditRecord('returns', r)}
                                  className="text-primary hover:underline font-bold mr-3 text-[11px]"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteRecord('returns', r.id)}
                                  className="text-red-400 hover:underline font-bold text-[11px]"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr><td colSpan={10} className="p-6 text-center text-muted">No matching staging returns records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}

                  {activeStagingTab === 'errors' && (() => {
                    const filtered = stagingData.errors.filter(e => {
                      const query = stagingSearchQuery.toLowerCase();
                      return (e.file_name || '').toLowerCase().includes(query) ||
                             (e.error_message || '').toLowerCase().includes(query) ||
                             (e.raw_data || '').toLowerCase().includes(query);
                    });

                    return (
                      <table className="w-full text-xs text-left">
                        <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                          <tr>
                            <th className="p-3 text-muted font-bold">File Name</th>
                            <th className="p-3 text-muted font-bold">Row Index</th>
                            <th className="p-3 text-muted font-bold">Error Message</th>
                            <th className="p-3 text-muted font-bold">Raw Data Preview</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((e: any) => (
                            <tr key={e.id} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                              <td className="p-3 font-semibold text-muted max-w-[150px] truncate">{e.file_name}</td>
                              <td className="p-3 font-mono text-amber-500 font-bold">{e.row_index}</td>
                              <td className="p-3 text-red-400 font-semibold">{e.error_message}</td>
                              <td className="p-3 font-mono text-[10px] text-muted max-w-[250px] truncate" title={e.raw_data}>{e.raw_data}</td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr><td colSpan={4} className="p-6 text-center text-muted">No matching skipped log errors found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleRollback}
                  disabled={rollingBack}
                  className="premium-btn bg-bg3 border border-red/20 text-red hover:bg-red-bg text-xs"
                >
                  {rollingBack ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  Rollback & Start Over
                </button>
                <button
                  onClick={finalizeMigration}
                  className="premium-btn bg-green text-text shadow-[0_0_20px_rgba(16,185,129,0.3)] font-bold"
                >
                  <Database size={16} /> Finalize & Go Live
                </button>
              </div>
            </div>
            );
          })()}
        </div>
      )}

      {/* ─── STEP 4: SUCCESS ──────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="glass-panel p-8 border border-green/30 bg-bg flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-green/25 border border-green/50 flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <CheckCircle size={32} className="text-green animate-pulse" />
            </div>
            <h3 className="text-2xl font-black text-text mb-2">Migration Successful!</h3>
            <p className="text-muted text-xs max-w-md leading-relaxed">
              The data from the staging database has been successfully merged and committed to the live system.
            </p>
          </div>

          <div className="glass-panel p-6 border border-glass-border bg-bg2 space-y-6">
            {/* Title & File details */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-glass-border pb-4">
              <div>
                <h4 className="text-base font-black text-text uppercase tracking-wide">POST IMPORT MIGRATION REPORT</h4>
                <p className="text-muted text-xs mt-1">Summary of migrated database entries</p>
              </div>
              <div className="bg-bg3 border border-glass-border rounded-lg px-3 py-2 text-right">
                <span className="text-[10px] font-bold text-muted block uppercase">Source File Name(s)</span>
                <span className="text-xs font-bold text-primary font-mono block max-w-xs truncate" title={importReport?.fileName || 'Unknown File'}>
                  {importReport?.fileName || 'Unknown File'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Metrics */}
              <div className="space-y-4">
                <h5 className="text-xs font-bold text-muted uppercase tracking-wider">Data Ingestion Metrics</h5>
                <div className="space-y-2.5">
                  {[
                    { label: 'Total Records Read', value: importReport?.recordsRead ?? 0, color: 'text-text', desc: 'Total rows processed' },
                    { label: 'Total Records Imported', value: importReport?.recordsImported ?? 0, color: 'text-green font-extrabold', desc: 'Successfully loaded to live database' },
                    { label: 'Total Records Skipped', value: importReport?.recordsSkipped ?? 0, color: 'text-amber-500', desc: 'Rows skipped due to mapping or filters' },
                    { label: 'Validation Errors', value: importReport?.validationErrors ?? 0, color: 'text-rose-400', desc: 'Rows failing validation rules' },
                    { label: 'Duplicate Records Resolved', value: importReport?.duplicateRecords ?? 0, color: 'text-sky', desc: 'Conflicts resolved during review' },
                  ].map((metric) => (
                    <div key={metric.label} className="flex items-center justify-between p-3 bg-bg3/60 rounded-xl border border-glass-border/30 hover:border-glass-border/70 transition-all">
                      <div>
                        <span className="text-xs font-bold text-text block">{metric.label}</span>
                        <span className="text-[10px] text-muted block mt-0.5">{metric.desc}</span>
                      </div>
                      <span className={`text-sm font-mono font-bold ${metric.color}`}>
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Modules Updated Checklist */}
              <div className="space-y-4">
                <h5 className="text-xs font-bold text-muted uppercase tracking-wider">System Modules Updated</h5>
                <div className="space-y-2.5 bg-bg3/40 p-4 rounded-xl border border-glass-border/30 h-[calc(100%-2rem)] flex flex-col justify-between">
                  <div className="space-y-3">
                    {[
                      { key: 'inventory', label: '📦 Inventory Updated', desc: 'Medicine stocks and locations synchronized' },
                      { key: 'purchase', label: '🛒 Purchase History Updated', desc: 'Purchase invoices, items, and cost rates registered' },
                      { key: 'sales', label: '💰 Sales History Updated', desc: 'Historical customer POS sale transactions imported' },
                      { key: 'expiry', label: '🔄 Expiry & Returns Updated', desc: 'Returns logs and credit notes processed' },
                    ].map((mod) => {
                      const isUpdated = importReport?.modulesUpdated?.[mod.key as keyof typeof importReport.modulesUpdated] ?? false;
                      return (
                        <div key={mod.key} className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                          isUpdated 
                            ? 'bg-green/10 border-green/30 text-text' 
                            : 'bg-white/5 border-glass-border/20 opacity-60 text-muted'
                        }`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                            isUpdated ? 'bg-green/20 text-green border border-green/40' : 'bg-white/5 text-muted border border-glass-border'
                          }`}>
                            {isUpdated ? '✓' : '×'}
                          </div>
                          <div>
                            <span className="text-xs font-bold block">{mod.label}</span>
                            <span className="text-[10px] text-muted block mt-0.5">{mod.desc}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed border-t border-glass-border/20 pt-3 mt-3">
                    Verified against staging constraints. Database transaction successfully committed.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 pt-4 border-t border-glass-border">
              <a href="/" className="w-full sm:w-auto premium-btn bg-primary text-text shadow-[0_0_20px_rgba(59,130,246,0.3)] text-xs font-bold px-8 py-3 text-center">
                Go to Dashboard
              </a>
              <button 
                onClick={() => { setStep(1); setFiles([]); setMigrationStatus(null); setImportReport(null); }}
                className="w-full sm:w-auto premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10 hover:text-text text-xs font-bold px-8 py-3 text-center"
              >
                Import More Files
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Preview Popup */}
      {showMappingModal && activeMappingFileIdx !== null && files[activeMappingFileIdx] && (() => {
        const file = files[activeMappingFileIdx];
        const visibleHeaders = file.headers.filter(h => {
          if (showOnlyMapped) {
            return tempMapping[h] && tempMapping[h] !== '';
          }
          return true;
        });

        return createPortal(
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-3">
            <div className="glass-panel w-full max-w-[99vw] h-[98vh] lg:max-w-[98vw] lg:h-[95vh] flex flex-col rounded-2xl border border-glass-border shadow-2xl overflow-hidden bg-bg">
              {/* Modal Header */}
              <div className="p-4 md:px-6 md:py-4 border-b border-glass-border bg-bg2 flex justify-between items-center">
                <div>
                  <h4 className="text-lg font-bold text-text flex items-center gap-2">
                    <Database size={20} className="text-primary" />
                    Migration Column Mapping
                  </h4>
                  <p className="text-muted text-xs mt-1">
                    Map the columns from "{file.originalName}" to the app fields.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowMappingModal(false);
                    setActiveMappingFileIdx(null);
                  }}
                  className="text-muted hover:text-text transition-colors text-sm font-bold bg-bg3 px-3 py-1.5 rounded-lg border border-glass-border"
                >
                  Close
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
                {file.status === 'analyzing' && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-20 flex flex-col items-center justify-center gap-3">
                    <Loader2 size={36} className="animate-spin text-primary" />
                    <span className="text-sm font-semibold text-text">Re-analyzing file with new skip lines...</span>
                  </div>
                )}

                {/* Left Column: Mappings form */}
                <div className="w-full lg:w-[48%] xl:w-[50%] p-4 md:p-5 overflow-y-auto border-b lg:border-b-0 lg:border-r border-glass-border flex flex-col gap-4">
                  
                  {/* Preset Mapping Templates Bar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg3 p-3 rounded-lg border border-glass-border/30">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted">Load Mapping Preset:</span>
                      <select
                        onChange={(e) => {
                          const template = templates.find(t => t.name === e.target.value);
                          if (template) {
                            try {
                              const parsedMappings = typeof template.mappings === 'string' ? JSON.parse(template.mappings) : template.mappings;
                              updateTempMappingWithHistory(parsedMappings);
                            } catch (err) {
                              console.error('Failed to apply template:', err);
                            }
                          }
                        }}
                        className="bg-bg border border-glass-border text-text text-xs rounded p-1.5 outline-none font-bold cursor-pointer"
                      >
                        <option value="">-- Select Template --</option>
                        {templates.filter(t => t.module_type === file.userSelectedType).map(t => (
                          <option key={t.id} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Save as template"
                        value={saveTemplateName}
                        onChange={(e) => setSaveTemplateName(e.target.value)}
                        className="bg-bg border border-glass-border text-text text-xs rounded p-1.5 outline-none flex-1 sm:flex-initial"
                      />
                      <button
                        onClick={async () => {
                          if (!saveTemplateName.trim()) return;
                          try {
                            await api.saveTemplate(saveTemplateName, file.userSelectedType, tempMapping);
                            setSaveTemplateName('');
                            const temps = await api.getTemplates();
                            setTemplates(temps || []);
                            alert('Template saved successfully!');
                          } catch (err: any) {
                            alert(err.message || 'Failed to save template');
                          }
                        }}
                        className="px-3 py-1.5 bg-primary/20 border border-primary/30 text-primary text-[11px] font-bold rounded hover:bg-primary/30 transition-all shrink-0"
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  {/* File Preprocessing Configurations inside Mapping Modal */}
                  <div className="flex flex-col gap-4 bg-bg2 p-4 rounded-xl border border-glass-border/30">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-bold text-text whitespace-nowrap">Skip top metadata rows:</label>
                        <input
                          type="number"
                          min={0}
                          value={file.skipLines || 0}
                          onChange={(e) => handleSkipLinesChange(activeMappingFileIdx, Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-16 bg-bg3 border border-glass-border text-text text-xs rounded-lg p-1.5 outline-none focus:border-primary text-center font-bold"
                        />
                        <span className="text-[10px] text-muted">(skips legacy header/shop metadata rows)</span>
                      </div>
                      
                      <div className="text-[11px] text-muted font-semibold">
                        Headers: <span className="font-mono text-primary font-bold">{file.headers.length} detected</span>
                      </div>
                    </div>

                    <div className="w-full space-y-1.5 border-t border-glass-border/10 pt-3">
                      <label className="text-xs font-bold text-text block">Ignore Specific Rows manually (comma-separated):</label>
                      <input
                        type="text"
                        placeholder="e.g. 1, 2, 5, 12, 15"
                        value={moduleFilters[file.uploadedFileName]?.ignoredRows?.join(', ') || ''}
                        onChange={(e) => {
                          const text = e.target.value;
                          const parsed = text.split(',')
                            .map(val => parseInt(val.trim()))
                            .filter(val => !isNaN(val) && val > 0);
                          setModuleFilters(prev => ({
                            ...prev,
                            [file.uploadedFileName]: { ...(prev[file.uploadedFileName] || {}), ignoredRows: parsed }
                          }));
                        }}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary font-mono"
                      />
                      <p className="text-[9px] text-muted">Allows ignoring rows that aren't visible in the first 10 rows preview.</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <h5 className="text-xs font-semibold text-muted uppercase tracking-wider">Configure Column Mappings</h5>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const updatedMapping = { ...tempMapping };
                          file.headers.forEach(h => {
                            if (!updatedMapping[h]) {
                              updatedMapping[h] = '';
                            }
                          });
                          updateTempMappingWithHistory(updatedMapping);
                        }}
                        className="px-2.5 py-1 bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-[10px] font-bold rounded-lg transition-all"
                        title="Set all unmapped columns to Ignore"
                      >
                        Ignore Unused Columns
                      </button>
                      
                      {/* Undo / Redo controls */}
                      <div className="flex items-center gap-2 bg-bg3 p-1 rounded-lg border border-glass-border">
                        <button
                          onClick={handleUndo}
                          disabled={historyIndex <= 0}
                          className="p-1 px-2 text-[10px] font-bold rounded hover:bg-bg2 disabled:opacity-30 disabled:pointer-events-none text-text transition-colors"
                          title="Undo Mapping Change"
                        >
                          Undo
                        </button>
                        <div className="w-px h-3 bg-glass-border" />
                        <button
                          onClick={handleRedo}
                          disabled={historyIndex >= mappingHistory.length - 1}
                          className="p-1 px-2 text-[10px] font-bold rounded hover:bg-bg2 disabled:opacity-30 disabled:pointer-events-none text-text transition-colors"
                          title="Redo Mapping Change"
                        >
                          Redo
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {file.headers.map((header) => {
                      const currentMapping = tempMapping[header] || '';
                      const sampleValue = file.samples[0]?.[header] || '—';

                      const isCustomMapping = currentMapping.startsWith('custom_col_');
                      const customFieldName = isCustomMapping ? currentMapping.substring(11) : '';

                      return (
                        <div 
                          key={header} 
                          onMouseEnter={() => setHoveredHeader(header)}
                          onMouseLeave={() => setHoveredHeader(null)}
                          className={`p-3 rounded-lg border transition-all flex flex-col gap-2 ${
                            hoveredHeader === header 
                              ? 'border-primary bg-bg3 shadow-[0_0_15px_rgba(59,130,246,0.2)]' 
                              : 'border-glass-border bg-bg2 hover:bg-bg3 hover:border-primary/40'
                          }`}
                        >
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-xs font-bold text-text truncate block" title={header}>
                              {header}
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-muted bg-bg px-1.5 py-0.5 rounded border border-glass-border truncate block max-w-full font-medium" title={String(sampleValue)}>
                                Sample: <span className="text-primary font-mono">{String(sampleValue)}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setActivePreviewHeader(activePreviewHeader === header ? null : header)}
                                className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-[9px] font-bold shrink-0 transition-all"
                                title="Toggle unique values preview"
                              >
                                Preview
                              </button>
                            </div>
                            
                            {activePreviewHeader === header && (
                              <div className="bg-[#121214] border border-glass-border/40 p-2 rounded-lg text-[10px] text-muted space-y-1 max-h-28 overflow-y-auto font-mono">
                                <div className="font-sans font-semibold text-text pb-1 border-b border-glass-border/10 flex justify-between items-center">
                                  <span>Sample Values</span>
                                  <button onClick={() => setActivePreviewHeader(null)} className="text-muted hover:text-white">✕</button>
                                </div>
                                {file.samples.slice(0, 10).map((s, idx) => (
                                  <div key={idx} className="truncate">{s[header] !== undefined ? String(s[header]) : '—'}</div>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1.5 w-full">
                            <select
                              value={currentMapping}
                              onFocus={() => setHoveredHeader(header)}
                              onBlur={() => setHoveredHeader(null)}
                              onChange={(e) => {
                                  if (e.target.value === 'CREATE_CUSTOM') {
                                    const colName = window.prompt("Enter new custom database column name:");
                                    if (colName) {
                                      const cleanName = colName.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                                      if (cleanName) {
                                        const customVal = `custom_col_${cleanName}`;
                                        if (!customColumns.includes(customVal)) {
                                          setCustomColumns(prev => [...prev, customVal]);
                                        }
                                        const newMapping = { ...tempMapping, [header]: customVal };
                                        updateTempMappingWithHistory(newMapping);
                                      }
                                    }
                                  } else {
                                    const newMapping = { ...tempMapping, [header]: e.target.value };
                                    updateTempMappingWithHistory(newMapping);
                                  }
                              }}
                              className="flex-1 bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary transition-all cursor-pointer font-medium"
                            >
                              <option value="" className="bg-bg text-text font-normal">-- Ignore --</option>
                              {DB_TARGET_SECTIONS.map((section) => (
                                <optgroup key={section.label} label={section.label} className="bg-bg text-primary font-semibold">
                                  {section.fields.map((f) => (
                                    <option key={`${section.label}-${f.value}`} value={f.value} className="bg-bg text-text font-normal">
                                      {f.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              
                              {/* Render Created Custom Columns */}
                              {customColumns.length > 0 && (
                                <optgroup label="✨ Created Custom Columns" className="bg-bg text-blue-400 font-semibold">
                                  {customColumns.map((c) => (
                                    <option key={c} value={c} className="bg-bg text-text font-normal">
                                      Custom Field: {c.substring(11)}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              <option value="CREATE_CUSTOM" className="bg-bg text-yellow-500 font-semibold">
                                + Add Custom Column...
                              </option>
                            </select>

                            {isCustomMapping && (
                              <button
                                onClick={() => handleDeleteCustomColumn(currentMapping)}
                                className="p-2 bg-red-bg hover:bg-red-bg/80 border border-red/20 text-red rounded-lg transition-colors shrink-0"
                                title="Delete Custom Column Mapping"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column: Sample Data Preview */}
                <div className="w-full lg:w-[52%] xl:w-[50%] p-4 md:p-5 flex flex-col overflow-hidden">
                  <div className="flex justify-between items-center mb-3 border-b border-glass-border/30 pb-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRightPreviewTab('preview')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                          rightPreviewTab === 'preview'
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'text-muted hover:text-text bg-white/5 border border-glass-border'
                        }`}
                      >
                        📋 Columns Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setRightPreviewTab('grid')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                          rightPreviewTab === 'grid'
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'text-muted hover:text-text bg-white/5 border border-glass-border'
                        }`}
                      >
                        📊 Grid View
                      </button>
                    </div>
                    {rightPreviewTab === 'grid' && (
                      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer hover:text-text select-none">
                        <input
                          type="checkbox"
                          checked={showOnlyMapped}
                          onChange={(e) => setShowOnlyMapped(e.target.checked)}
                          className="rounded border-glass-border bg-bg3 text-primary focus:ring-0 focus:ring-offset-0 focus:outline-none"
                        />
                        Show Mapped Columns Only
                      </label>
                    )}
                  </div>

                  {rightPreviewTab === 'preview' ? (
                    <div className="flex-1 overflow-auto border border-glass-border rounded-xl bg-bg3/50 p-4 space-y-3">
                      <table className="min-w-full divide-y divide-glass-border text-xs text-left">
                        <thead>
                          <tr className="border-b border-glass-border/40 text-muted uppercase tracking-wider text-[10px]">
                            <th className="pb-2 font-bold">Source Column Name</th>
                            <th className="pb-2 font-bold">Sample Value</th>
                            <th className="pb-2 font-bold">Detected Data Type</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-glass-border/30">
                          {file.headers.map((header) => {
                            const sampleValue = file.samples[0]?.[header] || '—';
                            const dataTypeStr = detectDataType(file.samples, header);
                            return (
                              <tr key={header} className="hover:bg-bg2/40 transition-colors">
                                <td className="py-2.5 font-bold text-text">{header}</td>
                                <td className="py-2.5 font-mono text-primary truncate max-w-[150px]">{String(sampleValue)}</td>
                                <td className="py-2.5">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    dataTypeStr === 'Numeric'
                                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      : dataTypeStr === 'Date'
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  }`}>
                                    {dataTypeStr}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div ref={scrollContainerRef} className="flex-1 overflow-auto border border-glass-border rounded-xl bg-bg3/50">
                      <table className="min-w-full divide-y divide-glass-border text-xs text-left">
                        <thead className="bg-bg2 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-muted font-bold w-[160px] text-center border-b border-glass-border">Row Actions</th>
                            {visibleHeaders.map((header) => {
                              const isMapped = tempMapping[header];
                              const customFieldName = isMapped && isMapped.startsWith('custom_col_') ? isMapped.substring(11) : '';
                              const fieldInfo = isMapped ? (customFieldName ? { section: 'Custom Column', label: customFieldName } : getFieldLabelAndSection(isMapped)) : null;
                              const styles = getHighlightStyles(isMapped || '', hoveredHeader === header);
                              return (
                                <th 
                                  key={header} 
                                  data-header={header}
                                  onMouseEnter={() => setHoveredHeader(header)}
                                  onMouseLeave={() => setHoveredHeader(null)}
                                  className={`px-4 py-3 font-bold border-b border-glass-border transition-all duration-150 truncate whitespace-nowrap cursor-pointer ${styles.header}`}
                                >
                                  {header}
                                  {isMapped && fieldInfo && (
                                    <span className="block text-[10px] font-bold mt-1 flex flex-wrap items-center gap-1">
                                      <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase font-semibold ${
                                        customFieldName 
                                          ? 'bg-blue-400/10 text-blue-300 border-blue-400/20' 
                                          : 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20'
                                      }`}>
                                        {fieldInfo.section}
                                      </span>
                                      <span className="truncate max-w-[120px] text-text font-normal">
                                        {fieldInfo.label}
                                      </span>
                                    </span>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-glass-border text-text font-mono">
                          {file.samples.slice(0, 10).map((row, rowIdx) => {
                            const absoluteRowIndex = rowIdx + (file.skipLines || 0) + 1; // 1-based index in the file
                            const relativeRowIdx = rowIdx + 1; // 1-based relative index after skipLines
                            const currentFilters = moduleFilters[file.uploadedFileName] || {};
                            const isRowIgnored = currentFilters.ignoredRows?.includes(relativeRowIdx);

                            return (
                              <tr key={rowIdx} className={`hover:bg-bg2 transition-colors ${isRowIgnored ? 'bg-red-500/10 text-muted opacity-40 line-through' : ''}`}>
                                <td className="px-2 py-1.5 border-r border-glass-border/20">
                                  <div className="flex items-center justify-center gap-2">
                                    {/* Checkbox to Skip */}
                                    <label className="inline-flex items-center gap-1 cursor-pointer select-none" title={isRowIgnored ? 'Include this row in migration' : 'Skip/Ignore this row'}>
                                      <input
                                        type="checkbox"
                                        checked={isRowIgnored}
                                        onChange={() => {
                                          const currentIgnored = currentFilters.ignoredRows || [];
                                          const newIgnored = currentIgnored.includes(relativeRowIdx)
                                            ? currentIgnored.filter((r: number) => r !== relativeRowIdx)
                                            : [...currentIgnored, relativeRowIdx];
                                          setModuleFilters(prev => ({
                                            ...prev,
                                            [file.uploadedFileName]: { ...currentFilters, ignoredRows: newIgnored }
                                          }));
                                        }}
                                        className="rounded border-glass-border bg-bg3 text-primary focus:ring-0 focus:ring-offset-0 focus:outline-none w-3.5 h-3.5 cursor-pointer"
                                      />
                                      <span className="text-[10px] text-muted hover:text-text font-sans font-medium">Skip</span>
                                    </label>

                                    {/* Trash Icon Button to Delete (Ignore) Row */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentIgnored = currentFilters.ignoredRows || [];
                                        const newIgnored = currentIgnored.includes(relativeRowIdx)
                                          ? currentIgnored.filter((r: number) => r !== relativeRowIdx)
                                          : [...currentIgnored, relativeRowIdx];
                                        setModuleFilters(prev => ({
                                          ...prev,
                                          [file.uploadedFileName]: { ...currentFilters, ignoredRows: newIgnored }
                                        }));
                                      }}
                                      className={`p-1 rounded border transition-all ${
                                        isRowIgnored
                                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                          : 'bg-red-bg text-red border border-red/20 hover:bg-red-bg/80'
                                      }`}                                      title={isRowIgnored ? 'Restore / Include row' : 'Delete / Ignore row'}
                                    >
                                      <Trash2 size={12} />
                                    </button>

                                    <div className="w-px h-3 bg-glass-border/30" />

                                    {/* Set Header Button */}
                                    <button
                                      type="button"
                                      onClick={() => handleSkipLinesChange(activeMappingFileIdx, absoluteRowIndex)}
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-all whitespace-nowrap"
                                      title="Set this row as the header, skipping all rows above it"
                                    >
                                      Set Header
                                    </button>
                                  </div>
                                </td>

                                {visibleHeaders.map((header) => {
                                  const isMapped = tempMapping[header];
                                  const styles = getHighlightStyles(isMapped || '', hoveredHeader === header);
                                  return (
                                    <td 
                                      key={header} 
                                      onMouseEnter={() => setHoveredHeader(header)}
                                      onMouseLeave={() => setHoveredHeader(null)}
                                      className={`px-4 py-2 truncate max-w-[200px] transition-all duration-150 ${styles.cell}`} 
                                      title={row[header]}
                                    >
                                      {row[header] !== undefined ? String(row[header]) : ''}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-glass-border bg-bg2 flex justify-between items-center">
                <div className="text-xs text-muted flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <span>Verify mappings before importing. Ensure critical fields like Medicine Name are mapped.</span>
                </div>
                
                <button
                  onClick={commitMappings}
                  className="bg-primary hover:bg-primary/95 text-text text-xs font-bold px-6 py-3 rounded-lg flex items-center gap-2 shadow-lg hover:shadow-primary/20 transition-all"
                >
                  <CheckCircle size={14} /> Confirm Mappings
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Interactive Staging Record Edit Modal */}
      {editingRecordType !== null && editingRecordData !== null && (
        createPortal(
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-panel w-full max-w-lg rounded-2xl border border-glass-border shadow-2xl overflow-hidden bg-bg">
              {/* Header */}
              <div className="p-4 border-b border-glass-border bg-bg2 flex justify-between items-center">
                <h4 className="text-sm font-bold text-text flex items-center gap-2">
                  <Database size={18} className="text-primary" />
                  Edit Staged {editingRecordType === 'inventory' ? 'Inventory Item' : editingRecordType === 'sales' ? 'Sales Invoice' : 'Purchase Bill'}
                </h4>
                <button
                  onClick={() => { setEditingRecordType(null); setEditingRecordData(null); }}
                  className="text-muted hover:text-text transition-colors text-xs font-bold bg-bg3 px-2.5 py-1 rounded-lg border border-glass-border"
                >
                  Close
                </button>
              </div>

              {/* Body */}
              <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
                {editingRecordType === 'inventory' && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Medicine Name</label>
                      <input
                        type="text"
                        value={editingRecordData.medicine_name || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, medicine_name: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Generic / Composition API Reference</label>
                      <input
                        type="text"
                        value={editingRecordData.api_reference || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, api_reference: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Batch Number</label>
                        <input
                          type="text"
                          value={editingRecordData.batch_no || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, batch_no: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Expiry Date</label>
                        <input
                          type="text"
                          value={editingRecordData.expiry_date || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, expiry_date: e.target.value })}
                          placeholder="YYYY-MM-DD"
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Quantity</label>
                        <input
                          type="number"
                          value={editingRecordData.quantity || 0}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, quantity: parseInt(e.target.value, 10) || 0 })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Loose Quantity</label>
                        <input
                          type="number"
                          value={editingRecordData.loose_quantity || 0}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, loose_quantity: parseInt(e.target.value, 10) || 0 })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">MRP (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingRecordData.mrp || 0}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, mrp: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Cost Price (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingRecordData.cost_price || 0}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, cost_price: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Rack Location</label>
                      <input
                        type="text"
                        value={editingRecordData.rack_location || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, rack_location: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                  </>
                )}

                {editingRecordType === 'sales' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Invoice Number</label>
                        <input
                          type="text"
                          value={editingRecordData.invoice_no || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, invoice_no: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Date</label>
                        <input
                          type="text"
                          value={editingRecordData.date || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, date: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Total Amount (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingRecordData.total_amount || 0}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, total_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Patient / Customer Name</label>
                      <input
                        type="text"
                        value={editingRecordData.patient_name || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, patient_name: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Doctor Name</label>
                      <input
                        type="text"
                        value={editingRecordData.doctor_name || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, doctor_name: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                  </>
                )}

                {editingRecordType === 'purchases' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Invoice / Bill Number</label>
                        <input
                          type="text"
                          value={editingRecordData.invoice_no || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, invoice_no: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Date</label>
                        <input
                          type="text"
                          value={editingRecordData.date || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, date: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Total Amount (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingRecordData.total_amount || 0}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, total_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Distributor / Supplier Name</label>
                      <input
                        type="text"
                        value={editingRecordData.distributor_name || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, distributor_name: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                  </>
                )}

                {editingRecordType === 'returns' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Return Number</label>
                        <input
                          type="text"
                          value={editingRecordData.return_no || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, return_no: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Return Invoice ID</label>
                        <input
                          type="text"
                          value={editingRecordData.return_invoice_id || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, return_invoice_id: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Return Type</label>
                        <select
                          value={editingRecordData.return_sub_type || 'good'}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, return_sub_type: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        >
                          <option value="good">Good Return</option>
                          <option value="expiry">Expiry</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Raw Return Type</label>
                        <input
                          type="text"
                          value={editingRecordData.raw_return_type || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, raw_return_type: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Return Date / Time</label>
                        <input
                          type="text"
                          value={editingRecordData.return_date_time || editingRecordData.date || ''}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, return_date_time: e.target.value })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase">Total Amount (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingRecordData.total_amount || 0}
                          onChange={(e) => setEditingRecordData({ ...editingRecordData, total_amount: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted uppercase">Distributor / Supplier Name</label>
                      <input
                        type="text"
                        value={editingRecordData.distributor_name || ''}
                        onChange={(e) => setEditingRecordData({ ...editingRecordData, distributor_name: e.target.value })}
                        className="w-full bg-bg3 border border-glass-border text-text text-xs rounded-lg p-2 outline-none focus:border-primary"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-glass-border bg-bg2 flex justify-between items-center">
                <button
                  onClick={() => { setEditingRecordType(null); setEditingRecordData(null); }}
                  className="bg-bg3 border border-glass-border hover:bg-bg3/80 text-text text-xs font-bold px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRecord}
                  disabled={savingRecord}
                  className="bg-primary hover:bg-primary/95 text-text text-xs font-bold px-6 py-2.5 rounded-lg flex items-center gap-2 shadow-lg"
                >
                  {savingRecord ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      )}

      {/* View Staged Items Modal */}
      {viewingItemsRecord !== null && (
        createPortal(
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-panel w-full max-w-3xl rounded-2xl border border-glass-border shadow-2xl overflow-hidden bg-bg">
              {/* Header */}
              <div className="p-4 border-b border-glass-border bg-bg2 flex justify-between items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-text flex items-center gap-2">
                    <Eye size={18} className="text-primary shrink-0" />
                    Staged Items — <span className="text-primary font-mono">{viewingItemsRecord.name}</span>
                  </h4>
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    <span className="text-[10px] text-muted uppercase font-bold tracking-wider">
                      {viewingItemsRecord.type === 'sales' ? 'Sales Invoice' : viewingItemsRecord.type === 'purchases' ? 'Purchase Bill' : 'Return'}
                    </span>
                    {viewingItemsRecord.patient_name && (
                      <span className="text-[11px] text-purple-300 font-semibold">👤 {viewingItemsRecord.patient_name}</span>
                    )}
                    {viewingItemsRecord.doctor_name && (
                      <span className="text-[11px] text-sky font-semibold">🩺 Dr. {viewingItemsRecord.doctor_name}</span>
                    )}
                    {viewingItemsRecord.distributor_name && (
                      <span className="text-[11px] text-amber-300 font-semibold">🏭 {viewingItemsRecord.distributor_name}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setAddingNewItem(true);
                      setNewItemData({
                        medicine_name: '',
                        batch_no: 'BATCH',
                        quantity: 1,
                        loose_qty: 0,
                        unit_price: 0,
                        cost_price: 0,
                        mrp: 0,
                        expiry_date: viewingItemsRecord.type !== 'sales' ? '2028-12-01 00:00:00' : undefined
                      });
                    }}
                    className="bg-primary hover:bg-primary/95 text-text text-xs font-bold px-3 py-1.5 rounded-lg border border-glass-border flex items-center gap-1 shadow-lg"
                  >
                    + Add Item
                  </button>
                  <button
                    onClick={() => { setViewingItemsRecord(null); setEditingItemId(null); setAddingNewItem(false); }}
                    className="text-muted hover:text-text transition-colors text-xs font-bold bg-bg3 px-2.5 py-1 rounded-lg border border-glass-border"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-5 max-h-[60vh] overflow-y-auto">
                {loadingItems ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
                    <Loader2 className="animate-spin text-primary" size={32} />
                    <span className="text-xs font-semibold">Loading items...</span>
                  </div>
                ) : viewingItems.length === 0 && !addingNewItem ? (
                  <div className="text-center py-12 text-muted text-xs">
                    No items found for this record.
                  </div>
                ) : (
                  <table className="w-full text-xs text-left">
                    <thead className="sticky top-0 bg-bg2 border-b border-glass-border">
                      <tr>
                        <th className="p-3 text-muted font-bold">Medicine Name</th>
                        <th className="p-3 text-muted font-bold">Batch</th>
                        {(viewingItemsRecord.type === 'purchases' || viewingItemsRecord.type === 'returns') && <th className="p-3 text-muted font-bold">Expiry</th>}
                        <th className="p-3 text-muted font-bold text-center">Qty</th>
                        {viewingItemsRecord.type === 'sales' && <th className="p-3 text-muted font-bold text-center">Loose Qty</th>}
                        <th className="p-3 text-muted font-bold">{viewingItemsRecord.type === 'sales' ? 'Unit Price' : 'Cost Price'}</th>
                        <th className="p-3 text-muted font-bold">MRP</th>
                        <th className="p-3 text-muted font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {addingNewItem && (
                        <tr className="bg-primary/5 border-b border-glass-border">
                          <td className="p-2">
                            <input
                              type="text"
                              placeholder="Medicine Name"
                              value={newItemData.medicine_name || ''}
                              onChange={e => setNewItemData((prev: any) => ({ ...prev, medicine_name: e.target.value }))}
                              className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              placeholder="Batch"
                              value={newItemData.batch_no || ''}
                              onChange={e => setNewItemData((prev: any) => ({ ...prev, batch_no: e.target.value }))}
                              className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                            />
                          </td>
                          {(viewingItemsRecord.type === 'purchases' || viewingItemsRecord.type === 'returns') && (
                            <td className="p-2">
                              <input
                                type="text"
                                placeholder="YYYY-MM-DD"
                                value={newItemData.expiry_date || ''}
                                onChange={e => setNewItemData((prev: any) => ({ ...prev, expiry_date: e.target.value }))}
                                className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none font-mono"
                              />
                            </td>
                          )}
                          <td className="p-2">
                            <input
                              type="number"
                              placeholder="Qty"
                              value={newItemData.quantity || 0}
                              onChange={e => setNewItemData((prev: any) => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                              className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none text-center"
                            />
                          </td>
                          {viewingItemsRecord.type === 'sales' && (
                            <td className="p-2">
                              <input
                                type="number"
                                placeholder="Loose Qty"
                                value={newItemData.loose_qty || 0}
                                onChange={e => setNewItemData((prev: any) => ({ ...prev, loose_qty: parseInt(e.target.value) || 0 }))}
                                className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none text-center"
                              />
                            </td>
                          )}
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Price"
                              value={viewingItemsRecord.type === 'sales' ? (newItemData.unit_price || 0) : (newItemData.cost_price || 0)}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setNewItemData((prev: any) => viewingItemsRecord.type === 'sales' ? ({ ...prev, unit_price: val }) : ({ ...prev, cost_price: val }));
                              }}
                              className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="MRP"
                              value={newItemData.mrp || 0}
                              onChange={e => setNewItemData((prev: any) => ({ ...prev, mrp: parseFloat(e.target.value) || 0 }))}
                              className="bg-bg3 border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                            />
                          </td>
                          <td className="p-2 text-right whitespace-nowrap space-x-2">
                            <button
                              onClick={handleAddStagedItem}
                              className="text-green hover:underline font-bold text-xs"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => setAddingNewItem(false)}
                              className="text-muted hover:underline font-bold text-xs"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      )}

                      {viewingItems.map((item: any, idx: number) => {
                        const qty = item.quantity || 0;
                        const price = viewingItemsRecord.type === 'sales' ? (item.unit_price || 0) : (item.cost_price || 0);
                        const total = viewingItemsRecord.type === 'returns' ? (item.total_price || (qty * price)) : (qty * price);
                        
                        const isEditing = editingItemId === item.id;

                        if (isEditing) {
                          return (
                            <tr key={item.id || idx} className="border-b border-glass-border bg-bg3/60">
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={editingItemData?.medicine_name || ''}
                                  onChange={e => setEditingItemData((prev: any) => ({ ...prev, medicine_name: e.target.value }))}
                                  className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={editingItemData?.batch_no || ''}
                                  onChange={e => setEditingItemData((prev: any) => ({ ...prev, batch_no: e.target.value }))}
                                  className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                                />
                              </td>
                              {(viewingItemsRecord.type === 'purchases' || viewingItemsRecord.type === 'returns') && (
                                <td className="p-2">
                                  <input
                                    type="text"
                                    value={editingItemData?.expiry_date || ''}
                                    onChange={e => setEditingItemData((prev: any) => ({ ...prev, expiry_date: e.target.value }))}
                                    className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none font-mono"
                                  />
                                </td>
                              )}
                              <td className="p-2">
                                <input
                                  type="number"
                                  value={editingItemData?.quantity || 0}
                                  onChange={e => setEditingItemData((prev: any) => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                                  className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none text-center"
                                />
                              </td>
                              {viewingItemsRecord.type === 'sales' && (
                                <td className="p-2">
                                  <input
                                    type="number"
                                    value={editingItemData?.loose_qty || 0}
                                    onChange={e => setEditingItemData((prev: any) => ({ ...prev, loose_qty: parseInt(e.target.value) || 0 }))}
                                    className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none text-center"
                                  />
                                </td>
                              )}
                              <td className="p-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={viewingItemsRecord.type === 'sales' ? (editingItemData?.unit_price || 0) : (editingItemData?.cost_price || 0)}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setEditingItemData((prev: any) => viewingItemsRecord.type === 'sales' ? ({ ...prev, unit_price: val }) : ({ ...prev, cost_price: val }));
                                  }}
                                  className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editingItemData?.mrp || 0}
                                  onChange={e => setEditingItemData((prev: any) => ({ ...prev, mrp: parseFloat(e.target.value) || 0 }))}
                                  className="bg-bg border border-glass-border rounded px-2 py-1 text-xs text-text focus:border-primary w-full outline-none"
                                />
                              </td>
                              <td className="p-2 text-right whitespace-nowrap space-x-2">
                                <button
                                  onClick={() => handleSaveStagedItem(item.id)}
                                  className="text-green hover:underline font-bold text-xs"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => { setEditingItemId(null); setEditingItemData(null); }}
                                  className="text-muted hover:underline font-bold text-xs"
                                >
                                  Cancel
                                </button>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={item.id || idx} className="border-b border-glass-border/20 hover:bg-bg2/40 transition-colors">
                            <td className="p-3 font-semibold text-text">{item.medicine_name || 'Unknown Medicine'}</td>
                            <td className="p-3 font-mono text-muted">{item.batch_no || '—'}</td>
                            {(viewingItemsRecord.type === 'purchases' || viewingItemsRecord.type === 'returns') && <td className="p-3 font-mono text-muted">{item.expiry_date || '—'}</td>}
                            <td className="p-3 text-center text-text font-semibold">{qty}</td>
                            {viewingItemsRecord.type === 'sales' && <td className="p-3 text-center text-muted">{item.loose_qty || 0}</td>}
                            <td className="p-3 text-text">₹{price}</td>
                            <td className="p-3 text-text">₹{item.mrp || 0}</td>
                            <td className="p-3 text-right text-text whitespace-nowrap">
                              <span className="font-bold mr-3">₹{total.toFixed(2)}</span>
                              <button
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingItemData({ ...item });
                                }}
                                className="text-primary hover:underline font-bold text-[11px] mr-2"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteStagedItem(item.id)}
                                className="text-red-400 hover:underline font-bold text-[11px]"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-glass-border bg-bg2 flex justify-end">
                <button
                  onClick={() => { setViewingItemsRecord(null); setEditingItemId(null); setAddingNewItem(false); }}
                  className="bg-bg3 border border-glass-border hover:bg-bg3/80 text-text text-xs font-bold px-5 py-2 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      )}
    </div>
  );
};

export default Migration;
