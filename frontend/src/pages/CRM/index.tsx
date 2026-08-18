import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiClient, api } from '../../services/api';
import type { SpecialOrder } from '../../services/api';
import {
  RefreshCw, Send, Users, MessageSquare, Phone, Calendar,
  CheckCircle2, AlertCircle, Clock, Search, Repeat2, Bell,
  MessageCircle, Check, Package, Mail, ExternalLink, LogOut, Zap, Copy, FileText, X, Plus, Trash2, Sliders, ChevronDown, Info, ClipboardList, ShoppingCart, AlertTriangle, Pencil, Edit2, RotateCcw
} from 'lucide-react';
import { toastEvent, specialOrdersEvent, liveCartAddEvent, refillEvent, messageSendEvent, whatsappQueueEvent } from '../../services/events';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { getTodayString, getNDaysAgoString, formatDisplayDate, toDateInputValue } from '../../utils/date';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { isValid10DigitPhone } from '../../utils/phone';

// ─── Module-level Cache (SPA Performance Contract) ──────────────────────
let cachedRefillsData: RefillPatient[] = [];

/** Silent retry for cold-boot transient failures — toast only after retries exhausted */
async function withSilentRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RefillPatient {
  customer_id?: number;
  patient_name: string;
  patient_phone: string;
  next_refill_date: string;
  medicines: {
    id: number;
    medicine_id?: number;
    medicine_name: string;
    quantity_needed: number;
    refill_interval_days?: number;
    in_stock_qty: number;
    is_ready: number;
    acknowledged: number;
    hold_for_stock: number;
    is_active?: number;
    status: string;
    quick_bill_id: number | null;
    inventory_id?: number;
    batch_no?: string;
    expiry_date?: string;
    mrp?: number;
    sell_price?: number;
    unit_price?: number;
  }[];
}

interface AutomationLog {
  id: number;
  type: string;
  status: string;
  recipient: string;
  message: string;
  created_at: string;
  sent_at?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: number | string) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

const TABS = [
  { key: 'refills', label: 'Refills', icon: <Repeat2 size={15} /> },
  { key: 'special_orders', label: 'Special Requests', icon: <ClipboardList size={15} /> },
  { key: 'credit', label: 'Customer Credit', icon: <Users size={15} /> },
  { key: 'messages', label: 'Distributor Messages', icon: <Bell size={15} /> },
  { key: 'whatsapp', label: 'WhatsApp Business', icon: <MessageCircle size={15} /> },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REFILLS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Add-Refill form types ────────────────────────────────────────────────────

interface MedicineSuggestion {
  id: number;
  name: string;
  manufacturer?: string;
  mrp?: number;
  in_stock_qty?: number;
}

interface MedicineRow {
  medicineId: number | null;
  medicineName: string;
  manufacturer?: string;
  mrp?: number;
  inStockQty?: number;
  quantity_needed: number;
  searchTerm: string;
  suggestions: MedicineSuggestion[];
  isOpen: boolean;
  loadingSuggestions?: boolean;
}

const emptyRow = (): MedicineRow => ({
  medicineId: null,
  medicineName: '',
  quantity_needed: 3,
  searchTerm: '',
  suggestions: [],
  isOpen: false,
  loadingSuggestions: false
});

const RefillsSection: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<RefillPatient[]>(cachedRefillsData);
  const [loading, setLoading] = useState(cachedRefillsData.length === 0);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [runningCheck, setRunningCheck] = useState(false);

  // ── Add / Edit Refill modal state ──────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState<RefillPatient | null>(null);
  const [addPatientName, setAddPatientName] = useState('');
  const [addPatientPhone, setAddPatientPhone] = useState('');
  
  // Frequency state: preset vs custom
  const [freqMode, setFreqMode] = useState<'preset' | 'custom'>('preset');
  const [addInterval, setAddInterval] = useState(30);
  const [customValue, setCustomValue] = useState(15);
  const [customUnit, setCustomUnit] = useState<'days' | 'weeks' | 'months'>('days');

  const [medicineRows, setMedicineRows] = useState<MedicineRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenAddModal = () => {
    setEditingPatient(null);
    setAddPatientName('');
    setAddPatientPhone('');
    setAddInterval(30);
    setFreqMode('preset');
    setMedicineRows([emptyRow()]);
    setShowAddModal(true);
  };

  const handleEditPatientRefill = (patient: RefillPatient) => {
    setEditingPatient(patient);
    setAddPatientName(patient.patient_name || '');
    setAddPatientPhone(patient.patient_phone || '');
    const interval = patient.medicines[0]?.refill_interval_days || 30;
    setFreqMode('preset');
    setAddInterval(interval);
    if (patient.medicines && patient.medicines.length > 0) {
      setMedicineRows(patient.medicines.map(m => ({
        medicineId: m.medicine_id || m.id,
        medicineName: m.medicine_name,
        searchTerm: m.medicine_name,
        suggestions: [],
        isOpen: false,
        quantity_needed: m.quantity_needed || 3,
        inStockQty: m.in_stock_qty || 0
      })));
    } else {
      setMedicineRows([emptyRow()]);
    }
    setShowAddModal(true);
    toastEvent.trigger(`Editing refill schedule for ${patient.patient_name}`, 'info', '/crm');
  };

  // Effective interval calculation helper
  const getEffectiveIntervalDays = useCallback(() => {
    if (freqMode === 'preset') return addInterval;
    const val = Math.max(1, Number(customValue) || 1);
    if (customUnit === 'weeks') return val * 7;
    if (customUnit === 'months') return val * 30;
    return val;
  }, [freqMode, addInterval, customValue, customUnit]);

  const load = useCallback(async (silent = false) => {
    if (!silent && cachedRefillsData.length === 0) setLoading(true);
    try {
      const r = await withSilentRetry(() => apiClient.get<RefillPatient[]>('/refills/panel'));
      const list = Array.isArray(r.data) ? r.data : [];
      cachedRefillsData = list;
      setData(list);
    } catch { 
      if (!silent) toastEvent.trigger('Failed to load refills', 'error', '/crm'); 
    }
    finally { setLoading(false); }
  }, []);

  const [statusTab, setStatusTab] = useState<'all' | 'active' | 'paused' | 'canceled'>('all');
  const [editingRefill, setEditingRefill] = useState<{ id: number; currentInterval: number; name: string } | null>(null);
  const [editIntervalVal, setEditIntervalVal] = useState<number>(30);
  const [updatingFreq, setUpdatingFreq] = useState(false);

  const handleUpdateFrequency = async () => {
    if (!editingRefill) return;
    setUpdatingFreq(true);
    try {
      await apiClient.put(`/refills/${editingRefill.id}/frequency`, { refill_interval_days: editIntervalVal });
      toastEvent.trigger(`Updated refill frequency to ${editIntervalVal} days for "${editingRefill.name}"`, 'success', '/crm');
      setEditingRefill(null);
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to update frequency', 'error', '/crm');
    } finally {
      setUpdatingFreq(false);
    }
  };

  const handleTogglePauseRefill = async (refillId: number, currentIsActive: boolean) => {
    try {
      const res = await apiClient.post(`/refills/${refillId}/toggle-pause`);
      toastEvent.trigger(res.data?.message || `Refill ${currentIsActive ? 'paused' : 'resumed'}`, 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to toggle pause state', 'error', '/crm');
    }
  };

  const handleCancelRefill = async (refillId: number) => {
    if (!window.confirm('Are you sure you want to cancel this refill schedule? (It will stay preserved in your history)')) return;
    try {
      await apiClient.post(`/refills/${refillId}/cancel`);
      toastEvent.trigger('Refill schedule canceled and preserved in history', 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to cancel refill', 'error', '/crm');
    }
  };

  const handleRenewRefill = (patient: RefillPatient) => {
    setEditingPatient(null);
    setShowAddModal(true);
    setAddPatientName(patient.patient_name);
    setAddPatientPhone(patient.patient_phone);
    const interval = patient.medicines[0]?.refill_interval_days || 30;
    setFreqMode('preset');
    setAddInterval(interval);
    setMedicineRows(patient.medicines.map(m => ({
      medicineId: m.medicine_id || m.id,
      medicineName: m.medicine_name,
      searchTerm: m.medicine_name,
      suggestions: [],
      isOpen: false,
      quantity_needed: m.quantity_needed || 3,
      inStockQty: m.in_stock_qty || 0
    })));
    toastEvent.trigger(`Pre-filled refill renewal form for ${patient.patient_name}`, 'info', '/crm');
  };

  useEffect(() => {
    load();
    const unsub = refillEvent.subscribeRefresh(() => load(true));
    return () => unsub();
  }, [load]);

  useEffect(() => {
    const handleSync = () => {
      load(true);
    };
    window.addEventListener('phone-numbers-updated', handleSync);
    window.addEventListener('contacts-updated', handleSync);
    window.addEventListener('distributors-updated', handleSync);
    return () => {
      window.removeEventListener('phone-numbers-updated', handleSync);
      window.removeEventListener('contacts-updated', handleSync);
      window.removeEventListener('distributors-updated', handleSync);
    };
  }, [load]);

  useEffect(() => {
    if (!showAddModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAddModal]);

  const handleCheck = async () => {
    setRunningCheck(true);
    try {
      await apiClient.post('/refills/check');
      toastEvent.trigger('Refill check triggered', 'success', '/crm');
      refillEvent.triggerRefresh();
      await load(true);
    } catch { toastEvent.trigger('Failed to run check', 'error', '/crm'); }
    finally { setRunningCheck(false); }
  };

  // ── Remind Now: always-active, calls new endpoint ─────────────────────────
  const handleRemindNow = async (phone: string) => {
    setSending(phone);
    try {
      await apiClient.post('/refills/send-reminder-now', { patient_phone: phone });
      toastEvent.trigger(`WhatsApp reminder queued for ${phone}`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to send reminder', 'error', '/crm');
    } finally { setSending(null); }
  };

  // ── Sell Refill Patient → POS ─────────────────────────────────────────────
  const handleSellRefillPatient = (patient: RefillPatient) => {
    navigate('/pos', {
      state: {
        prefill: {
          patientName: patient.patient_name,
          patientPhone: patient.patient_phone,
          customerId: patient.customer_id || undefined,
          refillPatient: true,
          medicines: patient.medicines.map(m => ({
            medicineId: m.medicine_id,
            medicine_id: m.medicine_id,
            medicine_name: m.medicine_name,
            medicineName: m.medicine_name,
            quantity_needed: m.quantity_needed || 1,
            quantity: m.quantity_needed || 1,
            inventory_id: m.inventory_id,
            batch_no: m.batch_no,
            expiry_date: m.expiry_date,
            mrp: m.mrp,
            sell_price: m.sell_price,
            unit_price: m.unit_price || m.sell_price || m.mrp || 0
          }))
        }
      }
    });
    toastEvent.trigger(`Transferring ${patient.medicines.length} prescribed medicine(s) for ${patient.patient_name} to POS...`, 'info', '/pos');
  };

  const handleAddRefillShortageToCart = async (medicineName: string, orderQty: number) => {
    try {
      const res = await api.addPharmarackCart([{
        productId: 0,
        storeId: 0,
        qty: orderQty,
        productName: medicineName
      }]);
      if (res && res.success) {
        toastEvent.trigger(`Added ${orderQty} unit(s) of "${medicineName}" to Pharmarack Live Cart!`, 'success', '/crm');
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
      } else {
        toastEvent.trigger(res?.error || 'Failed to add item to live cart', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || 'Failed to add to live cart', 'error', '/crm');
    }
  };

  // ── Medicine row search & inventory dropdown ──────────────────────────────
  const fetchSuggestions = async (idx: number, term: string) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      if (updated[idx]) {
        updated[idx] = { ...updated[idx], loadingSuggestions: true, isOpen: true };
      }
      return updated;
    });

    try {
      let suggestions: MedicineSuggestion[] = [];
      const clean = term.trim();
      if (!clean) {
        const res = await apiClient.get<any[]>('/medicines/compact');
        const list = Array.isArray(res.data) ? res.data : [];
        suggestions = list.slice(0, 15).map(m => ({
          id: m.id || m.medicine_id,
          name: m.name || m.medicine_name,
          manufacturer: m.manufacturer,
          mrp: m.mrp,
          in_stock_qty: m.quantity !== undefined ? m.quantity : (m.in_stock_qty || 0)
        }));
      } else {
        const res = await apiClient.get<any[]>(`/sales/search-medicine?q=${encodeURIComponent(clean)}`);
        const list = Array.isArray(res.data) ? res.data : [];
        if (list.length > 0) {
          suggestions = list.slice(0, 15).map(m => ({
            id: m.medicine_id || m.id,
            name: m.medicine_name || m.name,
            manufacturer: m.manufacturer,
            mrp: m.mrp,
            in_stock_qty: m.quantity !== undefined ? m.quantity : (m.in_stock_qty || 0)
          }));
        } else {
          const fallback = await apiClient.get<any[]>(`/medicines/search-fast?q=${encodeURIComponent(clean)}&limit=10`);
          const fbList = Array.isArray(fallback.data) ? fallback.data : [];
          suggestions = fbList.map(m => ({
            id: m.id || m.medicine_id,
            name: m.name || m.medicine_name,
            manufacturer: m.manufacturer,
            mrp: m.mrp,
            in_stock_qty: m.quantity !== undefined ? m.quantity : (m.in_stock_qty || 0)
          }));
        }
      }

      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], suggestions, loadingSuggestions: false, isOpen: true };
        }
        return updated;
      });
    } catch {
      setMedicineRows(prev => {
        const updated = [...prev];
        if (updated[idx]) {
          updated[idx] = { ...updated[idx], loadingSuggestions: false };
        }
        return updated;
      });
    }
  };

  const searchDebounceRef = useRef<{ [key: number]: any }>({});

  const handleMedicineSearch = (idx: number, term: string) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        searchTerm: term,
        medicineName: term,
        medicineId: null,
        isOpen: true
      };
      return updated;
    });

    if (searchDebounceRef.current[idx]) {
      clearTimeout(searchDebounceRef.current[idx]);
    }
    searchDebounceRef.current[idx] = setTimeout(() => {
      fetchSuggestions(idx, term);
    }, 300);
  };

  const selectMedicine = (idx: number, s: MedicineSuggestion) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        medicineId: s.id,
        medicineName: s.name,
        manufacturer: s.manufacturer,
        mrp: s.mrp,
        inStockQty: s.in_stock_qty,
        searchTerm: s.name,
        suggestions: [],
        isOpen: false
      };
      return updated;
    });
  };

  const updateQty = (idx: number, qty: number) => {
    setMedicineRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity_needed: Math.max(1, qty) };
      return updated;
    });
  };

  // ── Submit Add / Edit Refill ──────────────────────────────────────────────
  const handleSaveRefill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addPatientName.trim() || !addPatientPhone.trim()) {
      toastEvent.trigger('Patient name and phone are required', 'error');
      return;
    }
    const validRows = medicineRows.filter(r => r.medicineId);
    if (validRows.length === 0) {
      toastEvent.trigger('Please select at least one medicine from the inventory dropdown', 'error');
      return;
    }
    const intervalDays = getEffectiveIntervalDays();
    setSubmitting(true);
    try {
      if (editingPatient) {
        // Update existing patient refills
        await apiClient.put('/refills/patient-medicines', {
          original_phone: editingPatient.patient_phone,
          patient_name: addPatientName.trim(),
          patient_phone: addPatientPhone.trim(),
          refill_interval_days: intervalDays,
          medicines: validRows.map(row => ({
            medicine_id: row.medicineId,
            medicine_name: row.medicineName,
            quantity_needed: row.quantity_needed || 3
          }))
        });
        toastEvent.trigger(`Refill updated for ${addPatientName} (${validRows.length} medicine${validRows.length > 1 ? 's' : ''}, every ${intervalDays} days)`, 'success', '/crm');
      } else {
        await Promise.all(
          validRows.map(row =>
            apiClient.post('/refills', {
              patient_name: addPatientName.trim(),
              patient_phone: addPatientPhone.trim(),
              medicine_id: row.medicineId,
              refill_interval_days: intervalDays,
              quantity_needed: row.quantity_needed || 3
            })
          )
        );
        toastEvent.trigger(`Refill registered for ${addPatientName} (${validRows.length} medicine${validRows.length > 1 ? 's' : ''}, every ${intervalDays} days)`, 'success', '/crm');
      }
      setShowAddModal(false);
      setEditingPatient(null);
      setAddPatientName('');
      setAddPatientPhone('');
      setAddInterval(30);
      setFreqMode('preset');
      setMedicineRows([emptyRow()]);
      refillEvent.triggerRefresh();
      await load();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || (editingPatient ? 'Failed to update refill' : 'Failed to add refill'), 'error', '/crm');
    } finally { setSubmitting(false); }
  };

  const filtered = data.filter(p => {
    const matchesSearch = p.patient_name?.toLowerCase().includes(search.toLowerCase()) || p.patient_phone?.includes(search);
    if (!matchesSearch) return false;

    if (statusTab === 'active') {
      return p.medicines.some(m => m.is_active !== 0 && m.status !== 'canceled');
    }
    if (statusTab === 'paused') {
      return p.medicines.some(m => m.is_active === 0 || m.status === 'paused');
    }
    if (statusTab === 'canceled') {
      return p.medicines.some(m => m.status === 'canceled');
    }
    return true; // 'all'
  });

  const overdue = filtered.filter(p => new Date(p.next_refill_date) < new Date());
  const upcoming = filtered.filter(p => new Date(p.next_refill_date) >= new Date());

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => {
              const val = e.target.value;
              setSearch(val.includes('|') ? val.split('|')[0].trim() : val);
            }}
            placeholder="Search patient, phone or barcode..."
            className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Refill Status Filter Tabs */}
        <div className="flex items-center bg-bg border border-border rounded-xl p-0.5 shrink-0">
          {(['all', 'active', 'paused', 'canceled'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusTab(tab)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all capitalize cursor-pointer ${
                statusTab === tab
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-text hover:bg-bg3'
              }`}
            >
              {tab === 'all' ? 'All Refills' : tab}
            </button>
          ))}
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          <Plus size={14} />
          Add Refill
        </button>
        <button
          onClick={handleCheck}
          disabled={runningCheck}
          className="flex items-center gap-2 px-3 py-2 bg-bg2 border border-border text-muted rounded-lg text-sm font-medium hover:bg-bg3 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={runningCheck ? 'animate-spin' : ''} />
          {runningCheck ? 'Checking…' : 'Run Check'}
        </button>
        <button onClick={() => load()} className="p-2 bg-bg2 border border-border rounded-lg hover:bg-bg3 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
        <div className="ml-auto flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{overdue.length} Overdue</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent inline-block" />{upcoming.length} Upcoming</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading refills…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted gap-2">
            <CheckCircle2 size={32} className="text-green-500/50" />
            <p className="text-sm">No refill records found for this filter tab</p>
          </div>
        )}
        {[...overdue, ...upcoming].map((patient) => {
          const today = new Date();
          const dueDate = new Date(patient.next_refill_date);
          const isOverdue = dueDate < today;
          const diffMs = dueDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          // 5-6 Days Lead Window (Notification Buffer before due date)
          const isLeadWindowActive = !isOverdue && diffDays <= 6 && diffDays >= 0;
          const hasShortage = patient.medicines.some(m => Number(m.quantity_needed || 3) > Number(m.in_stock_qty || 0));
          const is3DayStockAlert = !isOverdue && diffDays <= 3 && hasShortage;

          const allReady = patient.medicines.every(m => m.is_ready);
          return (
            <div
              key={`${patient.patient_phone}-${patient.next_refill_date}`}
              className={`bg-bg border rounded-xl p-4 transition-all ${
                isOverdue ? 'border-red-500/30' : 
                is3DayStockAlert ? 'border-amber-500/50' : 
                isLeadWindowActive ? 'border-primary/40' : 'border-border'
              }`}
            >
              {/* Lead Window Notification Banner */}
              {isLeadWindowActive && (
                <div className="mb-3 px-3 py-2 bg-bg border border-amber-500/30 rounded-xl text-xs font-bold text-amber-400 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base animate-bounce">🔔</span>
                    <span>Refill On The Way! 5-6 Day Lead Notification Window Active (Due in {diffDays} day{diffDays !== 1 ? 's' : ''})</span>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">Order Prep Window</span>
                </div>
              )}

              {/* 3-Day Automated Inventory Stock Check Alert */}
              {is3DayStockAlert && (
                <div className="mb-3 px-3 py-2 bg-bg border border-red-500/30 rounded-xl text-xs font-extrabold text-red-400 flex items-center justify-between flex-wrap gap-2 animate-pulse">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-red-400 shrink-0" />
                    <span>Automated 3-Day Inventory Stock Check: Shortage detected! Need items pushed to Live Cart.</span>
                  </div>
                  <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-md font-mono uppercase tracking-wider">3-Day Stock Alert</span>
                </div>
              )}

              {/* Patient header */}
              <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${isOverdue ? 'bg-red-500/15 text-red-400' : 'bg-primary/15 text-primary'}`}>
                    {patient.patient_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text">{patient.patient_name}</p>
                    <p className="text-xs text-muted flex items-center gap-1">
                      <Phone size={10} /> {patient.patient_phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isOverdue ? 'bg-red-500/15 text-red-400' : 'bg-accent/15 text-accent'}`}>
                    <Calendar size={10} />
                    {isOverdue ? 'Overdue · ' : 'Due · '}{formatDate(patient.next_refill_date)}
                  </div>
                  {/* Edit Patient Refill */}
                  <button
                    type="button"
                    onClick={() => handleEditPatientRefill(patient)}
                    title="Edit patient refill details, medicines, quantities & frequency"
                    className="flex items-center gap-1 px-3 py-1.5 bg-bg2 border border-border hover:border-primary/50 text-text hover:bg-bg3 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Edit2 size={12} className="text-primary" />
                    <span>Edit</span>
                  </button>
                  {/* Renew Schedule */}
                  <button
                    type="button"
                    onClick={() => handleRenewRefill(patient)}
                    title="Renew or duplicate this patient's refill schedule into new entry"
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Repeat2 size={12} />
                    <span>Renew Schedule</span>
                  </button>
                  {/* Remind Now — always active */}
                  <button
                    onClick={() => handleRemindNow(patient.patient_phone)}
                    disabled={sending === patient.patient_phone}
                    title="Send WhatsApp reminder now"
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-50"
                  >
                    <Send size={11} className={sending === patient.patient_phone ? 'animate-pulse' : ''} />
                    {sending === patient.patient_phone ? 'Sending…' : 'Remind Now'}
                  </button>
                  {/* Sell Now → POS */}
                  <button
                    onClick={() => handleSellRefillPatient(patient)}
                    title="Sell now: Pre-loads all prescribed medicines & quantities into POS"
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <ShoppingCart size={13} />
                    <span>⚡ Sell Now</span>
                  </button>
                </div>
              </div>

              {/* Medicines with Shortage Calculation, Inline Freq Slider, Pause/Resume & Direct Live Cart Button */}
              <div className="space-y-1.5">
                {patient.medicines.map(med => {
                  const reqQty = Number(med.quantity_needed !== undefined && med.quantity_needed !== null ? med.quantity_needed : 3);
                  const stockQty = Number(med.in_stock_qty || 0);
                  const shortageQty = Math.max(0, reqQty - stockQty);
                  const cartOrderQty = shortageQty > 0 ? shortageQty : reqQty;
                  const isPaused = med.is_active === 0 || med.status === 'paused';
                  const isCanceled = med.status === 'canceled';

                  return (
                    <div key={med.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border flex-wrap transition-all ${
                      isCanceled ? 'bg-red-500/5 border-red-500/20 opacity-75' :
                      isPaused ? 'bg-amber-500/5 border-amber-500/20' :
                      'bg-bg3/50 border-border/40'
                    }`}>
                      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <Package size={13} className={isCanceled ? 'text-red-400' : isPaused ? 'text-amber-400' : 'text-primary'} />
                        <span className={`text-xs font-semibold text-text truncate ${isCanceled ? 'line-through opacity-70' : ''}`}>{med.medicine_name}</span>
                        {isPaused && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            ⏸️ Paused
                          </span>
                        )}
                        {isCanceled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-500/20 text-red-400 border border-red-500/30">
                            ❌ Canceled
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Edit Frequency Slider Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRefill({ id: med.id, currentInterval: med.refill_interval_days || 30, name: med.medicine_name });
                            setEditIntervalVal(med.refill_interval_days || 30);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg border border-border hover:border-primary/50 text-muted hover:text-text text-[10px] font-semibold transition-all cursor-pointer"
                          title="Modify Refill Frequency / Due Date with Interactive Slider"
                        >
                          <Sliders size={10} className="text-accent" />
                          <span>{med.refill_interval_days || 30}d Cycle (Edit)</span>
                        </button>

                        {/* Pause / Resume Toggle Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePauseRefill(med.id, med.is_active !== 0);
                          }}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                            med.is_active !== 0
                              ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-400'
                              : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-400'
                          }`}
                          title={med.is_active !== 0 ? 'Pause refill notifications and orders for this medicine' : 'Resume refill schedule for this medicine'}
                        >
                          {med.is_active !== 0 ? '⏸️ Pause' : '▶️ Resume'}
                        </button>

                        {/* Cancel Button */}
                        {!isCanceled && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelRefill(med.id);
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold transition-all cursor-pointer"
                            title="Cancel and archive this refill schedule"
                          >
                            <X size={10} />
                            <span>Cancel</span>
                          </button>
                        )}

                        <span className="text-[11px] font-medium text-muted">
                          Req: <strong className="text-text">{reqQty}</strong>
                        </span>
                        <span className="text-[11px] font-medium text-muted">
                          Stock: <strong className={stockQty > 0 ? 'text-emerald-400' : 'text-red-400'}>{stockQty}</strong>
                        </span>

                        {shortageQty > 0 ? (
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-extrabold">
                            Need Order: {shortageQty}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                            In Stock
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddRefillShortageToCart(med.medicine_name, cartOrderQty);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-[10px] font-bold transition-all cursor-pointer shadow-xs"
                          title={`Add ${cartOrderQty} unit(s) of "${med.medicine_name}" directly to Pharmarack Live Cart`}
                        >
                          <ShoppingCart size={11} />
                          <span>+ Live Cart ({cartOrderQty})</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {allReady && (
                <div className="mt-2 flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle2 size={11} /> All medicines ready for dispensing
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Add / Edit Refill Modal ─────────────────────────────────────────── */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0 bg-bg3/40">
              <div>
                <h3 className="text-sm font-bold text-text flex items-center gap-2">
                  {editingPatient ? <Edit2 size={18} className="text-primary" /> : <Repeat2 size={18} className="text-primary" />}
                  {editingPatient ? 'Edit Patient Refill' : 'Add New Patient Refill'}
                </h3>
                <p className="text-[11px] text-muted mt-0.5">
                  {editingPatient
                    ? 'Modify prescribed medications, quantities, or refill frequency'
                    : 'Select medication directly from inventory & set flexible refill frequency'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingPatient(null);
                }}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveRefill} className="p-5 space-y-5 overflow-y-auto flex-1">
              {/* Patient Details */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                  <Users size={11} className="text-primary" />
                  Patient Details
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={addPatientName}
                      onChange={e => setAddPatientName(e.target.value)}
                      placeholder="Patient Full Name *"
                      required
                      className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <PhoneInputWithBadge
                      value={addPatientPhone}
                      onChange={val => setAddPatientPhone(val)}
                      placeholder="Phone / WhatsApp (10 digits) *"
                      required={true}
                      allowEmpty={false}
                    />
                  </div>
                </div>
              </div>

              {/* Flexible Frequency Manager with Interactive Slider & Presets */}
              <div className="bg-bg3/30 border border-border rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Sliders size={11} className="text-accent" />
                    Flexible Frequency Manager (Slider &amp; Presets)
                  </label>
                  <span className="text-xs font-black text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/30">
                    {getEffectiveIntervalDays()} Days Interval
                  </span>
                </div>

                {/* Quick Presets: 15, 30, 90 Days */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { days: 15, label: '15 Days' },
                    { days: 30, label: '30 Days' },
                    { days: 90, label: '90 Days' },
                    { days: 60, label: '60 Days' }
                  ].map(opt => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => {
                        setFreqMode('preset');
                        setAddInterval(opt.days);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-xs text-center border font-bold transition-all cursor-pointer ${
                        freqMode === 'preset' && addInterval === opt.days
                          ? 'bg-primary border-primary text-white shadow-md'
                          : 'bg-bg border-border text-muted hover:text-text hover:bg-bg2'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Interactive Slider Input */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-muted">
                    <span>1 Day</span>
                    <span className="text-text font-bold">Slide to adjust: {getEffectiveIntervalDays()} Days</span>
                    <span>180 Days</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={180}
                    value={getEffectiveIntervalDays()}
                    onChange={e => {
                      setFreqMode('preset');
                      setAddInterval(Number(e.target.value));
                    }}
                    className="w-full h-2 bg-bg border border-border rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>

                {/* Dynamic Due Date & 5-Day Lead Notice Banner */}
                {(() => {
                  const effDays = getEffectiveIntervalDays();
                  const dueDate = new Date();
                  dueDate.setDate(dueDate.getDate() + effDays);

                  const leadDate = new Date(dueDate);
                  leadDate.setDate(leadDate.getDate() - 5);

                  const formattedDue = dueDate.toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  });

                  const formattedLead = leadDate.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short'
                  });

                  return (
                    <div className="flex flex-col gap-1 px-3 py-2 bg-accent/10 border border-accent/20 rounded-xl text-xs text-accent">
                      <div className="flex items-center gap-2">
                        <Calendar size={13} className="flex-shrink-0 text-accent" />
                        <span>Calculated Due Date: <strong>{formattedDue}</strong> ({effDays}-day cycle)</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-amber-400 font-medium pl-5">
                        <span>🔔 Auto Lead Window Active: <strong>{formattedLead}</strong> (5 days before due date for order prep)</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Inventory Medicine Selector */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                    <Package size={11} className="text-primary" />
                    Medicines & Inventory Selection *
                  </label>
                  <button
                    type="button"
                    onClick={() => setMedicineRows(prev => [...prev, emptyRow()])}
                    className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <Plus size={12} /> Add Another Medicine
                  </button>
                </div>

                <div className="space-y-3">
                  {medicineRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="bg-bg border border-border rounded-xl p-3 space-y-2 shadow-xs hover:border-border/80 transition-all"
                    >
                      <div className="flex items-start gap-2">
                        {/* Medicine Dropdown Input */}
                        <div className="relative flex-1">
                          <div className="relative">
                            <Search size={13} className="absolute left-3 top-3 text-muted" />
                            <input
                              type="text"
                              value={row.searchTerm}
                              onFocus={() => {
                                if (row.suggestions.length === 0) {
                                  fetchSuggestions(idx, row.searchTerm);
                                } else {
                                  setMedicineRows(prev => {
                                    const updated = [...prev];
                                    updated[idx] = { ...updated[idx], isOpen: true };
                                    return updated;
                                  });
                                }
                              }}
                              onChange={e => handleMedicineSearch(idx, e.target.value)}
                              placeholder="Click or type to select from inventory stock…"
                              className="w-full pl-9 pr-8 py-2.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                            />
                            <ChevronDown
                              size={14}
                              className="absolute right-3 top-3 text-muted pointer-events-none"
                            />
                          </div>

                          {/* Dropdown Suggestions List */}
                          {row.isOpen && (
                            <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-bg2 border border-border rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
                              {row.loadingSuggestions && (
                                <div className="p-3 text-center text-xs text-muted flex items-center justify-center gap-2">
                                  <RefreshCw size={12} className="animate-spin" /> Fetching inventory…
                                </div>
                              )}
                              {!row.loadingSuggestions && row.suggestions.length === 0 && (
                                <div className="p-3 text-center text-xs text-muted">
                                  No matching inventory item found
                                </div>
                              )}
                              {!row.loadingSuggestions && row.suggestions.map(s => {
                                const inStock = (s.in_stock_qty || 0) > 0;
                                return (
                                  <div
                                    key={s.id}
                                    onClick={() => selectMedicine(idx, s)}
                                    className="px-3.5 py-2.5 hover:bg-bg3 cursor-pointer border-b border-border/40 last:border-none flex items-center justify-between gap-3 transition-colors"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-text truncate">{s.name}</p>
                                      {s.manufacturer && (
                                        <p className="text-[10px] text-muted truncate">{s.manufacturer}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      {s.mrp ? (
                                        <span className="text-[11px] font-medium text-text">₹{s.mrp}</span>
                                      ) : null}
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                          inStock
                                            ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                                        }`}
                                      >
                                        {inStock ? `${s.in_stock_qty} in stock` : 'Out of Stock'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Quantity Counter */}
                        <div className="flex items-center border border-border rounded-xl bg-bg2 overflow-hidden flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => updateQty(idx, row.quantity_needed - 1)}
                            className="px-2.5 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors text-xs font-bold"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={row.quantity_needed}
                            onChange={e => updateQty(idx, Number(e.target.value))}
                            className="w-12 text-center bg-transparent text-xs font-bold text-text focus:outline-none"
                            title="Required refill quantity"
                          />
                          <button
                            type="button"
                            onClick={() => updateQty(idx, row.quantity_needed + 1)}
                            className="px-2.5 py-2 text-muted hover:text-text hover:bg-bg3 transition-colors text-xs font-bold"
                          >
                            +
                          </button>
                        </div>

                        {/* Remove Row Button */}
                        {medicineRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMedicineRows(prev => prev.filter((_, i) => i !== idx))}
                            className="p-2.5 text-muted hover:text-red-400 transition-colors rounded-xl hover:bg-bg3"
                            title="Remove medication"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>

                      {/* Stock Status Badge for Selected Medicine */}
                      {row.medicineId && (
                        <div className="flex items-center justify-between text-[11px] pt-1 px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-text">{row.medicineName}</span>
                            {row.mrp && <span className="text-muted">· ₹{row.mrp}</span>}
                          </div>
                          <div
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              (row.inStockQty || 0) >= row.quantity_needed
                                ? 'bg-green-500/15 text-green-400'
                                : (row.inStockQty || 0) > 0
                                ? 'bg-yellow-500/15 text-yellow-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}
                          >
                            {(row.inStockQty || 0) >= row.quantity_needed ? (
                              <><Check size={10} /> In Stock ({row.inStockQty} available)</>
                            ) : (row.inStockQty || 0) > 0 ? (
                              <><AlertCircle size={10} /> Low Stock ({row.inStockQty} available)</>
                            ) : (
                              <><AlertCircle size={10} /> Out of Stock (Auto-holds for stock)</>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingPatient(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:bg-bg3 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <><RefreshCw size={13} className="animate-spin" /> {editingPatient ? 'Updating…' : 'Registering…'}</>
                  ) : (
                    <><Check size={13} /> {editingPatient ? 'Update Refill Schedule' : 'Register Refill Schedule'}</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Inline Edit Refill Frequency Modal ────────────────────────────────────── */}
      {editingRefill && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Sliders size={16} className="text-primary" />
                Modify Refill Frequency
              </h3>
              <button
                type="button"
                onClick={() => setEditingRefill(null)}
                className="text-muted hover:text-text p-1 rounded-lg hover:bg-bg3"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              Adjust refill interval cycle for <strong className="text-text">{editingRefill.name}</strong>:
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 90].map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setEditIntervalVal(days)}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    editIntervalVal === days
                      ? 'bg-primary border-primary text-white shadow-md'
                      : 'bg-bg border-border text-muted hover:text-text'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>

            <div className="space-y-1 pt-2">
              <div className="flex justify-between text-xs font-bold text-text">
                <span>Refill Interval:</span>
                <span className="text-primary font-mono">{editIntervalVal} Days</span>
              </div>
              <input
                type="range"
                min={1}
                max={180}
                value={editIntervalVal}
                onChange={e => setEditIntervalVal(Number(e.target.value))}
                className="w-full h-2 bg-bg border border-border rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted font-mono">
                <span>1 Day</span>
                <span>90 Days</span>
                <span>180 Days</span>
              </div>
            </div>

            <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary font-semibold flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>Calculated Next Due Date: <strong>{new Date(Date.now() + editIntervalVal * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
              </div>
              <div className="text-[11px] text-amber-400 pl-6">
                <span>🔔 Auto 5-Day Lead Window Starts: <strong>{new Date(Date.now() + (editIntervalVal - 5) * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</strong></span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setEditingRefill(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateFrequency}
                disabled={updatingFreq}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all disabled:opacity-50"
              >
                {updatingFreq ? 'Saving...' : 'Save Refill Frequency'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};



// ═══════════════════════════════════════════════════════════════════════════════
// DISTRIBUTOR MESSAGES SECTION
// ═══════════════════════════════════════════════════════════════════════════════

const DistributorMessagesSection: React.FC = () => {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [retrying, setRetrying] = useState<number | null>(null);

  const searchDebounceRef = useRef<any>(null);

  const handleSearchChange = (term: string) => {
    setSearch(term);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(term);
    }, 300);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await withSilentRetry(() => apiClient.get('/automation/notifications', {
        params: {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: debouncedSearch || undefined,
          limit: 200
        }
      }));
      setLogs(Array.isArray(r.data) ? r.data : []);
    } catch { toastEvent.trigger('Failed to load messages', 'error', '/crm'); }
    finally { setLoading(false); }
  }, [typeFilter, statusFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (id: number) => {
    setRetrying(id);
    try {
      await apiClient.post(`/automation/notifications/${id}/retry`);
      toastEvent.trigger('Message queued for retry', 'success', '/crm');
      await load();
    } catch { toastEvent.trigger('Retry failed', 'error', '/crm'); }
    finally { setRetrying(null); }
  };

  const statusColor = (s: string) => {
    if (s === 'sent') return 'bg-green-500/15 text-green-400';
    if (s === 'failed') return 'bg-red-500/15 text-red-400';
    if (s === 'pending') return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-muted/10 text-muted';
  };

  const typeIcon = (t: string) => {
    if (t?.includes('whatsapp')) return <MessageCircle size={13} className="text-green-400" />;
    if (t?.includes('email')) return <Mail size={13} className="text-blue-400" />;
    return <Bell size={13} className="text-muted" />;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search recipient or message…"
            className="w-full pl-8 pr-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="refill">Refill</option>
        </select>
        <button onClick={load} className="p-2 bg-bg2 border border-border rounded-lg hover:bg-bg3 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
        <span className="text-xs text-muted ml-auto">{logs.length} messages</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted gap-2">
            <MessageSquare size={32} className="opacity-30" />
            <p className="text-sm">No messages found</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 bg-bg2 border border-border rounded-xl px-4 py-3 hover:border-primary/20 transition-colors">
                <div className="mt-0.5">{typeIcon(log.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text truncate">{log.recipient || '—'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor(log.status)}`}>
                      {log.status}
                    </span>
                    <span className="text-[10px] text-muted">{log.type}</span>
                  </div>
                  <p className="text-xs text-muted truncate">{log.message}</p>
                  {log.error && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">↳ {log.error}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-muted whitespace-nowrap">
                    {log.created_at ? formatTs(log.created_at) : '—'}
                  </span>
                  {log.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(log.id)}
                      disabled={retrying === log.id}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 bg-primary/10 border border-primary/30 text-primary rounded-md hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={9} className={retrying === log.id ? 'animate-spin' : ''} />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP SECTION — embedded web.whatsapp.com iframe
// ═══════════════════════════════════════════════════════════════════════════════

function parseAllPhoneNumbers(...inputs: (string | undefined | null)[]): string[] {
  const nums: string[] = [];
  inputs.forEach(input => {
    if (!input) return;
    const parts = String(input).split(/[,/;\n]+/);
    parts.forEach(p => {
      const clean = p.replace(/\D/g, '');
      if (clean.length >= 10) {
        const formatted = clean.length === 10 ? `+91 ${clean}` : `+${clean}`;
        if (!nums.includes(formatted)) {
          nums.push(formatted);
        }
      }
    });
  });
  return nums;
}

function formatPhoneNumber(numStr?: string): string {
  if (!numStr) return '';
  const digits = numStr.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length > 13) {
    return '';
  }
  return numStr.includes('+') ? numStr : `+${numStr}`;
}

function resolveChatDisplay(chat: WaChatItem): { title: string; subtitle: string } {
  const rawId = chat.id || '';
  const isLid = rawId.endsWith('@lid');
  const cleanPhone = formatPhoneNumber(chat.resolvedNumber || (isLid ? '' : rawId.split('@')[0]));

  const rawName = (chat.name || '').trim();
  const isNameDigitsOnly = /^\d+$/.test(rawName.replace(/\D/g, '')) && rawName.replace(/\D/g, '').length >= 8;
  const isNameLid = rawName.includes('@lid');

  if (rawName && !isNameDigitsOnly && !isNameLid) {
    return {
      title: rawName,
      subtitle: cleanPhone || (isLid ? '' : chat.resolvedNumber || rawId.split('@')[0])
    };
  }

  if (cleanPhone) {
    return {
      title: cleanPhone,
      subtitle: 'WhatsApp Contact'
    };
  }

  return {
    title: rawName || chat.resolvedNumber || rawId.split('@')[0],
    subtitle: ''
  };
}

interface WaChatItem {
  id: string;
  name: string;
  unreadCount: number;
  timestamp?: number;
  isGroup?: boolean;
  lastMessage?: string | null;
  resolvedNumber?: string;
}

interface WaMessageItem {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type?: string;
  hasMedia?: boolean;
  scannedResult?: string | null;
}

interface WaMessageTemplate {
  id: number;
  name: string;
  category: string;
  body: string;
}

const WhatsAppSection: React.FC = () => {
  const [chats, setChats] = useState<WaChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [search, setSearch] = useState('');
  const [activeChat, setActiveChat] = useState<WaChatItem | null>(null);

  const [messages, setMessages] = useState<WaMessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ filename: string; mimetype: string; data: string } | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string>('');
  const [templates, setTemplates] = useState<WaMessageTemplate[]>([]);
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [scanningOcrId, setScanningOcrId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  // OCR results keyed by message ID (populated from DB via scannedResult or SSE)
  const [ocrResults, setOcrResults] = useState<Record<string, string>>({});

  const handleStartNewChat = (rawNumber: string) => {
    let digits = rawNumber.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length === 10) digits = `91${digits}`;
    const chatId = `${digits}@c.us`;
    const newChatObj: WaChatItem = {
      id: chatId,
      name: formatPhoneNumber(digits),
      unreadCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
      resolvedNumber: digits,
      lastMessage: ''
    };

    setChats(prev => {
      if (prev.some(c => c.id === chatId || c.resolvedNumber === digits)) return prev;
      return [newChatObj, ...prev];
    });
    setActiveChat(newChatObj);
    setShowNewChatModal(false);
    setNewChatNumber('');
    setSearch('');
  };

  // Resizable panel width state (persisted in localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('crm_sidebar_width');
    return saved ? parseInt(saved, 10) : 340;
  });
  const [isDragging, setIsDragging] = useState(false);

  // Mouse move handler for resizing sidebar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = Math.min(Math.max(e.clientX - 260, 240), 550);
      setSidebarWidth(newWidth);
      localStorage.setItem('crm_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Template form state
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [tmplName, setTmplName] = useState('');
  const [tmplCategory, setTmplCategory] = useState('General');
  const [tmplBody, setTmplBody] = useState('');
  const [savingTmpl, setSavingTmpl] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so SSE handler always sees the latest activeChat without stale closure
  const activeChatRef = useRef<WaChatItem | null>(null);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  // Load WhatsApp status + QR code
  const checkStatus = useCallback(async () => {
    try {
      const res = await apiClient.get<{ isReady: boolean; qrUrl?: string; message?: string; initializing?: boolean }>('/messaging/qr');
      setIsReady(res.data.isReady);
      setQrUrl(res.data.qrUrl || null);
      setQrMessage(res.data.message || '');
      setInitializing(!!res.data.initializing);
    } catch {
      setIsReady(false);
      setQrUrl(null);
      setInitializing(false);
    }
  }, []);

  // Fetch Chat List
  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await withSilentRetry(() => apiClient.get<WaChatItem[]>('/messaging/chats'));
      setChats(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastEvent.trigger('Failed to load WhatsApp chats', 'error', '/crm');
    } finally {
      setLoadingChats(false);
    }
  }, []);

  // Fetch Message Templates
  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiClient.get<WaMessageTemplate[]>('/messaging/templates');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load message templates:', err);
    }
  }, []);

  const statusPollActive = usePageActive();

  useEffect(() => {
    checkStatus();
    loadTemplates();
  }, [checkStatus, loadTemplates]);

  // Gate chat list behind WhatsApp ready — avoids cold-boot false-failure toasts
  useEffect(() => {
    if (isReady) loadChats();
  }, [isReady, loadChats]);

  useEffect(() => {
    if (!statusPollActive) return;
    checkStatus();
    if (isReady) loadChats();
  }, [checkStatus, loadChats, isReady, statusPollActive]);

  const messagePollActive = usePageActive();

  // Load Thread Messages when activeChat changes (Every BOOT/mount)
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setOcrResults({});
      return;
    }

    const loadMessages = (isInitial = false) => {
      if (isInitial) setLoadingMessages(true);
      apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChat.id)}/messages?limit=500`)
        .then(res => {
          const msgs = Array.isArray(res.data) ? res.data : [];
          setMessages(prev => {
            const optimisticMsgs = prev.filter(m => m.id.startsWith('optimistic_'));
            if (optimisticMsgs.length === 0) return msgs;

            const fetchedBodies = new Set(msgs.map(m => m.body));
            const pendingOptimistic = optimisticMsgs.filter(m => !fetchedBodies.has(m.body));
            return [...msgs, ...pendingOptimistic];
          });
          // Populate ocrResults map from pre-existing DB scans
          const preloaded: Record<string, string> = {};
          for (const msg of msgs) {
            if (msg.scannedResult) {
              try {
                const parsed = JSON.parse(msg.scannedResult);
                const label = parsed?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                  || parsed?.text?.substring(0, 120);
                if (label) preloaded[msg.id] = label;
              } catch { /* ignore malformed JSON */ }
            }
          }
          setOcrResults(preloaded);
          if (isInitial) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        })
        .catch(() => { if (isInitial) toastEvent.trigger('Failed to load message history', 'error', '/crm'); })
        .finally(() => { if (isInitial) setLoadingMessages(false); });
    };

    loadMessages(true);
  }, [activeChat, messagePollActive]);

function isSameChat(chat: WaChatItem, targetChatId: string, resolvedNum?: string): boolean {
  if (!chat) return false;
  if (chat.id === targetChatId) return true;
  if (chat.resolvedNumber && targetChatId.includes(chat.resolvedNumber)) return true;
  if (resolvedNum && (chat.id.includes(resolvedNum) || chat.resolvedNumber === resolvedNum)) return true;

  const chatDigits = (chat.resolvedNumber || chat.id).replace(/\D/g, '').slice(-10);
  const targetDigits = ((resolvedNum || targetChatId) || '').replace(/\D/g, '').slice(-10);

  if (chatDigits && targetDigits && chatDigits.length >= 7 && chatDigits === targetDigits) {
    return true;
  }
  return false;
}

  // SSE event listener for real-time messages
  useEffect(() => {
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wa_new_message') {
          const newMsg: WaMessageItem = data.payload.message;
          const chatId: string = data.payload.chat_id;
          const resolvedNumber: string = data.payload.resolved_number;

          // Use ref to avoid stale closure on activeChat
          const currentChat = activeChatRef.current;
          if (currentChat && isSameChat(currentChat, chatId, resolvedNumber)) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          }
          // Refresh chats list preview
          loadChats();
        } else if (data.type === 'ocr_scan_complete') {
          // OCR result arrived from background scan — update pill badge in chat
          const { msgId, ocrResult } = data.payload || {};
          if (msgId && ocrResult) {
            try {
              const label = ocrResult?.items?.map((i: any) => i.name || i.medicine_name || i.text).filter(Boolean).join(', ')
                || ocrResult?.text?.substring(0, 120);
              if (label) setOcrResults(prev => ({ ...prev, [msgId]: label }));
            } catch { /* ignore */ }
          }
        } else if (data.type === 'auth_failure') {
          setIsReady(false);
        }
      } catch (err) {
        console.error('SSE message parse error:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [activeChat, loadChats]);

  // Handle ESC key to close modals
  useEffect(() => {
    if (!showManageModal && !showNewChatModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowManageModal(false);
        setShowNewChatModal(false);
        setNewChatNumber('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showManageModal, showNewChatModal]);

  // Handle Send Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChat) return;
    if (!composerText.trim() && !attachedFile) return;

    const recipient = activeChat.resolvedNumber || activeChat.id.split('@')[0];
    const textToSend = composerText.trim();
    setSending(true);

    // Optimistic update: show the message immediately in the thread
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticMsg: WaMessageItem = {
      id: optimisticId,
      body: attachedFile ? `[Document] ${attachedFile.filename}` : textToSend,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      type: attachedFile ? 'document' : 'text',
      hasMedia: !!attachedFile,
      scannedResult: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);

    // Clear composer immediately for better UX
    setComposerText('');
    setAttachedFile(null);

    try {
      await apiClient.post('/messaging/send', {
        number: recipient,
        message: textToSend,
        file: attachedFile || undefined
      });
      toastEvent.trigger('Message sent via WhatsApp', 'success', '/crm');
      // Refresh chat list immediately so the new or updated chat shows up with preview
      loadChats();
      // Reconcile optimistic message with DB record after short delay
      setTimeout(() => {
        if (activeChatRef.current) {
          apiClient.get<WaMessageItem[]>(`/messaging/chats/${encodeURIComponent(activeChatRef.current.id)}/messages?limit=500`)
            .then(res => {
              if (Array.isArray(res.data) && res.data.length > 0) {
                setMessages(res.data);
                setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
              }
            })
            .catch(() => {});
        }
      }, 400);
    } catch (err: any) {
      // Remove optimistic message on failure so user knows the send failed
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      toastEvent.trigger(err.response?.data?.error || 'Failed to send message', 'error', '/crm');
    } finally {
      setSending(false);
    }
  };

  // Handle File Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setAttachedFile({
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
  };

  // Handle Save Template (Create / Edit)
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmplName.trim() || !tmplBody.trim()) {
      toastEvent.trigger('Name and content are required', 'error');
      return;
    }
    setSavingTmpl(true);
    try {
      if (editingTemplateId) {
        await apiClient.put(`/messaging/templates/${editingTemplateId}`, {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template updated', 'success');
      } else {
        await apiClient.post('/messaging/templates', {
          name: tmplName,
          category: tmplCategory,
          body: tmplBody
        });
        toastEvent.trigger('Template created', 'success');
      }
      setTmplName('');
      setTmplCategory('General');
      setTmplBody('');
      setEditingTemplateId(null);
      await loadTemplates();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to save template', 'error');
    } finally {
      setSavingTmpl(false);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id: number) => {
    try {
      await apiClient.delete(`/messaging/templates/${id}`);
      toastEvent.trigger('Template deleted', 'success');
      await loadTemplates();
    } catch {
      toastEvent.trigger('Failed to delete template', 'error');
    }
  };

  // Edit Template
  const handleStartEditTemplate = (t: WaMessageTemplate) => {
    setEditingTemplateId(t.id);
    setTmplName(t.name);
    setTmplCategory(t.category || 'General');
    setTmplBody(t.body);
  };

  const [viewMode, setViewMode] = useState<'live_web' | 'crm_chats'>('live_web');

  // Filtered Chats
  const filteredChats = chats.filter(c => {
    const query = search.toLowerCase().trim();
    if (!query) return true;
    return (
      (c.name && c.name.toLowerCase().includes(query)) ||
      (c.resolvedNumber && c.resolvedNumber.includes(query)) ||
      (c.id && c.id.includes(query))
    );
  });

  return (
    <div className="w-full h-full flex flex-col gap-3">
      {/* Top Controls: Engine Status & Action Controls */}
      <div className="flex items-center justify-between gap-3 bg-bg2 p-2.5 rounded-2xl border border-border shadow-sm shrink-0">
        <div className="flex items-center gap-2 select-none">
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live WhatsApp CRM Engine</span>
          </div>
          <span className="text-[11px] text-muted hidden sm:inline">
            Drag panel handle to customize width (auto-saved)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 text-xs font-bold transition-all active:scale-95"
            title="Start new chat with any phone number"
          >
            <MessageSquare size={13} />
            <span>New Chat</span>
          </button>

          <button
            onClick={() => setShowManageModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 border border-border text-text hover:text-primary text-xs font-bold transition-all active:scale-95"
            title="Manage Message Templates"
          >
            <Zap size={13} className="text-primary" />
            <span>Manage Templates</span>
          </button>

          <button
            onClick={async () => {
              try {
                toastEvent.trigger('Launching live WhatsApp Web Chrome window...', 'info');
                await apiClient.post('/messaging/login-window');
              } catch (err: any) {
                toastEvent.trigger(err?.response?.data?.error || 'Failed to launch WhatsApp window', 'error');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-sm active:scale-95"
            title="Open native live Google Chrome window logged into WhatsApp Web"
          >
            <ExternalLink size={13} />
            <span>Open Live Chrome Window</span>
          </button>

          <button
            onClick={async () => {
              if (window.confirm('Are you sure you want to log out of WhatsApp? This will clear all saved login data so you can log in with a new account.')) {
                try {
                  toastEvent.trigger('Logging out of WhatsApp & clearing session data...', 'info');
                  await apiClient.post('/messaging/logout');
                  toastEvent.trigger('WhatsApp logged out successfully. You can now scan a new QR code.', 'success');
                  checkStatus();
                } catch (err: any) {
                  toastEvent.trigger(err?.response?.data?.error || 'Failed to log out of WhatsApp', 'error');
                }
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-bold transition-all active:scale-95"
            title="Log out and clear all stored WhatsApp login data"
          >
            <LogOut size={13} />
            <span>Logout WhatsApp</span>
          </button>
        </div>
      </div>

      {/* ── WhatsApp Not-Connected: full QR setup screen ── */}
      {!isReady ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 bg-bg2 border border-border rounded-2xl">
          <div className="text-center space-y-1">
            <h2 className="text-sm font-bold text-text flex items-center justify-center gap-2">
              <MessageCircle size={18} className="text-emerald-400" />
              {initializing ? 'Connecting WhatsApp Session...' : 'Connect WhatsApp'}
            </h2>
            <p className="text-xs text-muted max-w-xs">
              {qrMessage || (initializing
                ? 'Restoring saved WhatsApp session... Your chats will load automatically in a moment.'
                : 'Scan the QR code below or click Connect WhatsApp to link your device.')}
            </p>
          </div>

          {/* QR Code or Connecting Spinner */}
          {qrUrl ? (
            <div className="p-4 bg-white rounded-2xl shadow-lg border border-border">
              <img src={qrUrl} alt="WhatsApp QR Code" className="w-56 h-56" />
            </div>
          ) : initializing ? (
            <div className="w-64 h-64 bg-bg3 border border-border rounded-2xl flex flex-col items-center justify-center gap-3 text-muted">
              <RefreshCw size={28} className="animate-spin text-emerald-400" />
              <p className="text-xs font-semibold text-text">Auto-connecting saved session...</p>
              <p className="text-[10px] text-muted text-center px-4">Launching background WhatsApp engine with existing session data</p>
            </div>
          ) : (
            <div className="w-64 h-64 bg-bg3 border border-border rounded-2xl flex flex-col items-center justify-center gap-3 text-muted">
              <MessageCircle size={36} className="text-emerald-400/60" />
              <p className="text-xs font-medium text-muted">WhatsApp not connected</p>
              <button
                onClick={async () => {
                  try {
                    setInitializing(true);
                    toastEvent.trigger('Initializing WhatsApp connection...', 'info');
                    await apiClient.post('/messaging/connect');
                    checkStatus();
                  } catch (err: any) {
                    setInitializing(false);
                    toastEvent.trigger(err?.response?.data?.error || 'Failed to connect WhatsApp', 'error');
                  }
                }}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 mt-1"
              >
                <MessageCircle size={14} /> Connect WhatsApp
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={async () => {
                try {
                  setInitializing(true);
                  await apiClient.post('/messaging/connect');
                  checkStatus();
                } catch (err: any) {
                  setInitializing(false);
                  toastEvent.trigger(err?.response?.data?.error || 'Failed to connect', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-bg3 border border-border rounded-xl text-xs font-bold text-text hover:bg-bg transition-all active:scale-95"
            >
              <RefreshCw size={13} /> {qrUrl ? 'Refresh QR' : 'Connect / Generate QR'}
            </button>
            <button
              onClick={async () => {
                try {
                  toastEvent.trigger('Launching WhatsApp login window…', 'info');
                  await apiClient.post('/messaging/login-window');
                } catch (err: any) {
                  toastEvent.trigger(err?.response?.data?.error || 'Failed to launch login window', 'error');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
            >
              <ExternalLink size={13} /> Open Live Chrome Window
            </button>
            <button
              onClick={async () => {
                if (window.confirm('Are you sure you want to log out & clear WhatsApp session data?')) {
                  try {
                    toastEvent.trigger('Clearing stored WhatsApp session data...', 'info');
                    await apiClient.post('/messaging/logout');
                    toastEvent.trigger('WhatsApp session cleared successfully.', 'success');
                    checkStatus();
                  } catch (err: any) {
                    toastEvent.trigger(err?.response?.data?.error || 'Failed to clear WhatsApp session', 'error');
                  }
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 rounded-xl text-xs font-bold transition-all active:scale-95"
            >
              <LogOut size={13} /> Logout / Clear Session Data
            </button>
          </div>

          <p className="text-[10px] text-muted text-center max-w-xs">
            Open WhatsApp on your phone → Linked Devices → Link a Device → scan the QR above.
          </p>
        </div>
      ) : (
      /* ── Main Interface: Resizable Native Chat Panel ── */
      <div className="flex-1 min-h-0 flex bg-bg2 border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Left: Chat List Panel (Resizable Width) */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-border flex flex-col bg-bg3/40 min-h-0 shrink-0 select-none"
        >
          <div className="p-3 border-b border-border flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search chats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={loadChats}
              disabled={loadingChats}
              className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95 disabled:opacity-50"
              title="Refresh chat list"
            >
              <RefreshCw size={14} className={loadingChats ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loadingChats && chats.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading chats...</div>
            ) : filteredChats.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted flex flex-col items-center gap-3">
                <span>No WhatsApp chats found.</span>
                {search.replace(/\D/g, '').length >= 7 && (
                  <button
                    onClick={() => handleStartNewChat(search)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    <MessageSquare size={13} />
                    <span>Start Chat with {search.trim()}</span>
                  </button>
                )}
              </div>
            ) : (
              filteredChats.map(c => {
                const isActive = activeChat?.id === c.id;
                const display = resolveChatDisplay(c);
                const initial = display.title.charAt(0).toUpperCase();

                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveChat(c)}
                    className={`p-3 flex items-start gap-3 cursor-pointer transition-all hover:bg-bg/60 ${
                      isActive ? 'bg-primary/10 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-text truncate">{display.title}</h4>
                        {c.timestamp && (
                          <span className="text-[10px] text-muted">{formatTs(c.timestamp)}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted truncate mt-0.5">
                        {display.subtitle ? `${display.subtitle} • ` : ''}{c.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-primary text-white font-bold text-[10px]">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
          className="w-1.5 hover:w-2 bg-border/40 hover:bg-primary/60 cursor-col-resize transition-all shrink-0 select-none flex items-center justify-center group"
          title="Drag to resize WhatsApp panel (auto-saved)"
        >
          <div className="w-0.5 h-6 bg-muted/40 group-hover:bg-white rounded-full transition-colors" />
        </div>

        {/* Right: Active Chat Thread & Composer */}
        <div className="flex-1 flex flex-col min-h-0 bg-bg min-w-0">
          {activeChat ? (
            <>
              {/* Thread Header */}
              {(() => {
                const activeDisplay = resolveChatDisplay(activeChat);
                return (
                  <div className="p-3 border-b border-border bg-bg2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">
                        {activeDisplay.title.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-text">
                          {activeDisplay.title}
                        </h3>
                        {activeDisplay.subtitle && (
                          <p className="text-[10px] text-muted">
                            {activeDisplay.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Thread Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg/50">
                {loadingMessages ? (
                  <div className="p-8 text-center text-xs text-muted">Loading message history...</div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No messages in this chat.</div>
                ) : (
                  messages.map(m => {
                    const isOut = m.fromMe;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`group relative max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm select-text ${
                            isOut
                              ? 'bg-primary text-white rounded-br-none'
                              : 'bg-bg2 border border-border text-text rounded-bl-none'
                          }`}
                        >
                          {/* Copy Button */}
                          {m.body && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(m.body);
                                setCopiedMsgId(m.id);
                                toastEvent.trigger('Message copied to clipboard', 'success');
                                setTimeout(() => setCopiedMsgId(null), 2000);
                              }}
                              className={`absolute top-1.5 right-1.5 p-1 rounded-md transition-all ${
                                isOut
                                  ? 'bg-white/20 text-white hover:bg-white/30'
                                  : 'bg-bg3/80 text-muted hover:text-text hover:bg-bg3'
                              }`}
                              title="Copy message text"
                            >
                              {copiedMsgId === m.id ? (
                                <Check size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          )}

                          <div className="whitespace-pre-wrap break-words pr-5 select-text">{m.body}</div>
                          {/* OCR medicine result pill — shown when scan result exists */}
                          {ocrResults[m.id] && (
                            <div className="mt-2 pt-1.5 border-t border-border/40 select-text flex items-center justify-between gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-400 text-[10px] font-semibold select-text">
                                💊 {ocrResults[m.id]}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(ocrResults[m.id]);
                                  toastEvent.trigger('OCR medicine text copied', 'success');
                                }}
                                className="p-1 text-[10px] text-teal-400 hover:underline flex items-center gap-0.5"
                                title="Copy OCR text"
                              >
                                <Copy size={9} /> Copy
                              </button>
                            </div>
                          )}
                          {m.hasMedia && (
                            <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-[10px]">
                              <span className="text-muted flex items-center gap-1">📁 Media Attachment</span>
                              <button
                                onClick={async () => {
                                  setScanningOcrId(m.id);
                                  try {
                                    toastEvent.trigger('Queuing OCR prescription scan...', 'info');
                                    await apiClient.post(
                                      `/messaging/chats/${encodeURIComponent(activeChat!.id)}/messages/${encodeURIComponent(m.id)}/scan`
                                    );
                                    toastEvent.trigger('OCR scan queued – result will appear shortly', 'success', '/crm');
                                  } catch {
                                    toastEvent.trigger('Failed to queue prescription scan', 'error');
                                  } finally {
                                    setScanningOcrId(null);
                                  }
                                }}
                                disabled={scanningOcrId === m.id}
                                className="px-2 py-0.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-bold transition-all flex items-center gap-1"
                              >
                                <span>{scanningOcrId === m.id ? 'Scanning OCR...' : '🔍 OCR Scan Prescription'}</span>
                              </button>
                            </div>
                          )}
                          <div
                            className={`text-[9px] mt-1 text-right ${
                              isOut ? 'text-white/70' : 'text-muted'
                            }`}
                          >
                            {formatTs(m.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Attached File Bar */}
              {attachedFile && (
                <div className="px-4 py-2 bg-primary/10 border-t border-primary/20 flex items-center justify-between text-xs text-primary">
                  <div className="flex items-center gap-2 truncate">
                    <Package size={14} />
                    <span className="font-bold truncate">{attachedFile.filename}</span>
                  </div>
                  <button
                    onClick={() => setAttachedFile(null)}
                    className="p-1 hover:text-text transition-all"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Composer & Quick Templates Popover */}
              <div className="p-3 border-t border-border bg-bg2 relative">
                {/* Templates Popover */}
                {showTemplatePopover && (
                  <div className="absolute bottom-16 left-3 w-80 max-h-64 bg-bg2 border border-border rounded-2xl shadow-xl z-20 flex flex-col overflow-hidden">
                    <div className="p-2.5 border-b border-border bg-bg3 flex items-center justify-between text-xs font-bold text-text">
                      <span>Quick Message Templates</span>
                      <button
                        onClick={() => {
                          setShowTemplatePopover(false);
                          setShowManageModal(true);
                        }}
                        className="text-[10px] text-primary hover:underline"
                      >
                        Manage
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 divide-y divide-border/40">
                      {templates.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted">No templates found.</div>
                      ) : (
                        templates.map(t => (
                          <div
                            key={t.id}
                            onClick={() => {
                              setComposerText(prev => (prev ? `${prev}\n${t.body}` : t.body));
                              setShowTemplatePopover(false);
                            }}
                            className="p-2 hover:bg-bg3 rounded-xl cursor-pointer transition-all"
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-text">
                              <span>{t.name}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                                {t.category || 'General'}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted truncate mt-0.5">{t.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplatePopover(prev => !prev)}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-primary transition-all active:scale-95 text-xs font-bold flex items-center gap-1"
                    title="Quick Templates"
                  >
                    <Zap size={14} />
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl bg-bg border border-border text-muted hover:text-text transition-all active:scale-95"
                    title="Attach file"
                  >
                    <Package size={14} />
                  </button>

                  <input
                    type="text"
                    placeholder="Type WhatsApp message..."
                    value={composerText}
                    onChange={e => setComposerText(e.target.value)}
                    className="flex-1 px-4 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
                  />

                  <button
                    type="submit"
                    disabled={sending || (!composerText.trim() && !attachedFile)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                  >
                    <Send size={13} />
                    <span>{sending ? 'Sending...' : 'Send'}</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                <MessageCircle size={24} />
              </div>
              <p className="text-xs">Select a WhatsApp chat from the list to view history &amp; send messages.</p>
            </div>
          )}
        </div>
      </div>
      )} {/* end isReady ternary */}

      {/* Template Manager Modal */}
      {showManageModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span>Manage Quick Message Templates</span>
              </h3>
              <button
                onClick={() => setShowManageModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {/* Form */}
              <form onSubmit={handleSaveTemplate} className="p-3 bg-bg3/50 border border-border rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Template Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Refill Notice"
                      value={tmplName}
                      onChange={e => setTmplName(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Patients / General"
                      value={tmplCategory}
                      onChange={e => setTmplCategory(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-muted uppercase">Message Body</label>
                  <textarea
                    rows={3}
                    placeholder="Type template message text..."
                    value={tmplBody}
                    onChange={e => setTmplBody(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  {editingTemplateId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplateId(null);
                        setTmplName('');
                        setTmplCategory('General');
                        setTmplBody('');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted hover:bg-bg3"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingTmpl}
                    className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {savingTmpl ? 'Saving...' : editingTemplateId ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </form>

              {/* Template List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider">Existing Templates</h4>
                <div className="space-y-2">
                  {templates.map(t => (
                    <div
                      key={t.id}
                      className="p-3 bg-bg border border-border rounded-xl flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text">{t.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                            {t.category || 'General'}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 whitespace-pre-wrap">{t.body}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleStartEditTemplate(t)}
                          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-bg3"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="p-1.5 rounded-lg text-muted hover:text-rose-400 hover:bg-bg3"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <MessageSquare size={16} className="text-emerald-400" />
                <span>Start New WhatsApp Chat</span>
              </h3>
              <button
                onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newChatNumber.trim()) handleStartNewChat(newChatNumber);
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Mobile / WhatsApp Number</label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or 919876543210"
                  value={newChatNumber}
                  onChange={e => setNewChatNumber(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowNewChatModal(false); setNewChatNumber(''); }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-muted hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChatNumber.trim()}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50"
                >
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SPECIAL REQUESTS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

interface SpecialOrderItem {
  id: number;
  customer_id?: number | null;
  product: string;
  requester: string;
  phone: string;
  qty: number;
  priority: string;
  status: string;
  date: string;
  notified: number;
  pharmarack_distributor?: string | null;
  pharmarack_rate?: number | null;
  pharmarack_mrp?: number | null;
  pharmarack_scheme?: string | null;
  pharmarack_mapped?: number | null;
  advance_payment?: number | null;
  language?: string;
}

const SpecialOrdersSection: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SpecialOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Date Filters
  const [dateFrom, setDateFrom] = useState(getNDaysAgoString(15));
  const [dateTo, setDateTo] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);

  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addingCartId, setAddingCartId] = useState<number | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Request Form State
  const [product, setProduct] = useState('');
  const [requester, setRequester] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState<number | ''>(1);
  const [advancePayment, setAdvancePayment] = useState<number | ''>('');
  const [priority, setPriority] = useState('Normal');
  const [language, setLanguage] = useState('en');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit Request Form State
  const [editingOrder, setEditingOrder] = useState<SpecialOrderItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState('');
  const [editRequester, setEditRequester] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [shakePhone, setShakePhone] = useState(false);
  const [shakeEditPhone, setShakeEditPhone] = useState(false);
  const [editQty, setEditQty] = useState<number | ''>(1);
  const [editAdvancePayment, setEditAdvancePayment] = useState<number | ''>('');
  const [editPriority, setEditPriority] = useState('Normal');
  const [editStatus, setEditStatus] = useState('Pending');
  const [editDistributor, setEditDistributor] = useState('');
  const [editRate, setEditRate] = useState<number | ''>('');
  const [editMrp, setEditMrp] = useState<number | ''>('');
  const [editScheme, setEditScheme] = useState('');
  const [editLanguage, setEditLanguage] = useState('en');
  const [editFormSubmitting, setEditFormSubmitting] = useState(false);

  // Pharmarack Search States
  const [prSearchResults, setPrSearchResults] = useState<any[]>([]);
  const [showPrDropdown, setShowPrDropdown] = useState(false);
  const [loadingPr, setLoadingPr] = useState(false);

  const productContainerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(productContainerRef, () => {
    setShowPrDropdown(false);
  });

  // Selected Pharmarack Metadata Form State
  const [selectedDistributor, setSelectedDistributor] = useState('');
  const [selectedRate, setSelectedRate] = useState<number | ''>('');
  const [selectedMrp, setSelectedMrp] = useState<number | ''>('');
  const [selectedMapped, setSelectedMapped] = useState(true);
  const [selectedScheme, setSelectedScheme] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | number>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | number>('');
  const [selectedProductCode, setSelectedProductCode] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedPackaging, setSelectedPackaging] = useState('');

  const isSelectingPrRef = useRef(false);

  useEffect(() => {
    if (!manualToDate) {
      setDateTo(getTodayString());
    }
  }, [manualToDate]);

  // Debounced search for Pharmarack products
  useEffect(() => {
    if (isSelectingPrRef.current) return;
    if (!product.trim()) {
      setPrSearchResults([]);
      setShowPrDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      if (isSelectingPrRef.current) return;
      setLoadingPr(true);
      try {
        const results = await api.searchPharmarack(product);
        if (isSelectingPrRef.current) return;
        setPrSearchResults(results || []);
        setShowPrDropdown(results && results.length > 0);
      } catch (err) {
        console.error('Pharmarack query failed:', err);
      } finally {
        setLoadingPr(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [product]);

  const handleSelectPharmarackItem = (item: any) => {
    isSelectingPrRef.current = true;
    setProduct(item.name);
    setSelectedDistributor(item.distributor || '');
    setSelectedRate(item.rate !== null && item.rate !== undefined ? item.rate : '');
    setSelectedMrp(item.mrp !== null && item.mrp !== undefined ? item.mrp : '');
    setSelectedMapped(!!item.mapped);
    setSelectedScheme(item.scheme || '');
    setSelectedProductId(item.productId || '');
    setSelectedStoreId(item.storeId || '');
    setSelectedProductCode(item.productCode || '');
    setSelectedCompany(item.company || '');
    setSelectedPackaging(item.packaging || '');
    setPrSearchResults([]);
    setShowPrDropdown(false);
  };

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await withSilentRetry(() => api.getOrders());
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      toastEvent.trigger('Failed to load special requests', 'error', '/crm');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const handleRefresh = () => {
      loadOrders();
    };
    window.addEventListener('refresh-special-orders', handleRefresh);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
    };
  }, [loadOrders]);

  const handleNotifyArrival = async (order: SpecialOrderItem) => {
    if (notifyingId === order.id) return;
    setNotifyingId(order.id);
    try {
      messageSendEvent.triggerSendProgress(order.requester || order.phone || 'Customer', `Arrival alert for ${order.product}`, 10);
      await api.notifySpecialOrderArrival(order.id);
      toastEvent.trigger(`Arrival WhatsApp sent to ${order.requester}!`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
      await loadOrders();
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send arrival notification', 'error', '/crm');
    } finally {
      setNotifyingId(null);
    }
  };

  const handleResendBooking = async (order: SpecialOrderItem) => {
    if (resendingId === order.id) return;
    setResendingId(order.id);
    try {
      messageSendEvent.triggerSendProgress(order.requester || order.phone || 'Customer', `Booking confirmation for ${order.product}`, 10);
      await api.resendSpecialOrderBooking(order.id);
      toastEvent.trigger(`Booking WhatsApp resent to ${order.requester}!`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
      await loadOrders();
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to resend booking message', 'error', '/crm');
    } finally {
      setResendingId(null);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    if (updatingId === id) return;
    setUpdatingId(id);
    try {
      await api.updateOrder(id, { status: newStatus });
      toastEvent.trigger(`Status updated to ${newStatus}`, 'success', '/crm');
      await loadOrders();
    } catch {
      toastEvent.trigger('Failed to update order status', 'error', '/crm');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSellSpecialOrder = (order: SpecialOrderItem) => {
    const prefill = {
      patientName: order.requester,
      patientPhone: order.phone,
      specialOrderId: order.id,
      advancePayment: order.advance_payment ? Number(order.advance_payment) : 0,
      medicines: [{ medicineName: order.product, quantity_needed: order.qty }]
    };
    toastEvent.trigger(`Transferring "${order.product}" (Qty: ${order.qty}) to POS for ${order.requester}...`, 'info', '/pos');
    navigate('/pos', { state: { prefill } });
  };

  const handleAddToCart = async (order: SpecialOrderItem) => {
    setAddingCartId(order.id);
    try {
      const res = await api.addPharmarackCart([{
        productId: 0,
        storeId: 0,
        qty: order.qty || 1,
        productName: order.product,
        storeName: order.pharmarack_distributor || undefined,
        rate: order.pharmarack_rate || undefined,
        mrp: order.pharmarack_mrp || undefined,
        scheme: order.pharmarack_scheme || undefined,
        mapped: order.pharmarack_mapped === 1
      }]);
      if (res && res.success) {
        toastEvent.trigger(`Added "${order.product}" to Pharmarack cart!`, 'success', '/crm');
        await api.updateOrder(order.id, { status: 'Ordered' });
        await loadOrders();
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
      } else {
        toastEvent.trigger(res?.error || 'Failed to add item to cart', 'error', '/crm');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || 'Failed to add to cart', 'error', '/crm');
    } finally {
      setAddingCartId(null);
    }
  };

  const handleDeleteOrder = async (id: number, product: string) => {
    if (!window.confirm(`Are you sure you want to cancel and delete the special order request for "${product}"?`)) return;
    setDeletingId(id);
    try {
      await api.deleteOrder(id);
      toastEvent.trigger(`Special order for "${product}" cancelled & deleted`, 'success', '/crm');
      await loadOrders();
      specialOrdersEvent.triggerUpdated();
    } catch {
      toastEvent.trigger('Failed to delete order request', 'error', '/crm');
    } finally {
      setDeletingId(null);
    }
  };

  const handleConvertToRefill = async (order: SpecialOrderItem) => {
    const daysStr = prompt(`Enter refill frequency in days for "${order.product}" (e.g. 30):`, '30');
    if (daysStr === null) return;
    
    const intervalDays = parseInt(daysStr, 10);
    if (isNaN(intervalDays) || intervalDays <= 0) {
      toastEvent.trigger('Please enter a valid number of days.', 'error', '/crm');
      return;
    }

    setConvertingId(order.id);
    try {
      const response = await api.convertToRefill(order.id, intervalDays);
      if (response.success) {
        toastEvent.trigger(response.message || 'Successfully converted to recurring refill!', 'success', '/crm');
        await loadOrders();
      } else {
        toastEvent.trigger(response.error || 'Failed to convert to recurring refill.', 'error', '/crm');
      }
    } catch (err: any) {
      console.error('Error converting order to refill:', err);
      toastEvent.trigger('Failed to convert order to recurring refill.', 'error', '/crm');
    } finally {
      setConvertingId(null);
    }
  };

  const handleScanUncollected = async () => {
    setRefreshing(true);
    try {
      const alertedList = await api.getUncollectedAlerts();
      const notifiedCount = alertedList.filter(o => o.notified).length;
      
      if (notifiedCount > 0) {
        toastEvent.trigger(`Reminders scan complete. Sent WhatsApp alerts to ${notifiedCount} customer(s).`, 'success', '/crm');
      } else {
        toastEvent.trigger('No uncollected orders required notifications at this time.', 'info', '/crm');
      }
      await loadOrders();
    } catch (err) {
      console.error('Error scanning uncollected alerts:', err);
      toastEvent.trigger('Failed to execute uncollected alerts reminders.', 'error', '/crm');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const customerName = requester.trim();
    const customerPhone = phone.replace(/\D/g, '');

    if (!product.trim()) {
      toastEvent.trigger('Product name is required.', 'error', '/crm');
      return;
    }
    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error', '/crm');
      return;
    }
    if (!customerPhone || customerPhone.length < 10) {
      setShakePhone(true);
      setTimeout(() => setShakePhone(false), 400);
      toastEvent.trigger('Please enter a valid 10-digit mobile number.', 'error', '/crm');
      return;
    }
    if (!qty || Number(qty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setFormSubmitting(true);
    try {
      await api.createOrder({
        product: product.trim(),
        requester: customerName,
        phone: customerPhone,
        qty: Number(qty) || 1,
        priority,
        status: 'Pending',
        language,
        pharmarack_distributor: selectedDistributor || undefined,
        pharmarack_rate: selectedRate !== '' ? Number(selectedRate) : undefined,
        pharmarack_mrp: selectedMrp !== '' ? Number(selectedMrp) : undefined,
        pharmarack_mapped: selectedMapped ? 1 : 0,
        pharmarack_scheme: selectedScheme || undefined,
        advance_payment: advancePayment !== '' ? Number(advancePayment) : 0
      });

      // Auto sync to Pharmarack Cart
      try {
        const cartRes = await api.addPharmarackCart([{
          productId: selectedProductId || 0,
          storeId: selectedStoreId || 0,
          qty: Number(qty) || 1,
          rate: selectedRate !== '' ? Number(selectedRate) : undefined,
          scheme: selectedScheme || undefined,
          productCode: selectedProductCode || undefined,
          company: selectedCompany || undefined,
          productName: product.trim(),
          storeName: selectedDistributor || undefined,
          packaging: selectedPackaging || undefined,
          mapped: selectedMapped
        }]);
        if (cartRes && cartRes.success) {
          window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        }
      } catch (_) {}

      toastEvent.trigger(`Special order for "${product}" logged & synced!`, 'success', '/crm');
      setShowAddModal(false);
      setProduct('');
      setRequester('');
      setPhone('');
      setQty(1);
      setAdvancePayment('');
      setPriority('Normal');
      setLanguage('en');
      setSelectedDistributor('');
      setSelectedRate('');
      setSelectedMrp('');
      setSelectedMapped(true);
      setSelectedScheme('');
      setSelectedProductId('');
      setSelectedStoreId('');
      setSelectedProductCode('');
      setSelectedCompany('');
      setSelectedPackaging('');
      isSelectingPrRef.current = false;
      await loadOrders();
      specialOrdersEvent.triggerUpdated();
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || 'Failed to log special request', 'error', '/crm');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleOpenEditModal = (order: SpecialOrderItem) => {
    setEditingOrder(order);
    setEditProduct(order.product || '');
    setEditRequester(order.requester || '');
    setEditPhone(order.phone || '');
    setEditQty(order.qty || 1);
    setEditAdvancePayment(order.advance_payment !== undefined && order.advance_payment !== null ? Number(order.advance_payment) : '');
    setEditPriority(order.priority || 'Normal');
    setEditStatus(order.status || 'Pending');
    setEditDistributor(order.pharmarack_distributor || '');
    setEditRate(order.pharmarack_rate !== undefined && order.pharmarack_rate !== null ? Number(order.pharmarack_rate) : '');
    setEditMrp(order.pharmarack_mrp !== undefined && order.pharmarack_mrp !== null ? Number(order.pharmarack_mrp) : '');
    setEditScheme(order.pharmarack_scheme || '');
    setEditLanguage(order.language || 'en');
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const customerName = editRequester.trim();
    const customerPhone = editPhone.replace(/\D/g, '');

    if (!editProduct.trim()) {
      toastEvent.trigger('Product name is required.', 'error', '/crm');
      return;
    }
    if (!customerName) {
      toastEvent.trigger('Customer Name is required.', 'error', '/crm');
      return;
    }
    if (!customerPhone || customerPhone.length < 10) {
      setShakeEditPhone(true);
      setTimeout(() => setShakeEditPhone(false), 400);
      toastEvent.trigger('Customer phone number must be 10 digits.', 'error', '/crm');
      return;
    }
    if (!editQty || Number(editQty) < 1) {
      toastEvent.trigger('Quantity must be at least 1.', 'error', '/crm');
      return;
    }

    setEditFormSubmitting(true);
    try {
      await api.updateOrder(editingOrder.id, {
        product: editProduct.trim(),
        requester: customerName,
        phone: customerPhone,
        qty: Number(editQty) || 1,
        priority: editPriority,
        status: editStatus,
        language: editLanguage,
        pharmarack_distributor: editDistributor || undefined,
        pharmarack_rate: editRate !== '' ? Number(editRate) : undefined,
        pharmarack_mrp: editMrp !== '' ? Number(editMrp) : undefined,
        pharmarack_scheme: editScheme || undefined,
        advance_payment: editAdvancePayment !== '' ? Number(editAdvancePayment) : 0
      });

      toastEvent.trigger(`Special request for "${editProduct.trim()}" updated successfully!`, 'success', '/crm');
      setShowEditModal(false);
      setEditingOrder(null);
      await loadOrders();
      specialOrdersEvent.triggerUpdated();
    } catch (err: any) {
      console.error('Failed to update special order request:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to update special order request', 'error', '/crm');
    } finally {
      setEditFormSubmitting(false);
    }
  };

  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || 
      (o.product && o.product.toLowerCase().includes(q)) ||
      (o.requester && o.requester.toLowerCase().includes(q)) ||
      (o.phone && o.phone.includes(q)) ||
      (o.pharmarack_distributor && o.pharmarack_distributor.toLowerCase().includes(q));
    
    if (!matchesSearch) return false;

    let matchesStatus = true;
    if (statusFilter === 'Pending') matchesStatus = o.status === 'Pending';
    else if (statusFilter === 'Ordered') matchesStatus = o.status === 'Ordered';
    else if (statusFilter === 'Waiting') matchesStatus = o.status === 'Waiting';
    else if (statusFilter === 'Arrived') matchesStatus = o.status === 'Ready' || o.status === 'Arrived';
    else if (statusFilter === 'Not Arrived') matchesStatus = o.status !== 'Ready' && o.status !== 'Arrived' && o.status !== 'Fulfilled';

    if (!matchesStatus) return false;

    let matchesDate = true;
    if (dateFrom || dateTo) {
      if (!o.date) {
        matchesDate = false;
      } else {
        const itemDate = o.date.substring(0, 10);
        const start = dateFrom || '0000-00-00';
        const end = dateTo || '9999-99-99';
        matchesDate = itemDate >= start && itemDate <= end;
      }
    }
    return matchesDate;
  });

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Top Controls & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-bg border border-border rounded-xl shrink-0">
        {/* Left: Search & Status Filters */}
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search medicine, customer, phone, invoice, distributor..."
              value={searchQuery}
              onChange={e => {
                const val = e.target.value;
                setSearchQuery(val.includes('|') ? val.split('|')[0].trim() : val);
              }}
              className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
          <div className="flex items-center gap-1 bg-bg3/60 p-1 rounded-xl border border-border">
            {['All', 'Pending', 'Ordered', 'Waiting', 'Arrived', 'Not Arrived'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === st ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Date Range, Remind Uncollected, Refresh, New Request */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date Picker Controls */}
          <div className="flex items-center gap-1.5 bg-bg border border-border px-2.5 py-1 rounded-xl text-xs">
            <Calendar size={13} className="text-muted" />
            <input
              type="date"
              value={toDateInputValue(dateFrom)}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-transparent text-text font-medium focus:outline-none text-[11px]"
            />
            <span className="text-muted text-[10px]">to</span>
            <input
              type="date"
              value={toDateInputValue(dateTo)}
              onChange={e => {
                setManualToDate(true);
                setDateTo(e.target.value);
              }}
              className="bg-transparent text-text font-medium focus:outline-none text-[11px]"
            />
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center bg-bg3/60 p-0.5 rounded-lg border border-border">
            <button
              onClick={() => { setDateFrom(getNDaysAgoString(15)); setDateTo(getTodayString()); setManualToDate(false); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
            >
              15d
            </button>
            <button
              onClick={() => { setDateFrom(getNDaysAgoString(30)); setDateTo(getTodayString()); setManualToDate(false); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
            >
              30d
            </button>
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-text rounded"
            >
              All
            </button>
          </div>

          {/* Auto Remind Uncollected Button */}
          <button
            onClick={handleScanUncollected}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-all disabled:opacity-50"
            title="Scan orders ready for 2+ days and send auto WhatsApp reminder notifications"
          >
            <AlertTriangle size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Auto Remind</span>
          </button>

          <button
            onClick={loadOrders}
            className="p-2 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text transition-all"
            title="Refresh special orders"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all"
          >
            <Plus size={14} />
            <span>New Special Request</span>
          </button>
        </div>
      </div>

      {/* Orders List Container */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
        {loading && orders.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted">Loading special requests...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-2 text-xs text-muted bg-bg2/40 rounded-2xl border border-border/50">
            <span className="font-semibold text-text text-sm">No special requests found matching your filter.</span>
            {searchQuery.trim().length >= 2 && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-amber-400 font-medium text-[12px]">
                  🔍 No exact match for "{searchQuery}". Please check spelling or try searching by product or patient name.
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg text-[12px] font-bold transition-all"
                >
                  Clear Search Query
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredOrders.map(order => {
            const isArrived = order.status === 'Ready' || order.status === 'Arrived';
            const isOrdered = order.status === 'Ordered';
            const hasAdvance = order.advance_payment && Number(order.advance_payment) > 0;
            return (
              <div
                key={order.id}
                className={`p-4 rounded-2xl border transition-all ${
                  isArrived
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : order.status === 'Waiting'
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : isOrdered
                    ? 'bg-indigo-500/5 border-indigo-500/30'
                    : 'bg-bg2 border-border hover:border-primary/40'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Left Column: Product & Customer Info */}
                  <div className="space-y-1.5 flex-1 min-w-[260px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-text">{order.product}</h3>
                      <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-[11px] font-bold text-primary">
                        Qty: {order.qty}
                      </span>
                      {hasAdvance && (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-extrabold flex items-center gap-1">
                          ✨ Advance Paid: ₹{Number(order.advance_payment).toFixed(2)}
                        </span>
                      )}
                      {order.priority && (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          order.priority === 'High' ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-bg3 text-muted border border-border'
                        }`}>
                          {order.priority}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        isArrived
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : order.status === 'Waiting'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : isOrdered
                          ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}>
                        {order.status}
                      </span>

                      {/* Notified Badge */}
                      {order.notified === 1 && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1">
                          <CheckCircle2 size={11} /> WA Sent
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                      <span className="font-semibold text-text flex items-center gap-1">
                        <Users size={12} className="text-primary" />
                        {order.requester}
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-bg3 text-text border border-border ml-1">
                          {order.language === 'hi' ? '🇮🇳 HI' : order.language === 'mr' ? '🇮🇳 MR' : '🇬🇧 EN'}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Phone size={12} className="text-muted" />
                        {order.phone}
                      </span>
                      {order.pharmarack_distributor && (
                        <span className="px-2 py-0.5 rounded-md bg-bg3/80 text-[11px] text-muted border border-border font-medium">
                          Distributor: <strong className="text-text">{order.pharmarack_distributor}</strong>
                        </span>
                      )}
                      <span className="text-[11px]">
                        Logged: {formatDate(order.date)}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Complete Status Action Bar */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {/* Sell Now Button - Quick Handoff to POS */}
                    <button
                      onClick={() => handleSellSpecialOrder(order)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-md shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      title="Sell now: Transfers patient, medicine, quantity & advance credit directly to POS"
                    >
                      <ShoppingCart size={14} />
                      <span>⚡ Sell Now</span>
                    </button>

                    {/* Arrived & WA Button */}
                    {!isArrived ? (
                      <button
                        onClick={() => handleNotifyArrival(order)}
                        disabled={notifyingId === order.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 text-xs font-bold transition-all disabled:opacity-50"
                        title="Mark order as arrived and auto send WhatsApp arrival notification to customer"
                      >
                        <CheckCircle2 size={13} className={notifyingId === order.id ? 'animate-spin' : ''} />
                        <span>{notifyingId === order.id ? 'Sending...' : 'Arrived & WA'}</span>
                      </button>
                    ) : (
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1">
                        <Check size={12} />
                        <span>Arrived &amp; Customer Notified</span>
                      </span>
                    )}

                    {/* Pending Status Button */}
                    {order.status !== 'Pending' && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'Pending')}
                        disabled={updatingId === order.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 text-xs font-semibold transition-all"
                        title="Set status to Pending"
                      >
                        <Clock size={12} />
                        <span>Pending</span>
                      </button>
                    )}

                    {/* Waiting Status Button */}
                    {order.status !== 'Waiting' && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'Waiting')}
                        disabled={updatingId === order.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-semibold transition-all"
                        title="Set status to Waiting"
                      >
                        <Clock size={12} />
                        <span>Waiting</span>
                      </button>
                    )}

                    {/* Add to Pharmarack Cart */}
                    <button
                      onClick={() => handleAddToCart(order)}
                      disabled={addingCartId === order.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-xs font-bold transition-all disabled:opacity-50"
                      title="Push special request item directly to Pharmarack Cart"
                    >
                      <ShoppingCart size={13} className={addingCartId === order.id ? 'animate-spin' : ''} />
                      <span>{addingCartId === order.id ? 'Adding...' : 'Cart'}</span>
                    </button>

                    {/* Convert Refill */}
                    <button
                      onClick={() => handleConvertToRefill(order)}
                      disabled={convertingId === order.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-semibold transition-all disabled:opacity-50"
                      title="Convert special order into recurring patient refill schedule"
                    >
                      <Repeat2 size={12} className={convertingId === order.id ? 'animate-spin' : ''} />
                      <span>{convertingId === order.id ? '...' : 'Refill'}</span>
                    </button>

                    {/* Resend WA */}
                    <button
                      onClick={() => handleResendBooking(order)}
                      disabled={resendingId === order.id}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-bg3 border border-border text-muted hover:text-primary text-xs font-semibold transition-all"
                      title="Resend booking confirmation WhatsApp"
                    >
                      <MessageCircle size={12} />
                      <span>{resendingId === order.id ? 'Sending...' : 'WA'}</span>
                    </button>

                    {/* Edit Button */}
                    <button
                      onClick={() => handleOpenEditModal(order)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold transition-all cursor-pointer"
                      title="Edit Special Order Request details"
                    >
                      <Pencil size={12} />
                      <span>Edit</span>
                    </button>

                    {/* Cancel Button */}
                    <button
                      onClick={() => handleDeleteOrder(order.id, order.product)}
                      disabled={deletingId === order.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-bold transition-all disabled:opacity-50"
                      title="Cancel Special Order Request"
                    >
                      <Trash2 size={12} />
                      <span>{deletingId === order.id ? 'Deleting...' : 'Cancel'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Special Request Modal inside CRM */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-lg bg-bg2 rounded-2xl border border-primary/20 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <ClipboardList size={16} className="text-primary" />
                Register Out-of-Stock Special Request
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-3.5 text-xs">
              {/* Product Search with Live Pharmarack Autocomplete */}
              <div ref={productContainerRef} className="space-y-1.5 relative">
                <label className="block font-semibold text-text">Requested Medicine Name *</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Search medicine e.g. Lipitor 10mg..."
                    value={product}
                    onChange={e => {
                      isSelectingPrRef.current = false;
                      setProduct(e.target.value);
                    }}
                    onFocus={() => { if (prSearchResults.length > 0) setShowPrDropdown(true); }}
                    className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary text-xs"
                  />
                  {loadingPr && (
                    <div className="absolute right-3 top-2.5">
                      <RefreshCw size={14} className="animate-spin text-primary" />
                    </div>
                  )}
                </div>

                {/* Dropdown Live Results from Pharmarack */}
                {showPrDropdown && prSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-bg2 border border-border rounded-xl shadow-2xl z-50 max-h-56 overflow-y-auto">
                    <div className="p-2 border-b border-border/40 bg-bg3/50 text-[9px] font-bold text-muted uppercase tracking-wider flex justify-between items-center">
                      <span>Pharmarack Live Matches</span>
                      <button
                        type="button"
                        onClick={() => setShowPrDropdown(false)}
                        className="text-muted hover:text-text font-bold"
                      >
                        Close
                      </button>
                    </div>
                    {prSearchResults.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectPharmarackItem(item)}
                        className="p-3 border-b border-border/30 hover:bg-bg3/80 transition-colors cursor-pointer flex flex-col gap-1 text-xs"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5 flex-wrap truncate max-w-[200px]">
                            <span className="font-bold text-text truncate" title={item.name}>
                              {item.name} <span className="text-[10px] text-muted">({item.packaging})</span>
                            </span>
                            {item.scheme && (
                              <span className="text-[8px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1 py-0.2 rounded font-semibold uppercase">
                                {item.scheme}
                              </span>
                            )}
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            item.mapped
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {item.mapped ? 'Mapped' : 'Non-Mapped'}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted truncate">
                          Distributor: <span className="text-text font-medium">{item.distributor}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono mt-0.5">
                          <span className="text-green-400 font-bold">
                            PTR: {item.rate ? `₹${item.rate.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-text">
                            MRP: {item.mrp ? `₹${item.mrp.toFixed(2)}` : 'N/A'}
                          </span>
                          <span className="text-sky-400">
                            Stock: {item.stock}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected Pharmarack Metadata Panel */}
              {selectedDistributor && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl flex flex-col gap-1 text-[11px] animate-fade-in">
                  <div className="font-bold text-primary flex items-center justify-between">
                    <span>Selected Pharmarack Option</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDistributor('');
                        setSelectedRate('');
                        setSelectedMrp('');
                        setSelectedMapped(true);
                        setSelectedScheme('');
                        setSelectedProductId('');
                        setSelectedStoreId('');
                        setSelectedProductCode('');
                        setSelectedCompany('');
                        setSelectedPackaging('');
                      }}
                      className="text-muted hover:text-red-400 text-[10px] font-bold underline"
                    >
                      Clear option
                    </button>
                  </div>
                  <div className="text-text flex justify-between">
                    <span>Distributor: <strong>{selectedDistributor}</strong></span>
                    <span>Rate: <strong className="text-green-400">{selectedRate !== '' ? `₹${selectedRate}` : 'N/A'}</strong></span>
                  </div>
                  {selectedScheme && (
                    <div className="text-amber-400 font-semibold">Scheme: {selectedScheme}</div>
                  )}
                </div>
              )}

              {/* Customer Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Customer Name"
                    value={requester}
                    onChange={e => setRequester(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <PhoneInputWithBadge
                    label="Phone (WhatsApp)"
                    value={phone}
                    onChange={val => setPhone(val)}
                    required={true}
                    allowEmpty={false}
                    shakeOnError={shakePhone}
                  />
                </div>
              </div>

              {/* Quantity, Advance Payment & Priority */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={qty}
                    onChange={e => setQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Advance Paid (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={advancePayment}
                    onChange={e => setAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-semibold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High Priority</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-muted text-[11px]">
                📱 <strong>Auto WhatsApp Alert:</strong> Logging this request will automatically send a booking confirmation message to the customer (including Advance Payment details if added).
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-bg3 border border-border text-muted hover:text-text font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-md shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {formSubmitting ? 'Logging Request...' : 'Log & Sync Cart'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Special Request Modal */}
      {showEditModal && editingOrder && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-lg bg-bg2 rounded-2xl border border-primary/20 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <Pencil size={16} className="text-primary" />
                Edit Special Order Request #{editingOrder.id}
              </h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingOrder(null);
                }}
                className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              {/* Product Name */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-text">Requested Medicine Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Medicine name..."
                  value={editProduct}
                  onChange={e => setEditProduct(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary text-xs"
                />
              </div>

              {/* Customer Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Customer Name"
                    value={editRequester}
                    onChange={e => setEditRequester(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Phone (WhatsApp) *</label>
                  <input
                    type="tel"
                    required
                    placeholder="10-digit mobile"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Quantity, Advance Payment & Priority */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editQty}
                    onChange={e => setEditQty(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Advance Paid (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={editAdvancePayment}
                    onChange={e => setEditAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-semibold text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Priority</label>
                  <select
                    value={editPriority}
                    onChange={e => setEditPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High Priority</option>
                  </select>
                </div>
              </div>

              {/* Status & Distributor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text mb-1">Order Status</label>
                  <select
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Waiting">Waiting</option>
                    <option value="Ordered">Ordered</option>
                    <option value="Ready">Ready (Arrived)</option>
                    <option value="Fulfilled">Fulfilled</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-text mb-1">Pharmarack Distributor</label>
                  <input
                    type="text"
                    placeholder="Distributor Name (optional)"
                    value={editDistributor}
                    onChange={e => setEditDistributor(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl font-medium focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingOrder(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-bg3 border border-border text-muted hover:text-text font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editFormSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-md shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {editFormSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER CREDIT SECTION
// ═══════════════════════════════════════════════════════════════════════════════







// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER CREDIT SECTION
// ═══════════════════════════════════════════════════════════════════════════════

interface CreditCustomerItem {
  id: number;
  name: string;
  phone: string;
  address?: string;
  language?: string;
  credit_balance: number;
  credit_due_date?: string;
  unpaid_bills_count: number;
  last_sale_date?: string;
}

const CustomerCreditSection: React.FC = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CreditCustomerItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CreditCustomerItem | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [collectingPayment, setCollectingPayment] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);

  const loadCustomerInvoices = useCallback(async (customerId: number) => {
    setLoadingInvoices(true);
    try {
      const res = await apiClient.get<any[]>(`/crm/${customerId}/history`);
      setCustomerInvoices(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastEvent.trigger('Failed to load customer purchase bills', 'error', '/crm');
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  // Handle ESC key to close viewInvoice modal.
  // Handler reads the latest value via ref so the effect can attach the
  // listener once ([]) instead of re-attaching on every open/close.
  const viewInvoiceRef = useRef(viewInvoice);
  useEffect(() => {
    viewInvoiceRef.current = viewInvoice;
  }, [viewInvoice]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewInvoiceRef.current) {
        setViewInvoice(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Tracks the currently selected customer id via ref (not state) so it can be
  // read synchronously before the list fetch resolves, without adding
  // `selectedCustomer` to loadCreditCustomers' deps (which would re-trigger the
  // mount effect below on every customer click).
  const selectedCustomerIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomer?.id ?? null;
  }, [selectedCustomer]);

  const loadCreditCustomers = useCallback(async () => {
    setLoading(true);
    const previousId = selectedCustomerIdRef.current;
    try {
      // Fetch the customer list and the previously-selected customer's invoice
      // history concurrently instead of waiting for the list before starting
      // the history fetch — they're independent once the id is already known.
      const [res, invoicesRes] = await Promise.all([
        apiClient.get<CreditCustomerItem[]>('/crm/credit-customers'),
        previousId
          ? apiClient.get<any[]>(`/crm/${previousId}/history`).catch(() => null)
          : Promise.resolve(null)
      ]);
      const data = Array.isArray(res.data) ? res.data : [];
      setCustomers(data);
      if (data.length > 0) {
        const match = data.find(c => c.id === previousId);
        const active = match || data[0];
        setSelectedCustomer(active);
        if (active.id === previousId && invoicesRes) {
          setCustomerInvoices(Array.isArray(invoicesRes.data) ? invoicesRes.data : []);
        } else {
          loadCustomerInvoices(active.id);
        }
      }
    } catch {
      toastEvent.trigger('Failed to load credit customers', 'error', '/crm');
    } finally {
      setLoading(false);
    }
  }, [loadCustomerInvoices]);

  useEffect(() => {
    loadCreditCustomers();
  }, [loadCreditCustomers]);

  const handleSaveDueDate = async (id: number) => {
    try {
      await apiClient.put(`/crm/credit-customers/${id}/due-date`, { due_date: newDueDate || null });
      toastEvent.trigger('Due date updated', 'success', '/crm');
      setEditingId(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to update due date', 'error', '/crm');
    }
  };

  const handleSendManualReminder = async (cust: CreditCustomerItem) => {
    setSendingId(cust.id);
    try {
      await apiClient.post(`/crm/credit-customers/${cust.id}/send-reminder`, {});
      toastEvent.trigger(`Manual credit reminder sent to ${cust.name}`, 'success', '/crm');
      whatsappQueueEvent.triggerUpdated();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to send WhatsApp reminder', 'error', '/crm');
    } finally {
      setSendingId(null);
    }
  };

  const handlePayBalance = async (id: number) => {
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toastEvent.trigger('Enter a valid payment amount', 'error', '/crm');
      return;
    }
    setCollectingPayment(true);
    try {
      const res = await apiClient.post('/crm/ledger/pay', { amount: amt, customer_id: id });
      const successMsg = res.data?.message || `Collected ₹${amt.toFixed(2)} payment`;
      toastEvent.trigger(successMsg, 'success', '/crm');
      setPayingId(null);
      setPayAmount('');
      await loadCreditCustomers();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to process payment', 'error', '/crm');
    } finally {
      setCollectingPayment(false);
    }
  };

  const handleClearCredit = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to clear/remove credit entry for ${name}?`)) return;
    try {
      await apiClient.post(`/crm/credit-customers/${id}/clear`);
      toastEvent.trigger(`Cleared credit entry for ${name}`, 'success', '/crm');
      setSelectedCustomer(null);
      await loadCreditCustomers();
    } catch {
      toastEvent.trigger('Failed to clear customer credit', 'error', '/crm');
    }
  };

  const filtered = customers.filter(c => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  });

  const totalDues = customers.reduce((sum, c) => sum + (c.credit_balance || 0), 0);

  return (
    <div className="w-full h-full flex flex-col gap-3 overflow-hidden pr-1">
      {/* Header Cards & Quick Search */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Total Medical Outstanding Dues</p>
            <h3 className="text-lg font-bold text-amber-400 mt-0.5">₹{totalDues.toFixed(2)}</h3>
          </div>
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] text-muted font-medium">Active Credit Customers</p>
            <h3 className="text-lg font-bold text-text mt-0.5">{customers.length} Customers</h3>
          </div>
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users size={18} />
          </div>
        </div>

        <div className="p-3.5 bg-bg border border-border rounded-2xl flex items-center justify-between shadow-sm">
          <button
            onClick={loadCreditCustomers}
            disabled={loading}
            className="w-full h-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-bg3 border border-border text-xs font-bold text-text hover:text-primary transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Ledger Dues</span>
          </button>
        </div>
      </div>

      {/* Split-View Container */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 overflow-hidden min-h-0">
        {/* LEFT PANEL: Customer Credit Accounts List */}
        <div className="w-full md:w-80 lg:w-96 shrink-0 bg-bg border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-3 border-b border-border bg-bg3/40 flex items-center justify-between">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <Users size={14} className="text-amber-400" />
              Credit Customers / Accounts
            </h3>
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold">
              {filtered.length}
            </span>
          </div>

          {/* Search Input */}
          <div className="p-2 border-b border-border bg-bg">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
              <input
                type="text"
                placeholder="Search customer name, mobile or barcode..."
                value={search}
                onChange={e => {
                  const val = e.target.value;
                  setSearch(val.includes('|') ? val.split('|')[0].trim() : val);
                }}
                className="w-full pl-8 pr-2.5 py-1.5 bg-bg2 border border-border rounded-xl text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Customer Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading && customers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">Loading credit customers...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">No credit customers found.</div>
            ) : (
              filtered.map(cust => {
                const isSelected = selectedCustomer?.id === cust.id;
                return (
                  <div
                    key={cust.id}
                    onClick={() => {
                      setSelectedCustomer(cust);
                      loadCustomerInvoices(cust.id);
                    }}
                    className={`p-3 cursor-pointer transition-all flex items-center justify-between hover:bg-primary/5 ${
                      isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-text">{cust.name || 'Unnamed Patient'}</div>
                      <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5">
                        <span>📱 {cust.phone || 'No phone'}</span>
                        <span>•</span>
                        <span>{cust.unpaid_bills_count} Unpaid Bill(s)</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-amber-400">₹{(cust.credit_balance || 0).toFixed(2)}</div>
                      <div className="text-[9px] text-muted mt-0.5">
                        {cust.credit_due_date ? `Due: ${formatDate(cust.credit_due_date)}` : 'No Due Date'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Selected Account Purchases & Actions */}
        <div className="flex-1 bg-bg2 border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
          {selectedCustomer ? (
            <>
              {/* Account Header */}
              <div className="p-3.5 border-b border-border bg-bg3/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-text">{selectedCustomer.name || 'Unnamed Patient'}</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      CREDIT ACCOUNT
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-bg3 text-text border border-border">
                      {selectedCustomer.language === 'hi' ? '🇮🇳 HI' : selectedCustomer.language === 'mr' ? '🇮🇳 MR' : '🇬🇧 EN'}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-3">
                    <span>📱 {selectedCustomer.phone || 'No phone'}</span>
                    {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
                  </div>
                </div>

                {/* Right Side Balance & Action Buttons */}
                <div className="flex items-center gap-3">
                  <div className="text-right pr-2">
                    <div className="text-[10px] text-muted font-medium uppercase tracking-wider">Outstanding Balance</div>
                    <div className="text-base font-extrabold text-amber-400">₹{(selectedCustomer.credit_balance || 0).toFixed(2)}</div>
                  </div>

                  {/* Collect Payment Action Toggle */}
                  <button
                    onClick={() => {
                      if (payingId === selectedCustomer.id) {
                        setPayingId(null);
                      } else {
                        setPayingId(selectedCustomer.id);
                        setPayAmount(String(selectedCustomer.credit_balance || 0));
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 ${
                      payingId === selectedCustomer.id
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                  >
                    <Zap size={14} className={payingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>{payingId === selectedCustomer.id ? 'Cancel Payment' : 'Collect Payment'}</span>
                  </button>

                  {/* WhatsApp Reminder Button */}
                  <button
                    onClick={() => handleSendManualReminder(selectedCustomer)}
                    disabled={sendingId === selectedCustomer.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold transition-all disabled:opacity-50"
                    title="Send instant manual credit reminder on WhatsApp"
                  >
                    <Send size={12} className={sendingId === selectedCustomer.id ? 'animate-pulse' : ''} />
                    <span>Send WhatsApp Message</span>
                  </button>

                  {/* Clear Credit Entry Button */}
                  <button
                    onClick={() => handleClearCredit(selectedCustomer.id, selectedCustomer.name || 'Customer')}
                    className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red border border-red-500/30 hover:bg-red-500/20 text-xs font-bold transition-all"
                    title="Clear credit balance and remove entry from CRM credit list"
                  >
                    Clear Entry
                  </button>

                  {/* New Sale → POS Button */}
                  <button
                    onClick={() => navigate('/pos', {
                      state: {
                        prefill: {
                          patientName: selectedCustomer.name,
                          patientPhone: selectedCustomer.phone
                        }
                      }
                    })}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 text-xs font-bold transition-all flex items-center gap-1.5"
                    title="Open POS with this patient pre-filled"
                  >
                    <Package size={13} />
                    New Sale → POS
                  </button>
                </div>
              </div>

              {/* LIVE ANIMATED PAYMENT CALCULATION & AUTO-RECEIPT PANEL */}
              {payingId === selectedCustomer.id && (() => {
                const originalBal = selectedCustomer.credit_balance || 0;
                const enteredPay = parseFloat(payAmount) || 0;
                const liveRemaining = Math.max(0, originalBal - enteredPay);
                const payPercent = Math.min(100, Math.max(0, (enteredPay / (originalBal || 1)) * 100));
                const isFullPay = enteredPay >= originalBal && originalBal > 0;

                return (
                  <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-bg3 to-bg2 border-b border-emerald-500/30 flex flex-col gap-2.5 transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-1 shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {/* Input & Quick Percent Chips */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Zap size={14} className="text-emerald-400 animate-bounce" />
                          Collect Amount:
                        </span>
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-xs font-bold text-muted">₹</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={payAmount}
                            onChange={e => setPayAmount(e.target.value)}
                            className="w-32 pl-6 pr-2.5 py-1.5 bg-bg border border-emerald-500/40 rounded-xl text-xs font-bold text-text focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner"
                            autoFocus
                          />
                        </div>

                        {/* Quick preset chips */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPayAmount(String(originalBal))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${isFullPay ? 'bg-emerald-500 text-white shadow-sm' : 'bg-bg3 text-muted hover:text-text border border-border'}`}
                          >
                            100% Full (₹{originalBal.toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.5).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            50% (₹{(originalBal * 0.5).toFixed(2)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayAmount(String((originalBal * 0.25).toFixed(2)))}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-bg3 text-muted hover:text-text border border-border transition-all"
                          >
                            25% (₹{(originalBal * 0.25).toFixed(2)})
                          </button>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePayBalance(selectedCustomer.id)}
                          disabled={collectingPayment || enteredPay <= 0}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} className={collectingPayment ? 'animate-spin' : ''} />
                          <span>{collectingPayment ? 'Collecting & Sending Receipt...' : `Confirm & Collect ₹${enteredPay.toFixed(2)}`}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayingId(null)}
                          className="px-2.5 py-1.5 rounded-xl bg-bg3 border border-border text-muted hover:text-text text-xs font-semibold transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {/* Live Calculation Preview Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-border/40 text-xs">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-bg/50 border border-border/50">
                        <span className="text-muted text-[11px]">Original Dues:</span>
                        <span className="font-bold text-amber-400">₹{originalBal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <span className="text-emerald-400 text-[11px] font-medium">Paying Now:</span>
                        <span className="font-extrabold text-emerald-400">– ₹{enteredPay.toFixed(2)}</span>
                      </div>
                      <div className={`flex items-center justify-between p-2 rounded-xl border transition-all duration-300 ${liveRemaining === 0 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-bg/50 border-border/50 text-text'}`}>
                        <span className="text-[11px] font-medium">New Remaining Dues:</span>
                        <span className="font-extrabold text-xs transition-all duration-300">
                          {liveRemaining === 0 ? '✨ Fully Cleared (₹0.00)' : `₹${liveRemaining.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    {/* Live Progress Bar & WhatsApp Auto Notice */}
                    <div className="w-full">
                      <div className="flex justify-between text-[10px] text-muted mb-1 font-medium">
                        <span>Dues Cleared: {payPercent.toFixed(0)}%</span>
                        <span className="text-emerald-400 font-semibold">
                          {selectedCustomer.phone ? '📱 Auto WhatsApp Receipt Will Be Sent' : 'No phone saved for WhatsApp'}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-bg rounded-full overflow-hidden border border-border/40 p-0.5">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out shadow-sm"
                          style={{ width: `${payPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Due Date Management Bar */}
              <div className="px-4 py-2 bg-bg border-b border-border flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted font-medium">Agreed Credit Due Date:</span>
                  {editingId === selectedCustomer.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={toDateInputValue(newDueDate)}
                        onChange={e => setNewDueDate(e.target.value)}
                        className="px-2 py-0.5 bg-bg2 border border-border rounded text-xs text-text focus:outline-none"
                      />
                      <button onClick={() => handleSaveDueDate(selectedCustomer.id)} className="px-2 py-0.5 rounded bg-emerald-500 text-white font-bold text-[10px]">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-muted text-[10px]">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={selectedCustomer.credit_due_date ? 'text-text font-bold' : 'text-muted italic'}>
                        {selectedCustomer.credit_due_date ? formatDate(selectedCustomer.credit_due_date) : 'Not Set'}
                      </span>
                      <button onClick={() => { setEditingId(selectedCustomer.id); setNewDueDate(selectedCustomer.credit_due_date || ''); }} className="text-[10px] text-primary hover:underline font-bold">
                        Edit Date
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-muted text-[11px] font-medium">{customerInvoices.length} Credit Purchase Bill(s)</span>
              </div>

              {/* Credit Purchase History Table */}
              <div className="flex-1 overflow-y-auto p-4">
                <h4 className="text-xs font-bold text-text uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText size={14} className="text-primary" />
                  Credit Purchase History &amp; Bills
                </h4>

                {loadingInvoices ? (
                  <div className="p-8 text-center text-xs text-muted">Loading purchase bills...</div>
                ) : customerInvoices.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">No credit purchase bills found for this customer.</div>
                ) : (
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-bg3/50 border-b border-border text-muted font-bold">
                          <th className="p-2.5">Purchase Date</th>
                          <th className="p-2.5">Bill Number</th>
                          <th className="p-2.5">Doctor</th>
                          <th className="p-2.5">Payment Mode</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5 text-right">Bill Amount</th>
                          <th className="p-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {customerInvoices.map((inv: any) => (
                          <tr key={inv.id} className="hover:bg-bg/50 transition-colors">
                            <td className="p-2.5 text-muted">{formatDate(inv.date)}</td>
                            <td className="p-2.5 font-bold">
                              <button
                                onClick={() => setViewInvoice(inv)}
                                className="text-primary hover:underline font-mono font-bold flex items-center gap-1"
                                title="Click to view full medicine list & bill preview"
                              >
                                <FileText size={12} />
                                <span>{inv.invoice_no}</span>
                              </button>
                            </td>
                            <td className="p-2.5 text-muted">{inv.doctor_name || '-'}</td>
                            <td className="p-2.5 font-semibold text-text">{inv.payment_medium || 'CREDIT'}</td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                inv.payment_status === 'PAID'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {inv.payment_status || 'UNPAID'}
                              </span>
                            </td>
                            <td className="p-2.5 font-extrabold text-amber-400 text-right">₹{(inv.total_amount || 0).toFixed(2)}</td>
                            <td className="p-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setViewInvoice(inv)}
                                  className="px-2 py-1 rounded-lg bg-bg3 border border-border text-[11px] font-semibold text-text hover:text-primary transition-all flex items-center gap-1"
                                >
                                  <FileText size={11} />
                                  <span>View</span>
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      const full = await api.getSale(inv.id);
                                      const items = Array.isArray(full.items) ? full.items : [];
                                      navigate('/pos', {
                                        state: {
                                          prefill: {
                                            patientName: selectedCustomer.name,
                                            patientPhone: selectedCustomer.phone,
                                            selectedCustomerId: selectedCustomer.id,
                                            doctorName: full.doctor_name || inv.doctor_name || '',
                                            refillPatient: true,
                                            medicines: items.map((it: any) => ({
                                              medicineId: it.medicine_id,
                                              medicineName: it.medicine_name || it.name,
                                              inventory_id: it.inventory_id,
                                              batch_no: it.batch_no || it.batch_number || '',
                                              expiry_date: it.expiry_date || '',
                                              mrp: it.mrp || 0,
                                              sell_price: it.sell_price || null,
                                              quantity: it.quantity || 1,
                                              loose_qty: it.loose_qty || 0,
                                              unit_price: it.unit_price || it.sell_price || it.mrp || 0,
                                              discount: it.discount_per || it.discount || 0,
                                              pack_size: it.pack_size || 1
                                            }))
                                          }
                                        }
                                      });
                                      toastEvent.trigger(`Transferring repeat prescription for ${selectedCustomer.name} to POS...`, 'info', '/pos');
                                    } catch (err) {
                                      toastEvent.trigger('Failed to load bill items for POS', 'error');
                                    }
                                  }}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all flex items-center gap-1 shadow-sm"
                                  title="Load this previous prescription into POS for refill sale"
                                >
                                  <RotateCcw size={11} />
                                  <span>Refill</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-muted text-xs">
              Select a credit customer from the left panel to view purchase bills &amp; details.
            </div>
          )}
        </div>
      </div>

      {/* Bill Preview Modal (Matching Sales History Page Popup) */}
      {viewInvoice && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-4xl max-h-[90vh] flex flex-col border-primary/20 bg-bg2 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2 text-text">
                  <FileText size={18} className="text-primary" />
                  Bill Preview: {viewInvoice.invoice_no}
                </h3>
                <p className="text-xs text-muted mt-0.5">Read-only preview of credit sale invoice</p>
              </div>
              <button
                onClick={() => setViewInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-bg3 text-muted hover:text-text transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              {/* Customer & Invoice Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-bg3/30 p-3.5 rounded-xl border border-border text-xs">
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Patient Name</div>
                  <div className="font-bold text-text">{viewInvoice.customer_name || 'Walk-in'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">WhatsApp / Phone</div>
                  <div className="font-bold text-text">{viewInvoice.customer_phone || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Payment Method</div>
                  <div className="font-bold text-amber-400">{viewInvoice.payment_medium || 'CREDIT'} ({viewInvoice.payment_status || 'UNPAID'})</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0.5">Sale Date</div>
                  <div className="font-bold text-text">{formatDate(viewInvoice.date)}</div>
                </div>
              </div>

              {/* Purchased Medicines Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Purchased Medicines</h4>
                  <span className="text-xs text-muted">{viewInvoice.items?.length || 0} item(s)</span>
                </div>
                <div className="overflow-x-auto border border-border rounded-xl bg-bg">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-bg3/40 border-b border-border text-muted font-bold">
                        <th className="p-2.5">Medicine Name</th>
                        <th className="p-2.5">Batch</th>
                        <th className="p-2.5 text-center">Qty (Strips/Loose)</th>
                        <th className="p-2.5 text-center">CD %</th>
                        <th className="p-2.5">MRP</th>
                        <th className="p-2.5">Unit Price</th>
                        <th className="p-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {viewInvoice.items?.map((item: any, idx: number) => {
                        const packSize = item.pack_size || 1;
                        const looseQty = item.loose_qty || 0;
                        const discPer = item.discount_per || 0;
                        const discountedPrice = item.unit_price * (1 - discPer / 100);
                        const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
                        return (
                          <tr key={idx} className="hover:bg-bg2/50">
                            <td className="p-2.5 font-semibold text-text">{item.medicine_name || `Item #${item.inventory_id}`}</td>
                            <td className="p-2.5 font-mono text-[11px] text-muted">{item.batch_number || '-'}</td>
                            <td className="p-2.5 text-center font-bold">{item.quantity} / {looseQty}</td>
                            <td className="p-2.5 text-center text-muted">{discPer}%</td>
                            <td className="p-2.5 text-muted">₹{item.mrp || 0}</td>
                            <td className="p-2.5 font-medium text-text">₹{discountedPrice.toFixed(2)}</td>
                            <td className="p-2.5 font-bold text-emerald-400 text-right">₹{Math.round(itemTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-border flex justify-between items-center bg-bg3/50 shrink-0">
              <button
                onClick={() => setViewInvoice(null)}
                className="px-4 py-2 bg-bg3 text-muted rounded-xl text-xs font-semibold hover:text-text"
              >
                Close Preview
              </button>
              <div className="text-right">
                <div className="text-[10px] text-muted">Total Bill Amount</div>
                <div className="text-lg font-extrabold text-amber-400">
                  ₹{(viewInvoice.total_amount || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CRM PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const CRM: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'refills';

  const setTab = (key: string) => setSearchParams({ tab: key });

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm shrink-0">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-text leading-none">CRM & Customer Hub</h1>
            <p className="text-[11px] text-muted mt-0.5">Patient refills, special shortage orders, customer credit & WhatsApp</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg2 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <span className={isActive ? 'text-primary' : 'text-muted'}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'refills' && <RefillsSection />}
        {activeTab === 'special_orders' && <SpecialOrdersSection />}
        {activeTab === 'credit' && <CustomerCreditSection />}
        {activeTab === 'messages' && <DistributorMessagesSection />}
        {activeTab === 'whatsapp' && <WhatsAppSection />}
      </div>
    </div>
  );
};

export default CRM;
