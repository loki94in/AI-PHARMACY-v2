import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Truck,
  Package,
  Clock,
  CheckCircle,
  MapPin,
  Plus,
  X,
  User,
  Trash2,
  RefreshCw,
  Send,
  Check,
  Edit3,
  Bell,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  Search,
  Layers,
  Phone,
  Filter,
  ShieldCheck,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { api, apiClient } from '../../services/api';
import { whatsappQueueEvent, toastEvent } from '../../services/events';
import {
  getDispatchDeliveryBoysCache,
  getDispatchOrdersCache,
  setDispatchDeliveryBoysCache,
  setDispatchOrdersCache,
  clearDispatchPageCache,
  type CachedDeliveryBoy,
} from '../../utils/pageModuleCaches';
import { broadcastContactDataChanged } from '../../utils/settingsSync';
import { sanitizePhoneInput } from '../../utils/phone';
import { toDateInputValue } from '../../utils/date';

interface DispatchOrder {
  id: number;
  patient_name: string;
  patient_phone: string;
  address: string;
  items: string;
  notes: string;
  delivery_boy_id: number | null;
  delivery_boy_name?: string;
  invoice_no: string;
  status: 'Pending' | 'In Transit' | 'Delivered';
  created_at: string;
  delivered_at?: string;
}

interface DeliveryBoy {
  id: number;
  name: string;
  whatsapp_number?: string;
  is_active: number;
}

const statusStyles: Record<string, string> = {
  Pending: 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold',
  'In Transit': 'bg-sky/15 text-sky border border-sky/30 font-bold',
  Delivered: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold',
};

const emptyForm = { patient_name: '', patient_phone: '', address: '', items: '', notes: '', delivery_boy_id: '', invoice_no: '' };

type TabType = 'all' | 'queue' | 'reminders' | 'staff' | 'logs';

const Dispatch = () => {
  const cachedOrders = getDispatchOrdersCache() as DispatchOrder[] | null;
  const cachedDeliveryBoys = getDispatchDeliveryBoysCache() as DeliveryBoy[] | null;

  const [activeTab, setActiveTab] = useState<TabType>('queue');
  const [orders, setOrders] = useState<DispatchOrder[]>(cachedOrders || []);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>(cachedDeliveryBoys || []);
  const [allBoys, setAllBoys] = useState<DeliveryBoy[]>([]);
  const [loading, setLoading] = useState(!cachedOrders);
  const [showModal, setShowModal] = useState(false);
  const [showBoysModal, setShowBoysModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // Search & Filter States
  const [queueSearch, setQueueSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // New delivery boy form states
  const [newBoyName, setNewBoyName] = useState('');
  const [newBoyPhone, setNewBoyPhone] = useState('');
  const [addingBoy, setAddingBoy] = useState(false);

  // Edit delivery boy state
  const [editingBoyId, setEditingBoyId] = useState<number | null>(null);
  const [editBoyName, setEditBoyName] = useState('');
  const [editBoyPhone, setEditBoyPhone] = useState('');
  const [savingBoyEdit, setSavingBoyEdit] = useState(false);

  // Delivery Boy Sent Message History states
  const [messageDates, setMessageDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Distributor Dispatch Reminders state
  const [distributorReminders, setDistributorReminders] = useState<any[]>([]);
  const [distributorSearch, setDistributorSearch] = useState('');
  const [sendingReminderId, setSendingReminderId] = useState<number | null>(null);
  const [loadingDistributorReminders, setLoadingDistributorReminders] = useState(false);

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    toastEvent.trigger(msg, type);
  };

  const fetchAll = useCallback(async () => {
    const ordersCache = getDispatchOrdersCache();
    if (!ordersCache || (Array.isArray(ordersCache) && ordersCache.length === 0)) {
      setLoading(true);
    }
    try {
      const [ordersData, boysData] = await Promise.all([
        api.getDispatchOrders(),
        api.getDeliveryBoys(),
      ]);
      const ordersArr = Array.isArray(ordersData) ? ordersData : [];
      const rawBoys = Array.isArray(boysData) ? boysData : [];
      const activeBoysArr = rawBoys.filter((b: DeliveryBoy) => b.is_active);
      setDispatchOrdersCache(ordersArr);
      setDispatchDeliveryBoysCache(activeBoysArr as CachedDeliveryBoy[]);
      setOrders(ordersArr);
      setAllBoys(rawBoys);
      setDeliveryBoys(activeBoysArr);
    } catch (err) {
      console.error('Dispatch fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMessageDates = useCallback(async () => {
    try {
      const res = await api.getDeliveryBoyMessageDates();
      if (res && res.success && Array.isArray(res.dates)) {
        setMessageDates(res.dates);
        if (res.dates.length > 0 && !selectedDate) {
          setSelectedDate(res.dates[0]);
        } else if (!selectedDate) {
          setSelectedDate(new Date().toISOString().split('T')[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch message dates:', err);
    }
  }, [selectedDate]);

  const fetchMessagesForDate = useCallback(async (dateStr: string) => {
    if (!dateStr) return;
    setLoadingMessages(true);
    try {
      const res = await api.getDeliveryBoyMessages(dateStr);
      if (res && res.success && Array.isArray(res.messages)) {
        setSentMessages(res.messages);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const fetchDistributorReminders = useCallback(async () => {
    setLoadingDistributorReminders(true);
    try {
      const res = await api.getTodayDistributorReminders();
      if (res && res.success && Array.isArray(res.reminders)) {
        setDistributorReminders(res.reminders);
      }
    } catch (err) {
      console.error('Failed to fetch distributor reminders:', err);
    } finally {
      setLoadingDistributorReminders(false);
    }
  }, []);

  const handleToggleAutoRemind = async (id: number, currentAuto: number) => {
    const nextVal = currentAuto ? false : true;
    try {
      await api.toggleDistributorAutoRemind(id, nextVal);
      setDistributorReminders(prev => prev.map(r => r.id === id ? { ...r, auto_remind: nextVal ? 1 : 0 } : r));
      showNotif(`Auto-reminder ${nextVal ? 'enabled' : 'disabled'}`);
    } catch (err) {
      showNotif('Failed to update auto-reminder setting', 'error');
    }
  };

  const handleUpdateDistributorStatus = async (id: number, status: string, deliveryBoyId?: number | null) => {
    try {
      const res = await api.updateDistributorReminderStatus(id, { status, delivery_boy_id: deliveryBoyId });
      if (res && res.success && res.reminder) {
        setDistributorReminders(prev => prev.map(r => r.id === id ? res.reminder : r));
        showNotif(`Status updated to ${status}`);
      }
    } catch (err) {
      showNotif('Failed to update status', 'error');
    }
  };

  const handleSendReminderNow = async (id: number) => {
    setSendingReminderId(id);
    try {
      await api.sendDistributorReminderNow(id);
      showNotif('WhatsApp reminder sent to distributor!');
      fetchDistributorReminders();
    } catch (err: any) {
      showNotif(err.message || 'Failed to send WhatsApp reminder', 'error');
    } finally {
      setSendingReminderId(null);
    }
  };

  const [showMessageData, setShowMessageData] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowMessageData(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetchAll();
    fetchDistributorReminders();
    const handlePhoneUpdate = () => {
      clearDispatchPageCache();
      fetchAll();
      fetchDistributorReminders();
      fetchMessageDates();
    };
    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    window.addEventListener('settings-updated', handlePhoneUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
      window.removeEventListener('settings-updated', handlePhoneUpdate);
    };
  }, [fetchAll, fetchDistributorReminders, fetchMessageDates]);

  useEffect(() => {
    if (!showMessageData) return;
    fetchMessageDates();
  }, [showMessageData, fetchMessageDates]);

  useEffect(() => {
    if (selectedDate) {
      fetchMessagesForDate(selectedDate);
    }
  }, [selectedDate, fetchMessagesForDate]);

  const handleAddDeliveryBoy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoyName.trim()) { showNotif('Delivery boy name is required', 'error'); return; }
    setAddingBoy(true);
    try {
      await api.addDeliveryBoy({
        name: newBoyName.trim(),
        whatsapp_number: newBoyPhone.trim() || undefined,
        is_active: 1,
      });
      showNotif(`Delivery boy "${newBoyName.trim()}" added successfully!`);
      setNewBoyName('');
      setNewBoyPhone('');
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to add delivery boy', 'error');
    } finally { setAddingBoy(false); }
  };

  const handleSaveBoyEdit = async (id: number) => {
    if (!editBoyName.trim()) { showNotif('Delivery boy name is required', 'error'); return; }
    setSavingBoyEdit(true);
    try {
      await api.updateDeliveryBoy(id, {
        name: editBoyName.trim(),
        whatsapp_number: editBoyPhone.trim() || undefined,
      });
      showNotif(`Delivery boy updated successfully!`);
      setEditingBoyId(null);
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to update delivery boy', 'error');
    } finally { setSavingBoyEdit(false); }
  };

  const handleToggleBoyActive = async (boy: DeliveryBoy) => {
    try {
      const newActive = boy.is_active ? 0 : 1;
      await api.updateDeliveryBoy(boy.id, { is_active: newActive });
      showNotif(`Delivery boy "${boy.name}" ${newActive ? 'activated' : 'deactivated'}`);
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const handleDeleteBoy = async (id: number, name: string) => {
    if (!confirm(`Delete delivery boy "${name}"?`)) return;
    try {
      await api.deleteDeliveryBoy(id);
      showNotif(`Delivery boy "${name}" deleted`);
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to delete delivery boy', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patient_name.trim()) { showNotif('Patient name is required', 'error'); return; }
    setSaving(true);
    try {
      await api.createDispatchOrder({
        ...form,
        delivery_boy_id: form.delivery_boy_id ? Number(form.delivery_boy_id) : null,
      });
      showNotif('Dispatch order created!');
      setShowModal(false);
      setForm(emptyForm);
      fetchAll();
    } catch { showNotif('Failed to create dispatch order', 'error'); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await api.updateDispatchOrder(id, { status });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: status as any } : o));
      showNotif(`Status updated to "${status}"`);
    } catch { showNotif('Failed to update status', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this dispatch order?')) return;
    try {
      await api.deleteDispatchOrder(id);
      setOrders(prev => prev.filter(o => o.id !== id));
      showNotif('Dispatch order deleted');
    } catch { showNotif('Failed to delete', 'error'); }
  };

  const handleSendAllViaWhatsApp = async () => {
    const activeOrders = orders.filter(o => o.status === 'Pending' || o.status === 'In Transit');
    if (activeOrders.length === 0) {
      showNotif('No active dispatch orders to send', 'error');
      return;
    }

    const targetBoy = deliveryBoys.find(b => b.whatsapp_number) || allBoys.find(b => b.whatsapp_number);
    let targetPhone = targetBoy?.whatsapp_number;
    
    if (!targetPhone) {
      const input = prompt('Enter Delivery Boy WhatsApp Phone Number (e.g. 919876543210):');
      if (!input) return;
      targetPhone = input.trim();
    }

    try {
      const orderIds = activeOrders.map(o => o.id);
      const res = await api.enqueueDistributorCollection({
        orderIds,
        deliveryBoyPhone: targetPhone,
        deliveryBoyName: targetBoy?.name
      });
      showNotif(res.message || `Enqueued ${orderIds.length} collection messages for 8s-12s paced sending!`, 'success');
      whatsappQueueEvent.triggerOpen();
      whatsappQueueEvent.triggerUpdated();
      setTimeout(() => fetchMessageDates(), 2000);
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to enqueue WhatsApp messages', 'error');
    }
  };

  // Metrics
  const pendingCount = orders.filter(o => o.status === 'Pending').length;
  const inTransitCount = orders.filter(o => o.status === 'In Transit').length;
  const deliveredTodayCount = orders.filter(o => {
    if (o.status !== 'Delivered' || !o.delivered_at) return false;
    return new Date(o.delivered_at).toDateString() === new Date().toDateString();
  }).length;

  const uncollectedDistributorsCount = distributorReminders.filter(r => r.status !== 'Collected').length;

  // Filtered Queue Orders
  const filteredOrders = orders.filter(order => {
    const matchesSearch =
      order.patient_name.toLowerCase().includes(queueSearch.toLowerCase()) ||
      (order.patient_phone && order.patient_phone.includes(queueSearch)) ||
      (order.invoice_no && order.invoice_no.toLowerCase().includes(queueSearch.toLowerCase())) ||
      (order.delivery_boy_name && order.delivery_boy_name.toLowerCase().includes(queueSearch.toLowerCase()));
    
    const matchesStatus = statusFilter === 'ALL' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-full flex-1 flex flex-col gap-5 pb-8 text-left animate-in fade-in duration-300">
      {/* ── TOP HERO HEADER & CONTROLS ── */}
      <div className="glass-panel p-5 rounded-2xl bg-bg2/40 border border-glass-border shadow-xl backdrop-blur-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-bold border border-primary/30 shadow-inner">
                <Truck size={18} />
              </div>
              <h2 className="text-2xl font-black tracking-tight text-text">Dispatch & Delivery Command Center</h2>
            </div>
            <p className="text-muted text-xs font-medium">
              Real-time home delivery dispatching, daily distributor WhatsApp status reminders, and staff tracking.
            </p>
          </div>

          {/* Action Hub */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { fetchAll(); fetchDistributorReminders(); fetchMessageDates(); }}
              className="p-2.5 rounded-xl bg-bg3/60 hover:bg-bg3 border border-glass-border text-muted hover:text-text transition-all shadow-sm"
              title="Refresh All Data"
            >
              <RefreshCw size={15} className={loading || loadingDistributorReminders ? 'animate-spin text-primary' : ''} />
            </button>

            <button
              onClick={handleSendAllViaWhatsApp}
              className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-bold transition-all shadow-sm active:scale-95"
              title="Send all active collection orders via WhatsApp with 8s-12s pacing"
            >
              <Send size={14} className="text-emerald-400" /> Send All via WhatsApp
            </button>

            <button
              onClick={() => setShowBoysModal(true)}
              className="bg-sky/15 border border-sky/30 text-sky hover:bg-sky/25 text-xs flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-bold transition-all shadow-sm active:scale-95"
            >
              <User size={14} /> Manage Staff ({allBoys.length})
            </button>

            <button
              onClick={() => setShowModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-4 py-2.5 rounded-xl font-bold flex items-center gap-1.5 shadow-[0_4px_16px_rgba(59,130,246,0.3)] transition-all active:scale-95"
            >
              <Plus size={16} /> New Dispatch Order
            </button>
          </div>
        </div>

        {/* Dynamic Metric KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-3 mt-5 pt-4 border-t border-glass-border/40">
          {/* Pending */}
          <div
            onClick={() => { setActiveTab('queue'); setStatusFilter('Pending'); }}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'queue' && statusFilter === 'Pending'
                ? 'bg-amber-500/15 border-amber-500/40 shadow-md scale-[1.02]'
                : 'bg-bg/40 border-glass-border hover:bg-bg3/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                <Clock size={12} className="text-amber-400" /> Pending Orders
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-amber-400">{pendingCount}</span>
              <span className="text-[10px] text-muted font-medium">awaiting pickup</span>
            </div>
          </div>

          {/* In Transit */}
          <div
            onClick={() => { setActiveTab('queue'); setStatusFilter('In Transit'); }}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'queue' && statusFilter === 'In Transit'
                ? 'bg-sky/15 border-sky/40 shadow-md scale-[1.02]'
                : 'bg-bg/40 border-glass-border hover:bg-bg3/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                <Truck size={12} className="text-sky" /> In Transit
              </span>
              <span className="w-2 h-2 rounded-full bg-sky" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-sky">{inTransitCount}</span>
              <span className="text-[10px] text-muted font-medium">on delivery route</span>
            </div>
          </div>

          {/* Delivered Today */}
          <div
            onClick={() => { setActiveTab('queue'); setStatusFilter('Delivered'); }}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'queue' && statusFilter === 'Delivered'
                ? 'bg-emerald-500/15 border-emerald-500/40 shadow-md scale-[1.02]'
                : 'bg-bg/40 border-glass-border hover:bg-bg3/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                <CheckCircle size={12} className="text-emerald-400" /> Delivered Today
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-emerald-400">{deliveredTodayCount}</span>
              <span className="text-[10px] text-muted font-medium">completed today</span>
            </div>
          </div>

          {/* Active Staff */}
          <div
            onClick={() => setActiveTab('staff')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'staff'
                ? 'bg-purple-500/15 border-purple-500/40 shadow-md scale-[1.02]'
                : 'bg-bg/40 border-glass-border hover:bg-bg3/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                <User size={12} className="text-purple-400" /> Active Staff
              </span>
              <span className="w-2 h-2 rounded-full bg-purple-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-purple-400">{deliveryBoys.length}</span>
              <span className="text-[10px] text-muted font-medium">active personnel</span>
            </div>
          </div>

          {/* Distributor Reminders */}
          <div
            onClick={() => setActiveTab('reminders')}
            className={`p-3 rounded-xl border transition-all cursor-pointer ${
              activeTab === 'reminders'
                ? 'bg-rose-500/15 border-rose-500/40 shadow-md scale-[1.02]'
                : 'bg-bg/40 border-glass-border hover:bg-bg3/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
                <Bell size={12} className="text-rose-400" /> Uncollected Orders
              </span>
              <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-black text-rose-400">{uncollectedDistributorsCount}</span>
              <span className="text-[10px] text-muted font-medium">distributors pending</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── NAVIGATION TABS SWITCHER ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-bg2/40 p-1.5 rounded-2xl border border-glass-border backdrop-blur-md">
        <div className="flex items-center gap-1.5 overflow-x-auto p-0.5">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'queue'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'text-muted hover:text-text hover:bg-bg3/50'
            }`}
          >
            <Package size={14} /> Active Dispatch Queue
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-black ${activeTab === 'queue' ? 'bg-black/20 text-white' : 'bg-bg3 text-muted'}`}>
              {orders.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('reminders')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'reminders'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-muted hover:text-text hover:bg-bg3/50'
            }`}
          >
            <Bell size={14} /> Distributor Dispatch Reminders
            {uncollectedDistributorsCount > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-black ${activeTab === 'reminders' ? 'bg-black/30 text-white' : 'bg-amber-500/20 text-amber-400'}`}>
                {uncollectedDistributorsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('staff')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'staff'
                ? 'bg-sky text-black shadow-md'
                : 'text-muted hover:text-text hover:bg-bg3/50'
            }`}
          >
            <User size={14} /> Delivery Staff Directory
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-black ${activeTab === 'staff' ? 'bg-black/20 text-white' : 'bg-bg3 text-muted'}`}>
              {allBoys.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'logs'
                ? 'bg-emerald-500 text-black shadow-md'
                : 'text-muted hover:text-text hover:bg-bg3/50'
            }`}
          >
            <Send size={14} /> WhatsApp Message Logs
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-purple-500 text-white shadow-md'
                : 'text-muted hover:text-text hover:bg-bg3/50'
            }`}
          >
            <Layers size={14} /> All In One View
          </button>
        </div>
      </div>

      {/* ── TAB CONTENT 1: ACTIVE DISPATCH QUEUE ── */}
      {(activeTab === 'queue' || activeTab === 'all') && (
        <div className="glass-panel rounded-2xl overflow-hidden bg-bg2/30 border border-glass-border shadow-xl flex flex-col">
          {/* Section Bar */}
          <div className="p-4 bg-bg3/30 border-b border-glass-border flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-primary" />
              <h3 className="font-extrabold text-xs uppercase tracking-wider text-text">Active Home Delivery Dispatch Queue</h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-bg text-muted border border-glass-border">
                {filteredOrders.length} Orders Shown
              </span>
            </div>

            {/* Queue Search & Status Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search patient, phone, invoice..."
                  value={queueSearch}
                  onChange={e => setQueueSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-bg text-text border border-glass-border text-xs focus:outline-none focus:border-primary/50 font-medium"
                />
              </div>

              <div className="flex items-center gap-1 bg-bg p-0.5 rounded-xl border border-glass-border text-xs">
                <Filter size={11} className="ml-2 text-muted" />
                {(['ALL', 'Pending', 'In Transit', 'Delivered'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      statusFilter === st
                        ? 'bg-bg2 text-text shadow-sm border border-glass-border'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="overflow-x-auto bg-bg/20">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-bg2/90 sticky top-0 backdrop-blur z-10">
                <tr>
                  {['Patient Name', 'Phone', 'Medicines / Items', 'Delivery Address', 'Assigned Staff', 'Invoice', 'Status', 'Actions'].map(h => (
                    <th key={h} className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-muted">
                      <RefreshCw size={22} className="animate-spin mx-auto mb-2 text-primary/60" />
                      Loading active dispatch queue...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-14 text-center text-muted">
                      <Truck size={36} className="mx-auto mb-3 opacity-20 text-primary" />
                      <p className="font-bold text-text mb-1">No dispatch orders found</p>
                      <p className="text-xs text-muted max-w-sm mx-auto">
                        {queueSearch || statusFilter !== 'ALL'
                          ? 'Try clearing your search or status filters.'
                          : 'Click "+ New Dispatch Order" above to assign a home delivery.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map(order => (
                    <tr key={order.id} className="hover:bg-bg3/40 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
                            {order.patient_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-text">{order.patient_name}</span>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-muted text-xs">{order.patient_phone || '-'}</td>
                      <td className="p-3 text-muted max-w-[160px] truncate">{order.items || '-'}</td>
                      <td className="p-3 text-muted max-w-[150px] truncate">
                        {order.address ? (
                          <div className="flex items-center gap-1">
                            <MapPin size={11} className="text-muted shrink-0" />
                            <span className="truncate">{order.address}</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <User size={12} className="text-muted" />
                          <span className={order.delivery_boy_name ? 'text-sky font-bold' : 'text-muted italic text-[11px]'}>
                            {order.delivery_boy_name || 'Unassigned'}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-muted text-xs">{order.invoice_no || '-'}</td>
                      <td className="p-3">
                        <select
                          value={order.status}
                          onChange={e => handleStatusChange(order.id, e.target.value)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer bg-bg focus:outline-none transition-all ${statusStyles[order.status]}`}
                        >
                          <option value="Pending">⏳ Pending</option>
                          <option value="In Transit">🚚 In Transit</option>
                          <option value="Delivered">✅ Delivered</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => handleDelete(order.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 transition-colors"
                          title="Delete Dispatch Order"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB CONTENT 2: DISTRIBUTOR DISPATCH REMINDERS ── */}
      {(activeTab === 'reminders' || activeTab === 'all') && (
        <div className="glass-panel p-5 space-y-4 bg-bg2/30 border border-glass-border rounded-2xl shadow-xl">
          <div className="flex flex-wrap justify-between items-center gap-3 border-b border-glass-border pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold border border-amber-500/30">
                <Bell size={16} />
              </div>
              <div>
                <h3 className="font-extrabold text-xs uppercase tracking-wider text-text">Today's Distributor Dispatch & Collection Reminders</h3>
                <p className="text-[11px] text-muted">Auto-detects suppliers ordered from today & asks if dispatch/collection is complete.</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold flex items-center gap-1">
                <Clock size={11} /> Auto-Send Window: 12:30 PM – 1:00 PM IST
              </span>

              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Filter distributors..."
                  value={distributorSearch}
                  onChange={e => setDistributorSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-bg text-text border border-glass-border text-xs focus:outline-none focus:border-primary/50"
                />
              </div>

              <button
                onClick={fetchDistributorReminders}
                className="p-2 rounded-xl bg-bg3/50 hover:bg-bg3 text-muted hover:text-text transition-colors border border-glass-border"
                title="Refresh Distributor Reminders"
              >
                <RefreshCw size={14} className={loadingDistributorReminders ? 'animate-spin text-amber-400' : ''} />
              </button>
            </div>
          </div>

          {/* Table of Today's Distributors */}
          <div className="overflow-x-auto bg-bg/20 rounded-xl border border-glass-border">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-bg2/90">
                <tr>
                  {['Distributor Name', 'Contact Phone', 'Assigned Delivery Staff', 'Dispatch / Collection Status', 'Auto-Reminder', 'Last Reminded', 'Action'].map(h => (
                    <th key={h} className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {loadingDistributorReminders ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted">
                      <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-amber-400" />
                      Checking today's active distributor orders...
                    </td>
                  </tr>
                ) : distributorReminders.filter(r => r.distributor_name.toLowerCase().includes(distributorSearch.toLowerCase())).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted">
                      <Bell size={28} className="mx-auto mb-2 opacity-30 text-amber-400" />
                      <p className="font-bold text-text">No active distributor orders for today</p>
                      <p className="text-xs text-muted">When shortage or purchase orders are placed today, their distributors will auto-appear here.</p>
                    </td>
                  </tr>
                ) : (
                  distributorReminders
                    .filter(r => r.distributor_name.toLowerCase().includes(distributorSearch.toLowerCase()))
                    .map(item => (
                      <tr key={item.id} className="hover:bg-bg3/30 transition-colors">
                        <td className="p-3 font-bold text-text">{item.distributor_name}</td>
                        <td className="p-3 font-mono text-muted">{item.distributor_phone || 'No phone set'}</td>
                        <td className="p-3">
                          <select
                            value={item.delivery_boy_id || ''}
                            onChange={e => handleUpdateDistributorStatus(item.id, item.status, e.target.value ? Number(e.target.value) : null)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-bg text-text border border-glass-border focus:outline-none font-medium"
                          >
                            <option value="">👤 Unassigned / Admin Fallback</option>
                            {deliveryBoys.map(b => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <select
                            value={item.status}
                            onChange={e => handleUpdateDistributorStatus(item.id, e.target.value, item.delivery_boy_id)}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer bg-bg transition-all ${
                              item.status === 'Collected'
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : item.status === 'Dispatched'
                                ? 'bg-sky/20 text-sky border-sky/30'
                                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                            }`}
                          >
                            <option value="Pending">⏳ Pending Handover</option>
                            <option value="Dispatched">📦 Dispatched by Warehouse</option>
                            <option value="Collected">✅ Collected by Staff</option>
                          </select>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => handleToggleAutoRemind(item.id, item.auto_remind)}
                            className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                              item.auto_remind
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-bg3 text-muted border-glass-border'
                            }`}
                          >
                            {item.auto_remind ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} className="text-muted" />}
                            {item.auto_remind ? 'ON' : 'OFF'}
                          </button>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted">
                          {item.last_reminded_at
                            ? new Date(item.last_reminded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Not sent today'}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => handleSendReminderNow(item.id)}
                            disabled={sendingReminderId === item.id}
                            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 disabled:opacity-50 transition-all active:scale-95"
                          >
                            {sendingReminderId === item.id ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <MessageSquare size={12} />
                            )}
                            Send Reminder Now
                          </button>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB CONTENT 3: DELIVERY STAFF DIRECTORY ── */}
      {(activeTab === 'staff' || activeTab === 'all') && (
        <div className="glass-panel p-5 space-y-4 bg-bg2/30 border border-glass-border rounded-2xl shadow-xl">
          <div className="flex justify-between items-center flex-wrap gap-2 border-b border-glass-border pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold border border-purple-500/30">
                <User size={16} />
              </div>
              <div>
                <h3 className="font-extrabold text-xs uppercase tracking-wider text-text">Delivery Personnel Directory</h3>
                <p className="text-[11px] text-muted">Manage active store staff, assigned WhatsApp contact numbers, and status.</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30">
              {allBoys.length} Total Registered
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Quick Add Staff Form */}
            <form onSubmit={handleAddDeliveryBoy} className="p-4 rounded-xl border border-dashed border-glass-border bg-bg/40 flex flex-col justify-between gap-3">
              <span className="text-xs font-extrabold text-primary flex items-center gap-1.5">
                <Plus size={14} /> Add New Delivery Staff
              </span>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Full Name (e.g. Ramesh)"
                  value={newBoyName}
                  onChange={e => setNewBoyName(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-bg2 border border-glass-border text-text focus:outline-none focus:border-primary font-medium"
                />
                <input
                  type="text"
                  placeholder="WhatsApp Phone (10 digits)"
                  value={newBoyPhone}
                  onChange={e => setNewBoyPhone(sanitizePhoneInput(e.target.value))}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-bg2 border border-glass-border text-text focus:outline-none focus:border-primary font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={addingBoy || !newBoyName.trim()}
                className="w-full text-xs py-2 font-bold rounded-xl bg-sky hover:bg-sky-400 text-black transition-all disabled:opacity-40 shadow-sm"
              >
                {addingBoy ? 'Adding Staff...' : 'Save Staff Member'}
              </button>
            </form>

            {/* Staff Cards List */}
            {allBoys.map(boy => {
              const isEditing = editingBoyId === boy.id;
              const cleanPhone = (boy.whatsapp_number || '').replace(/\D/g, '');
              const formattedPhone = cleanPhone
                ? cleanPhone.length === 10
                  ? `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`
                  : `+${cleanPhone}`
                : 'No phone set';

              return (
                <div
                  key={boy.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition-all ${
                    boy.is_active ? 'bg-bg2/50 border-glass-border shadow-sm' : 'bg-bg/20 border-glass-border/30 opacity-60'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editBoyName}
                        onChange={e => setEditBoyName(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-bg border border-glass-border text-text font-bold"
                      />
                      <input
                        type="text"
                        value={editBoyPhone}
                        onChange={e => setEditBoyPhone(sanitizePhoneInput(e.target.value))}
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-bg border border-glass-border text-text font-mono"
                      />
                      <div className="flex justify-end gap-1.5 pt-1">
                        <button onClick={() => setEditingBoyId(null)} className="px-2.5 py-1 text-[10px] text-muted hover:text-text">
                          Cancel
                        </button>
                        <button onClick={() => handleSaveBoyEdit(boy.id)} className="px-3 py-1 text-[10px] bg-emerald-500 text-black font-bold rounded-lg">
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            boy.is_active ? 'bg-sky/20 text-sky border border-sky/30' : 'bg-zinc-800 text-muted'
                          }`}>
                            {boy.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-black text-text">{boy.name}</p>
                            <p className="text-[11px] font-mono text-muted">{formattedPhone}</p>
                          </div>
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer shrink-0" title={boy.is_active ? 'Deactivate' : 'Activate'}>
                          <input
                            type="checkbox"
                            checked={boy.is_active === 1}
                            onChange={() => handleToggleBoyActive(boy)}
                            className="sr-only peer"
                          />
                          <div className="w-7 h-4 rounded-full bg-zinc-700 peer-checked:bg-emerald-500 transition-colors" />
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-3" />
                        </label>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-glass-border/30 text-[10px]">
                        {cleanPhone ? (
                          <a
                            href={`https://api.whatsapp.com/send?phone=${cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:underline font-bold flex items-center gap-1"
                          >
                            <Send size={10} /> WhatsApp Chat
                          </a>
                        ) : (
                          <span className="text-muted italic">No phone set</span>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingBoyId(boy.id); setEditBoyName(boy.name); setEditBoyPhone(boy.whatsapp_number || ''); }}
                            className="text-muted hover:text-sky font-bold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteBoy(boy.id, boy.name)}
                            className="text-muted hover:text-rose-400 font-bold"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB CONTENT 4: WHATSAPP MESSAGE HISTORY LOGS ── */}
      {(activeTab === 'logs' || activeTab === 'all') && (
        <div className="glass-panel p-5 space-y-4 bg-bg2/30 border border-glass-border rounded-2xl shadow-xl">
          <div className="flex justify-between items-center flex-wrap gap-2 border-b border-glass-border pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/30">
                <Send size={16} />
              </div>
              <div>
                <h3 className="font-extrabold text-xs uppercase tracking-wider text-text">WhatsApp Message History Logs</h3>
                <p className="text-[11px] text-muted">Complete trace of all automated collection and dispatch messages sent to staff & distributors.</p>
              </div>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">
                <Calendar size={11} /> Select Date:
              </span>
              {messageDates.length > 0 ? (
                <select
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-bg border border-glass-border text-text cursor-pointer focus:outline-none"
                >
                  {messageDates.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  value={toDateInputValue(selectedDate)}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-bg border border-glass-border text-text"
                />
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-glass-border bg-bg/20">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-bg2/90">
                <tr>
                  <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[90px]">Time</th>
                  <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[130px]">Recipient</th>
                  <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[110px]">Phone Number</th>
                  <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[90px]">Status</th>
                  <th className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider">Exact WhatsApp Message Body</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {loadingMessages ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-muted">
                      <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-emerald-400" />
                      Loading message history...
                    </td>
                  </tr>
                ) : sentMessages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-muted italic">
                      No WhatsApp messages recorded for {selectedDate || 'this date'}.
                    </td>
                  </tr>
                ) : (
                  sentMessages.map(msg => {
                    const timeStr = msg.created_at
                      ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '--:--';
                    const rawPhone = (msg.recipient_phone || '').replace(/\D/g, '');
                    const formattedPhone = rawPhone.length === 10 ? `+91 ${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}` : (rawPhone ? `+${rawPhone}` : 'N/A');

                    return (
                      <tr key={msg.id} className="hover:bg-bg3/30 transition-colors">
                        <td className="p-3 font-mono text-muted text-[11px] whitespace-nowrap">{timeStr}</td>
                        <td className="p-3 font-bold text-sky text-xs whitespace-nowrap">
                          {msg.recipient_name || 'Recipient'}
                        </td>
                        <td className="p-3 font-mono text-muted text-xs whitespace-nowrap">{formattedPhone}</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                            msg.status === 'sent' || msg.status === 'sent_manually'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : msg.status === 'failed'
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}>
                            {msg.status}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="p-2.5 rounded-xl bg-bg2/70 border border-glass-border/40 text-[11px] text-text font-sans whitespace-pre-wrap max-h-28 overflow-y-auto leading-relaxed">
                            {msg.message}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE NEW DISPATCH ORDER ── */}
      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-modal flex items-center justify-center p-4">
          <div className="glass-panel p-6 w-full max-w-lg space-y-4 rounded-2xl border border-glass-border shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-glass-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-sm text-text">
                <Truck size={18} className="text-primary" /> Create Home Delivery Order
              </h3>
              <button onClick={() => { setShowModal(false); setForm(emptyForm); }} className="text-muted hover:text-text transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Patient Name *</label>
                  <input
                    className="premium-input w-full text-xs"
                    placeholder="Full Name"
                    value={form.patient_name}
                    onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Phone</label>
                  <input
                    className="premium-input w-full text-xs font-mono"
                    placeholder="9876543210"
                    value={form.patient_phone}
                    onChange={e => setForm(f => ({ ...f, patient_phone: sanitizePhoneInput(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Delivery Address</label>
                <input
                  className="premium-input w-full text-xs"
                  placeholder="Full street address"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Medicines / Items</label>
                <input
                  className="premium-input w-full text-xs"
                  placeholder="e.g. Paracetamol x2, Amoxicillin x1"
                  value={form.items}
                  onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Invoice No</label>
                  <input
                    className="premium-input w-full text-xs font-mono"
                    placeholder="INV-..."
                    value={form.invoice_no}
                    onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Assign Delivery Staff</label>
                  <select
                    className="premium-input w-full text-xs font-medium"
                    value={form.delivery_boy_id}
                    onChange={e => setForm(f => ({ ...f, delivery_boy_id: e.target.value }))}
                  >
                    <option value="">-- Unassigned --</option>
                    {deliveryBoys.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Notes</label>
                <input
                  className="premium-input w-full text-xs"
                  placeholder="Special instructions..."
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs py-2.5 rounded-xl flex-1 shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {saving ? 'Creating Order...' : 'Create Dispatch Order'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(emptyForm); }}
                  className="px-4 py-2.5 bg-bg3/60 border border-glass-border text-muted hover:text-text font-bold text-xs rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── MODAL: MANAGE STAFF PERSONNEL ── */}
      {showBoysModal && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-modal flex items-center justify-center p-4 overflow-y-auto">
          <div className="glass-panel p-6 w-full max-w-lg space-y-4 max-h-[90vh] flex flex-col rounded-2xl border border-sky-500/30 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between shrink-0 border-b border-glass-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-sm text-text">
                <User size={18} className="text-sky" /> Delivery Personnel Management
              </h3>
              <button onClick={() => setShowBoysModal(false)} className="text-muted hover:text-text transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Quick Add Form inside modal */}
            <form onSubmit={handleAddDeliveryBoy} className="p-3.5 bg-bg2/80 rounded-xl border border-glass-border space-y-2 shrink-0">
              <p className="text-xs font-bold text-sky uppercase tracking-wider">Add New Staff Member</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Staff Name *"
                  className="premium-input w-full text-xs"
                  value={newBoyName}
                  onChange={e => setNewBoyName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="WhatsApp Phone (10 digits)"
                  className="premium-input w-full text-xs font-mono"
                  value={newBoyPhone}
                  onChange={e => setNewBoyPhone(sanitizePhoneInput(e.target.value))}
                />
              </div>
              <button
                type="submit"
                disabled={addingBoy}
                className="w-full bg-sky hover:bg-sky-400 text-black text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              >
                <Plus size={14} /> {addingBoy ? 'Saving...' : 'Add Delivery Staff'}
              </button>
            </form>

            {/* Personnel List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <p className="text-xs font-bold text-muted uppercase tracking-wider">All Personnel ({allBoys.length})</p>
              {allBoys.length === 0 ? (
                <div className="p-6 text-center text-muted text-xs border border-dashed border-glass-border rounded-xl">
                  No personnel registered yet.
                </div>
              ) : (
                allBoys.map(boy => (
                  <div key={boy.id} className="p-3 rounded-xl bg-bg border border-glass-border hover:border-sky/40 transition-all">
                    {editingBoyId === boy.id ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={editBoyName}
                            onChange={e => setEditBoyName(e.target.value)}
                            className="premium-input w-full text-xs font-bold"
                          />
                          <input
                            type="text"
                            value={editBoyPhone}
                            onChange={e => setEditBoyPhone(sanitizePhoneInput(e.target.value))}
                            className="premium-input w-full text-xs font-mono"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveBoyEdit(boy.id)}
                            disabled={savingBoyEdit}
                            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-xs rounded-lg transition-all"
                          >
                            Save Phone
                          </button>
                          <button
                            onClick={() => setEditingBoyId(null)}
                            className="px-3 py-1 bg-bg3 border border-glass-border text-muted hover:text-text text-xs rounded-lg transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-text">{boy.name}</span>
                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                              boy.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}>
                              {boy.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-muted">
                            📞 {boy.whatsapp_number || 'No phone set'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditingBoyId(boy.id);
                              setEditBoyName(boy.name);
                              setEditBoyPhone(boy.whatsapp_number || '');
                            }}
                            className="p-1.5 rounded-lg hover:bg-sky/20 text-sky border border-transparent hover:border-sky/30 transition-all"
                            title="Edit Phone / Details"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleToggleBoyActive(boy)}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                              boy.is_active
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                            }`}
                          >
                            {boy.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => handleDeleteBoy(boy.id, boy.name)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 border border-transparent hover:border-rose-500/30 transition-all"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 shrink-0 border-t border-glass-border flex justify-end">
              <button
                type="button"
                onClick={() => setShowBoysModal(false)}
                className="px-4 py-2 bg-bg3/60 border border-glass-border text-xs text-muted hover:text-text font-bold rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Dispatch;
