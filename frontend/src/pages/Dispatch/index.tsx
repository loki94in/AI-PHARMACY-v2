import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import {
  Truck,
  Package,
  Clock,
  CheckCircle,
  Check,
  XCircle,
  MapPin,
  Plus,
  X,
  User,
  Trash2,
  RefreshCw,
  Send,
  Edit2,
  Edit3,
  Bell,
  MessageSquare,
  Search,
  Layers,
  Filter,
  Calendar,
  PhoneCall,
  Zap,
  ShoppingCart,
  } from 'lucide-react';
import { api, apiClient, type DistributorDispatchReminder } from '../../services/api';
import { whatsappQueueEvent, toastEvent, messageSendEvent } from '../../services/events';
import {
  getDispatchDeliveryBoysCache,
  getDispatchOrdersCache,
  setDispatchDeliveryBoysCache,
  setDispatchOrdersCache,
  clearDispatchPageCache,
  type CachedDeliveryBoy,
} from '../../utils/pageModuleCaches';
import { broadcastContactDataChanged } from '../../utils/settingsSync';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
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

interface LocalWhatsAppSentMessage {
  id: number;
  created_at?: string;
  recipient_phone?: string;
  recipient_name?: string;
  status?: string;
  message?: string;
}

interface LocalDistributorOrderEntry {
  id?: number;
  order_time?: string;
  items_count?: number;
  items_preview?: string[];
}

type LocalReminderRow = Omit<DistributorDispatchReminder, 'status'> & {
  status: string;
  orders_list?: LocalDistributorOrderEntry[];
  order_count?: number;
  latest_notif_status?: string;
  latest_notif_error?: string | null;
};

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

type TabType = 'all' | 'queue' | 'reminders' | 'staff' | 'logs';

const Dispatch = () => {
  const cachedOrders = getDispatchOrdersCache() as DispatchOrder[] | null;
  const cachedDeliveryBoys = getDispatchDeliveryBoysCache() as DeliveryBoy[] | null;

  const [activeTab, setActiveTab] = useState<TabType>('reminders');
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
  const [sentMessages, setSentMessages] = useState<LocalWhatsAppSentMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Distributor Dispatch Reminders state
  const [distributorReminders, setDistributorReminders] = useState<LocalReminderRow[]>([]);
  const [autoDispatchEnabled, setAutoDispatchEnabled] = useState(true);
  const [distributorSearch, setDistributorSearch] = useState('');
  const [distributorTodayOnly, setDistributorTodayOnly] = useState<boolean>(true);
  const [sendingReminderId, setSendingReminderId] = useState<number | null>(null);
  const [loadingDistributorReminders, setLoadingDistributorReminders] = useState(false);
  const [expandedPreviewId, setExpandedPreviewId] = useState<number | null>(null);
  const [expandedOrderDetailsId, setExpandedOrderDetailsId] = useState<number | null>(null);
  const [customMessages, setCustomMessages] = useState<Record<number, string>>({});
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [globalTemplate, setGlobalTemplate] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [windowSchedule, setWindowSchedule] = useState({ start: '12:30', end: '13:00' });
  const [afternoonSchedule, setAfternoonSchedule] = useState({ enabled: true, time: '14:00' });
  const [isSendingAfternoonDispatch, setIsSendingAfternoonDispatch] = useState(false);
  const [nowTime, setNowTime] = useState<Date>(new Date());

  // Manual Phone Call Order states
  const [showManualOrderModal, setShowManualOrderModal] = useState(false);
  const [manualDistributorName, setManualDistributorName] = useState('');
  const [manualDistributorPhone, setManualDistributorPhone] = useState('');
  const [manualDeliveryBoyId, setManualDeliveryBoyId] = useState<number | null>(null);
  const [savingManualOrder, setSavingManualOrder] = useState(false);

  const handleCreateManualOrder = async () => {
    if (!manualDistributorName.trim()) {
      showNotif('Please enter distributor name', 'error');
      return;
    }
    setSavingManualOrder(true);
    try {
      const res = await api.createManualDistributorOrderReminder({
        distributor_name: manualDistributorName.trim(),
        distributor_phone: manualDistributorPhone.trim(),
        delivery_boy_id: manualDeliveryBoyId || undefined
      });
      if (res && res.success) {
        showNotif('Manual phone call order reminder added!');
        setShowManualOrderModal(false);
        setManualDistributorName('');
        setManualDistributorPhone('');
        setManualDeliveryBoyId(null);
        fetchDistributorReminders();
      }
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.message || 'Failed to add manual phone call order', 'error');
    } finally {
      setSavingManualOrder(false);
    }
  };

  // 1-second interval live clock for auto-reminder countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getWindowCountdownInfo = (now: Date, startStr = '12:30', endStr = '13:00') => {
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    const startTime = new Date(now);
    startTime.setHours(startH, startM, 0, 0);

    const endTime = new Date(now);
    endTime.setHours(endH, endM, 0, 0);

    if (now < startTime) {
      const diffMs = startTime.getTime() - now.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);
      const formatted = hours > 0
        ? `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`
        : `${mins}m ${String(secs).padStart(2, '0')}s`;
      return { status: 'BEFORE' as const, countdownText: formatted, label: `Auto-send window starts in ${formatted}`, progressPct: 0 };
    } else if (now >= startTime && now <= endTime) {
      const diffMs = endTime.getTime() - now.getTime();
      const mins = Math.floor(diffMs / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);
      const formatted = `${mins}m ${String(secs).padStart(2, '0')}s`;
      const totalMs = endTime.getTime() - startTime.getTime();
      const elapsedMs = now.getTime() - startTime.getTime();
      const progressPct = totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0;
      return { status: 'ACTIVE' as const, countdownText: formatted, label: `Active Window — ${formatted} remaining`, progressPct };
    } else {
      return { status: 'CLOSED' as const, countdownText: 'Window Closed', label: `Today's window closed at 1:00 PM`, progressPct: 100 };
    }
  };

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
        setSelectedDate(prev => {
          if (prev) return prev;
          return res.dates.length > 0 ? res.dates[0] : new Date().toISOString().split('T')[0];
        });
      }
    } catch (err) {
      console.error('Failed to fetch message dates:', err);
    }
  }, []);

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

  // Recent Fallback State
  const [, setIsRecentFallback] = useState(false);
  const [, setRecentDate] = useState<string | null>(null);

  const fetchDistributorReminders = useCallback(async (silent = false) => {
    if (!silent) setLoadingDistributorReminders(true);
    try {
      const res = await api.getTodayDistributorReminders();
      if (res && res.success && Array.isArray(res.reminders)) {
        setDistributorReminders(res.reminders);
        setIsRecentFallback(!!res.is_recent_fallback);
        setRecentDate(res.recent_date || null);
        if (res.auto_dispatch_enabled !== undefined) {
          setAutoDispatchEnabled(res.auto_dispatch_enabled);
        }
        if (res.window_start && res.window_end) {
          setWindowSchedule({ start: res.window_start, end: res.window_end });
        }
        if (res.afternoon_time !== undefined) {
          setAfternoonSchedule({
            enabled: res.afternoon_enabled !== false,
            time: res.afternoon_time || '14:00'
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch distributor reminders:', err);
    } finally {
      if (!silent) setLoadingDistributorReminders(false);
    }
  }, []);

  const handleSendAfternoonDeliveryBoyDispatch = async () => {
    setIsSendingAfternoonDispatch(true);
    try {
      messageSendEvent.triggerSendProgress('Delivery Staff Dispatch', 'Compiling afternoon collection summary...', 10);
      whatsappQueueEvent.triggerOpen();
      whatsappQueueEvent.triggerUpdated();
      const res = await api.sendAfternoonDeliveryBoyDispatch();
      if (res && res.success) {
        showNotif(res.message || 'Afternoon dispatch summary sent to Delivery Staff via WhatsApp!');
        fetchDistributorReminders(true);
      } else {
        showNotif(res?.message || 'Failed to send afternoon dispatch', 'error');
      }
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.response?.data?.error || e.message || 'Failed to send afternoon dispatch', 'error');
    } finally {
      setIsSendingAfternoonDispatch(false);
    }
  };

  const handleUpdateDistributorStatus = async (id: number, status: string, deliveryBoyId?: number | null, itemMeta?: LocalReminderRow) => {
    try {
      const targetItem = itemMeta || distributorReminders.find(r => r.id === id);
      const res = await api.updateDistributorReminderStatus(id, {
        status,
        delivery_boy_id: deliveryBoyId,
        distributor_name: targetItem?.distributor_name,
        distributor_phone: targetItem?.distributor_phone
      });
      if (res && res.success && res.reminder) {
        setDistributorReminders(prev => prev.map(r => (r.id === id || (targetItem && r.distributor_name === targetItem.distributor_name)) ? res.reminder : r));
        showNotif(`Status updated to ${status}`);
      }
    } catch (_err) {
      showNotif('Failed to update status', 'error');
    }
  };

  const handleSendReminderNow = async (id: number, customMessageOverride?: string) => {
    setSendingReminderId(id);
    try {
      const targetItem = distributorReminders.find(r => r.id === id);
      const distName = targetItem?.distributor_name || 'Distributor';
      const msgToSend = customMessageOverride !== undefined ? customMessageOverride : customMessages[id];

      let targetId = id;
      if (id >= 800000 && targetItem) {
        const createRes = await api.createManualDistributorOrderReminder({
          distributor_name: targetItem.distributor_name,
          distributor_phone: targetItem.distributor_phone,
          delivery_boy_id: targetItem.delivery_boy_id || undefined
        });
        if (createRes && createRes.reminder && createRes.reminder.id) {
          targetId = createRes.reminder.id;
        }
      }

      messageSendEvent.triggerSendProgress(distName, `Sending WhatsApp reminder to ${distName}...`, 10);
      whatsappQueueEvent.triggerOpen();
      whatsappQueueEvent.triggerUpdated();

      await api.sendDistributorReminderNow(targetId, msgToSend);
      await fetchDistributorReminders(true);
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e.message || 'Failed to send WhatsApp reminder', 'error');
    } finally {
      setSendingReminderId(null);
    }
  };

  const fetchGlobalTemplate = async () => {
    try {
      const res = await api.getDistributorReminderTemplate();
      if (res && res.template) {
        setGlobalTemplate(res.template);
      }
    } catch (err) {
      console.error('Failed to fetch reminder template:', err);
    }
  };

  const handleSaveGlobalTemplate = async () => {
    setSavingTemplate(true);
    try {
      await api.saveDistributorReminderTemplate(globalTemplate);
      showNotif('Default message template saved successfully!');
      setShowTemplateModal(false);
    } catch (_err) {
      showNotif('Failed to save template', 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  // Inline Distributor Phone Edit state on Dispatch table
  const [editingDistPhoneId, setEditingDistPhoneId] = useState<number | null>(null);
  const [distPhoneInput, setDistPhoneInput] = useState<string>('');
  const [isSavingDistPhone, setIsSavingDistPhone] = useState<boolean>(false);

  const handleStartEditDistPhone = (item: LocalReminderRow) => {
    setEditingDistPhoneId(item.id);
    setDistPhoneInput(item.distributor_phone || '');
  };

  const handleSaveDistributorPhone = async (item: LocalReminderRow) => {
    const cleanPhone = distPhoneInput.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length !== 10 && !(cleanPhone.length === 12 && cleanPhone.startsWith('91'))) {
      showNotif('Please enter a valid 10-digit phone number', 'error');
      return;
    }
    setIsSavingDistPhone(true);
    try {
      const finalPhone = cleanPhone.length === 12 && cleanPhone.startsWith('91') ? cleanPhone.slice(2) : cleanPhone;
      // Persist across tables
      await apiClient.post('/pharmarack/distributor-mappings', {
        store_name: item.distributor_name,
        distributor_id: item.distributor_id || null,
        phone: finalPhone
      });
      await apiClient.post('/distributors', {
        name: item.distributor_name,
        phone: finalPhone
      });
      setDistributorReminders(prev => prev.map(r => r.id === item.id ? { ...r, distributor_phone: finalPhone } : r));
      showNotif(`Phone number updated for ${item.distributor_name}`);
      setEditingDistPhoneId(null);
      await fetchDistributorReminders(true);
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.message || 'Failed to save distributor phone', 'error');
    } finally {
      setIsSavingDistPhone(false);
    }
  };

  const [showMessageData, setShowMessageData] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowMessageData(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven refresh flow per P1 contract; loaders are async
    fetchAll();
    fetchDistributorReminders();
    const handlePhoneUpdate = () => {
      clearDispatchPageCache();
      fetchAll();
      fetchDistributorReminders();
      fetchMessageDates();
    };
    const handleDistributorsUpdate = () => {
      fetchDistributorReminders();
    };
    const unsubWs = whatsappQueueEvent.subscribeUpdated(() => {
      fetchDistributorReminders();
      fetchAll();
    });
    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    window.addEventListener('settings-updated', handlePhoneUpdate);
    window.addEventListener('distributors-updated', handleDistributorsUpdate);
    return () => {
      unsubWs();
      window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
      window.removeEventListener('settings-updated', handlePhoneUpdate);
      window.removeEventListener('distributors-updated', handleDistributorsUpdate);
    };
  }, [fetchAll, fetchDistributorReminders, fetchMessageDates]);

  // P1 "events, not timers": reminder list refreshes on SSE push (dispatch/email
  // changes) and focus — no 45s polling of unchanged data.
  const pageActive = usePageActive();
  useEffect(() => {
    if (!pageActive) return;
    const handleSse = () => fetchDistributorReminders(true);
    window.addEventListener('sse-dispatch-updated', handleSse);
    window.addEventListener('sse-email-new', handleSse);
    window.addEventListener('focus', handleSse);
    return () => {
      window.removeEventListener('sse-dispatch-updated', handleSse);
      window.removeEventListener('sse-email-new', handleSse);
      window.removeEventListener('focus', handleSse);
    };
  }, [pageActive, fetchDistributorReminders]);

  useEffect(() => {
    if (!showMessageData) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy deferred load after 500ms reveal toggle
    fetchMessageDates();
  }, [showMessageData, fetchMessageDates]);

  useEffect(() => {
    if (selectedDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads messages for user-selected date
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
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.response?.data?.error || 'Failed to add delivery boy', 'error');
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
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.response?.data?.error || 'Failed to update delivery boy', 'error');
    } finally { setSavingBoyEdit(false); }
  };

  const handleToggleBoyActive = async (boy: DeliveryBoy) => {
    try {
      const newActive = boy.is_active ? 0 : 1;
      await api.updateDeliveryBoy(boy.id, { is_active: newActive });
      showNotif(`Delivery boy "${boy.name}" ${newActive ? 'activated' : 'deactivated'}`);
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const handleDeleteBoy = async (id: number, name: string) => {
    if (!confirm(`Delete delivery boy "${name}"?`)) return;
    try {
      await api.deleteDeliveryBoy(id);
      showNotif(`Delivery boy "${name}" deleted`);
      await broadcastContactDataChanged();
      fetchAll();
    } catch (err) {
      const e = err as LocalApiError;
      showNotif(e?.response?.data?.error || 'Failed to delete delivery boy', 'error');
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
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: status as DispatchOrder['status'] } : o));
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

  // Metrics
  const pendingCount = orders.filter(o => o.status === 'Pending').length;
  const inTransitCount = orders.filter(o => o.status === 'In Transit').length;
  const deliveredTodayCount = orders.filter(o => {
    if (o.status !== 'Delivered' || !o.delivered_at) return false;
    return new Date(o.delivered_at).toDateString() === new Date().toDateString();
  }).length;

  const uncollectedDistributorsCount = distributorReminders.filter(r => r.has_order_today === 1 && r.status !== 'Collected').length;

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
    <div className="w-full flex-1 flex flex-col gap-4 pb-8 text-left animate-in fade-in duration-300">
      {/* ── SIGNATURE: LIVE DISTRIBUTOR COLLECTION WINDOW ── */}
      {(() => {
        if (!autoDispatchEnabled) {
          return (
            <div className="rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors duration-500 bg-bg2/40 border-glass-border/80">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Bell size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-text">Distributor collection window</span>
                  <span className="text-xs font-mono font-bold whitespace-nowrap text-amber-400">
                    ⏸️ Auto-Reminders Disabled in Settings
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  Automatic reminder dispatches are paused. Enable "Distributor Dispatch Reminders" in Settings to activate the live auto-send schedule.
                </div>
              </div>
            </div>
          );
        }

        const cd = getWindowCountdownInfo(nowTime, windowSchedule.start, windowSchedule.end);
        return (
          <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors duration-500 ${
            cd.status === 'ACTIVE'
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-bg2/40 border-glass-border/80'
          }`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              cd.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-bg3/80 text-muted'
            }`}>
              <MessageSquare size={16} className={cd.status === 'ACTIVE' ? 'animate-pulse' : ''} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-text">Distributor collection window</span>
                <span className={`text-xs font-mono font-bold whitespace-nowrap ${
                  cd.status === 'ACTIVE' ? 'text-emerald-400' : cd.status === 'BEFORE' ? 'text-amber-400' : 'text-muted'
                }`}>
                  {cd.status === 'CLOSED' ? 'Closed for today' : cd.countdownText}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-bg3/80 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${cd.status === 'ACTIVE' ? 'bg-emerald-400' : cd.status === 'CLOSED' ? 'bg-glass-border' : 'bg-amber-400/70'}`}
                  style={{ width: `${cd.progressPct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── TAB STRIP ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <button
          onClick={() => setActiveTab('queue')}
          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
            activeTab === 'queue'
              ? 'bg-primary/15 border-primary/40'
              : 'bg-bg2/40 border-glass-border/80 hover:border-primary/25'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${activeTab === 'queue' ? 'text-primary' : 'text-text'}`}>
            <Package size={14} /> Dispatch Queue
            <span className="ml-auto text-[10px] font-mono font-bold text-muted">{orders.length}</span>
          </span>
          <span className="mt-1.5 block text-[10px] text-muted truncate">
            {pendingCount} pending &middot; {inTransitCount} in transit &middot; {deliveredTodayCount} delivered today
          </span>
        </button>

        <button
          onClick={() => setActiveTab('reminders')}
          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
            activeTab === 'reminders'
              ? 'bg-amber-500/15 border-amber-500/40'
              : 'bg-bg2/40 border-glass-border/80 hover:border-amber-500/25'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${activeTab === 'reminders' ? 'text-amber-400' : 'text-text'}`}>
            <Bell size={14} /> Reminders
            {uncollectedDistributorsCount > 0 && (
              <span className="ml-auto text-[10px] font-mono font-bold text-rose-400">{uncollectedDistributorsCount}</span>
            )}
          </span>
          <span className="mt-1.5 block text-[10px] text-muted truncate">distributor collection status</span>
        </button>

        <button
          onClick={() => setActiveTab('staff')}
          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
            activeTab === 'staff'
              ? 'bg-sky/15 border-sky/40'
              : 'bg-bg2/40 border-glass-border/80 hover:border-sky/25'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${activeTab === 'staff' ? 'text-sky' : 'text-text'}`}>
            <User size={14} /> Staff
            <span className="ml-auto text-[10px] font-mono font-bold text-muted">{allBoys.length}</span>
          </span>
          <span className="mt-1.5 block text-[10px] text-muted truncate">delivery personnel directory</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-emerald-500/15 border-emerald-500/40'
              : 'bg-bg2/40 border-glass-border/80 hover:border-emerald-500/25'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${activeTab === 'logs' ? 'text-emerald-400' : 'text-text'}`}>
            <Send size={14} /> Message Logs
          </span>
          <span className="mt-1.5 block text-[10px] text-muted truncate">WhatsApp send history</span>
        </button>

        <button
          onClick={() => setActiveTab('all')}
          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
            activeTab === 'all'
              ? 'bg-bg3 border-glass-border'
              : 'bg-bg2/40 border-glass-border/80 hover:border-glass-border'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${activeTab === 'all' ? 'text-text' : 'text-text'}`}>
            <Layers size={14} /> All In One
          </span>
          <span className="mt-1.5 block text-[10px] text-muted truncate">everything on one page</span>
        </button>
      </div>

      {/* ── TAB CONTENT 1: ACTIVE DISPATCH QUEUE ── */}
      {(activeTab === 'queue' || activeTab === 'all') && (
        <div className="glass-panel rounded-2xl overflow-hidden bg-bg2/40 border border-glass-border/80 shadow-2xl backdrop-blur-xl flex flex-col">
          {/* Section Bar */}
          <div className="p-4 bg-bg3/40 border-b border-glass-border/60 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-bold border border-primary/30 shrink-0">
                <Package size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-xs uppercase tracking-wider text-text">Active Home Delivery Dispatch Queue</h3>
                  <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded-full bg-bg text-muted border border-glass-border">
                    {filteredOrders.length} Orders Shown
                  </span>
                </div>
              </div>
            </div>

            {/* Queue Search & Status Filter */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => setShowModal(true)}
                className="bg-primary hover:bg-primary/90 text-black text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Plus size={14} />
                <span>New Order</span>
              </button>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search patient, phone, invoice..."
                  value={queueSearch}
                  onChange={e => setQueueSearch(e.target.value)}
                  className="pl-9 pr-7 py-1.5 rounded-xl bg-bg text-text border border-glass-border text-xs focus:outline-none focus:border-primary/50 font-medium shadow-inner transition-all w-56"
                />
                {queueSearch && (
                  <button
                    type="button"
                    onClick={() => setQueueSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5"
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 bg-bg p-1 rounded-xl border border-glass-border text-xs shadow-inner">
                <Filter size={12} className="ml-2 mr-1 text-muted" />
                {(['ALL', 'Pending', 'In Transit', 'Delivered'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                      statusFilter === st
                        ? 'bg-bg2 text-text shadow-sm border border-glass-border font-black'
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
              <thead className="bg-bg2/90 sticky top-0 backdrop-blur z-10 border-b border-glass-border">
                <tr>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Patient Name</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Phone Number</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Order Items</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Delivery Address</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Assigned Staff</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Invoice #</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Status</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap text-right">Actions</th>
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
                      <td className="p-3 text-right">
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
        <div className="glass-panel p-5 space-y-5 bg-bg2/40 border border-glass-border/80 rounded-2xl shadow-2xl backdrop-blur-xl transition-all duration-300">
          
          {/* Section Header & High-Level Actions */}
          <div className="flex flex-wrap justify-between items-center gap-4 border-b border-glass-border/60 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
                <Bell size={18} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-text">Distributor Dispatch &amp; Collection Reminders</h3>
                <p className="text-xs text-muted mt-0.5">Auto-detects suppliers ordered from today and coordinates dispatch/collection status.</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowManualOrderModal(true)}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors border border-emerald-500/30 font-semibold text-xs flex items-center gap-2 cursor-pointer active:scale-95 shadow-sm"
                title="Record an order placed via phone call"
              >
                <Plus size={14} />
                <span>Record Phone Order</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  fetchGlobalTemplate();
                  setShowTemplateModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors border border-amber-500/30 font-semibold text-xs flex items-center gap-2 cursor-pointer active:scale-95"
                title="Customize default reminder message format"
              >
                <Edit3 size={14} />
                <span>Message Template</span>
              </button>

              <button
                type="button"
                onClick={() => fetchDistributorReminders()}
                className="p-2.5 rounded-xl bg-bg3/60 hover:bg-bg3 text-muted hover:text-text transition-colors border border-glass-border cursor-pointer active:scale-95"
                title="Refresh Distributor Reminders"
              >
                <RefreshCw size={15} className={loadingDistributorReminders ? 'animate-spin text-amber-400' : ''} />
              </button>
            </div>
          </div>

          {/* ── METRIC ROW ── */}
          {(() => {
            const todayCount = distributorReminders.filter(r => r.has_order_today === 1).length;
            const sentTodayCount = distributorReminders.filter(r =>
              r.has_order_today === 1 && (r.latest_notif_status === 'sent' || r.latest_notif_status === 'delivered')
            ).length;
            const notSentTodayCount = distributorReminders.filter(r =>
              r.has_order_today === 1 && r.latest_notif_status !== 'sent' && r.latest_notif_status !== 'delivered'
            ).length;

            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Metric 1: Today's Orders */}
                <div className="p-3.5 rounded-xl bg-bg/50 border border-glass-border/70 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
                    <Package size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Today's Orders</div>
                    <div className="text-base font-bold text-text font-mono flex items-center gap-1.5">
                      {todayCount} <span className="text-[10px] font-normal text-muted">distributors</span>
                    </div>
                  </div>
                </div>

                {/* Metric 2: Messages Sent */}
                <div className="p-3.5 rounded-xl bg-bg/50 border border-glass-border/70 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Messages Sent</div>
                    <div className="text-base font-bold text-emerald-400 font-mono flex items-center gap-1.5">
                      {sentTodayCount} <span className="text-[10px] font-normal text-muted">/ {todayCount}</span>
                    </div>
                  </div>
                </div>

                {/* Metric 3: Handover Pending */}
                <div className="p-3.5 rounded-xl bg-bg/50 border border-glass-border/70 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sky/15 text-sky flex items-center justify-center shrink-0">
                    <Clock size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wide">Pending Handover</div>
                    <div className="text-base font-bold text-amber-300 font-mono flex items-center gap-1.5">
                      {notSentTodayCount} <span className="text-[10px] font-normal text-muted">remaining</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── AUTO-SEND SCHEDULE WINDOW & FILTER TOOLBAR ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-bg/40 p-3 rounded-xl border border-glass-border/60 backdrop-blur-md">
            {/* Today Filter Segmented Selector */}
            <div className="flex items-center gap-1 bg-bg p-1 rounded-xl border border-glass-border text-xs shadow-inner">
              <button
                type="button"
                onClick={() => setDistributorTodayOnly(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                  distributorTodayOnly
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Package size={13} />
                <span>Today's Orders Only</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/30 text-emerald-300 font-bold">
                  {distributorReminders.filter(r => r.has_order_today === 1).length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDistributorTodayOnly(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                  !distributorTodayOnly
                    ? 'bg-bg2 text-text border border-glass-border'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Layers size={13} />
                <span>All Distributors</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-bg3 text-muted font-bold">
                  {distributorReminders.length}
                </span>
              </button>
            </div>

            {/* Afternoon Delivery Boy Dispatch Button & Search Input */}
            <div className="flex items-center gap-3 flex-wrap flex-1 justify-end">
              <button
                type="button"
                onClick={handleSendAfternoonDeliveryBoyDispatch}
                disabled={isSendingAfternoonDispatch}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-md disabled:opacity-50"
                title={`Send consolidated afternoon collection summary to active delivery staff (${afternoonSchedule.time || '14:00'})`}
              >
                {isSendingAfternoonDispatch ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Truck size={13} className="text-emerald-400" />
                )}
                <span>Send Afternoon Dispatch</span>
              </button>

              <div className="relative flex-1 min-w-[200px] max-w-[320px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search distributor, phone, staff, status..."
                  value={distributorSearch}
                  onChange={e => setDistributorSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-bg text-text border border-glass-border text-xs focus:outline-none focus:border-amber-400/50 font-medium transition-all shadow-inner"
                />
                {distributorSearch && (
                  <button
                    type="button"
                    onClick={() => setDistributorSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 transition-colors"
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table of Today's Distributors */}
          <div className="overflow-x-auto bg-bg/30 rounded-2xl border border-glass-border/80 shadow-lg backdrop-blur-md">
            <table className="w-full text-left border-collapse text-xs table-fixed min-w-[900px]">
              <thead className="bg-bg2/90 border-b border-glass-border/80 sticky top-0 z-10">
                <tr>
                  <th className="w-[28%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Distributor Name &amp; Tags</th>
                  <th className="w-[14%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Contact Phone</th>
                  <th className="w-[22%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Assigned Delivery Staff</th>
                  <th className="w-[20%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">Dispatch / Collection Status</th>
                  <th className="w-[16%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/30">
                {loadingDistributorReminders ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-muted">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-amber-400" />
                      <p className="font-bold text-text text-xs">Checking today's active distributor orders...</p>
                    </td>
                  </tr>
                ) : (() => {
                  const displayList = distributorReminders.filter(r => {
                    if (distributorTodayOnly && r.has_order_today !== 1) return false;
                    const term = distributorSearch.toLowerCase().trim();
                    if (!term) return true;
                    return (
                      (r.distributor_name && r.distributor_name.toLowerCase().includes(term)) ||
                      (r.distributor_phone && r.distributor_phone.includes(term)) ||
                      (r.delivery_boy_name && r.delivery_boy_name.toLowerCase().includes(term)) ||
                      (r.status && r.status.toLowerCase().includes(term))
                    );
                  });

                  if (displayList.length === 0) {
                    return (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted">
                          <Bell size={32} className="mx-auto mb-2 opacity-30 text-amber-400" />
                          <p className="font-extrabold text-sm text-text">No matching distributors found</p>
                          <p className="text-xs text-muted mt-1">
                            {distributorTodayOnly
                              ? "No distributor orders sent today. Switch to 'All Distributors' to view full directory."
                              : "Try clearing your search query or placing a new purchase/cart order."}
                          </p>
                        </td>
                      </tr>
                    );
                  }

                  return displayList.map(item => {
                    const isPreviewOpen = expandedPreviewId === item.id;
                    const isOrdersOpen = expandedOrderDetailsId === item.id;
                    const boyName = item.delivery_boy_name || '👤 Admin / Store Owner';
                    const boyPhone = item.delivery_boy_phone ? `(${item.delivery_boy_phone})` : '';

                    return (
                      <Fragment key={item.id}>
                        <tr className="hover:bg-bg3/30 transition-colors">
                          <td className="p-3.5 align-middle">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-text text-xs tracking-tight">{item.distributor_name}</span>

                              {/* Multiple Orders Highlight Badge */}
                              {item.order_count && item.order_count > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedOrderDetailsId(isOrdersOpen ? null : item.id)}
                                  className="px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wide bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm flex items-center gap-1 shrink-0 animate-pulse hover:bg-amber-500/35 cursor-pointer"
                                  title="Click to view separate order timestamps & items placed today"
                                >
                                  <Zap size={10} /> ✨ {item.order_count} Orders Today
                                </button>
                              ) : null}

                              {item.has_pharmarack_order_today === 1 ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                                  <ShoppingCart size={10} /> Pharmarack Cart Sent
                                </span>
                              ) : item.has_order_today === 1 ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-sky/20 text-sky border border-sky/30 flex items-center gap-1 shrink-0">
                                  <Package size={10} /> Today's Order
                                </span>
                              ) : null}

                              {item.latest_notif_status === 'skipped_offline' || item.status === 'Skipped (PC Offline)' ? (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0 cursor-help"
                                  title="Skipped automatically because PC was offline during dispatch window"
                                >
                                  ⚡ Skipped (PC Offline)
                                </span>
                              ) : item.latest_notif_status === 'failed' || item.latest_notif_error ? (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 shrink-0 cursor-help"
                                  title={item.latest_notif_error || 'WhatsApp message failed to deliver'}
                                >
                                  <XCircle size={10} /> Failed: {item.latest_notif_error ? item.latest_notif_error.substring(0, 24) + '...' : 'Delivery Error'}
                                </span>
                              ) : item.latest_notif_status === 'sent' || item.latest_notif_status === 'delivered' ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                                  <CheckCircle size={10} /> Message Sent
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-3.5 font-mono text-xs align-middle">
                            {editingDistPhoneId === item.id ? (
                              <div className="flex items-center gap-1.5 min-w-[170px]">
                                <input
                                  type="text"
                                  autoFocus
                                  value={distPhoneInput}
                                  onChange={e => setDistPhoneInput(e.target.value)}
                                  placeholder="10-digit number"
                                  className="w-28 text-xs font-mono px-2 py-1 rounded-lg bg-bg border border-glass-border focus:outline-none focus:border-emerald-500 text-text font-bold"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveDistributorPhone(item);
                                    if (e.key === 'Escape') setEditingDistPhoneId(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveDistributorPhone(item)}
                                  disabled={isSavingDistPhone}
                                  className="p-1 rounded-md bg-emerald-500 text-black hover:bg-emerald-400 cursor-pointer shadow-sm disabled:opacity-50"
                                  title="Save phone number"
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingDistPhoneId(null)}
                                  className="p-1 rounded-md bg-bg3 text-muted hover:text-text cursor-pointer"
                                  title="Cancel"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 group">
                                <span className={item.distributor_phone ? 'text-text font-semibold' : 'text-muted italic'}>
                                  {item.distributor_phone || 'No phone set'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditDistPhone(item)}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg3 text-muted hover:text-sky transition-all cursor-pointer"
                                  title={item.distributor_phone ? "Edit phone number" : "Add phone number"}
                                >
                                  <Edit2 size={11} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="p-3.5 align-middle">
                            <select
                              value={item.delivery_boy_id || ''}
                              onChange={e => handleUpdateDistributorStatus(item.id, item.status, e.target.value ? Number(e.target.value) : null, item)}
                              className="w-full text-xs px-3 py-1.5 rounded-xl bg-bg text-text border border-glass-border focus:outline-none font-medium transition-all shadow-sm cursor-pointer hover:border-glass-border/80"
                            >
                              <option value="">👤 Unassigned / Admin Fallback</option>
                              {deliveryBoys.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3.5 align-middle">
                            <select
                              value={item.status}
                              onChange={e => handleUpdateDistributorStatus(item.id, e.target.value, item.delivery_boy_id, item)}
                              className={`w-full text-[11px] font-extrabold px-3 py-1.5 rounded-xl border cursor-pointer bg-bg transition-all shadow-sm ${
                                item.status === 'Collected'
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-emerald-500/10'
                                  : item.status === 'Dispatched'
                                  ? 'bg-sky/20 text-sky border-sky/40 shadow-sky/10'
                                  : item.status === 'Skipped (PC Offline)'
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : item.status === 'No Order Today'
                                  ? 'bg-bg3/60 text-muted border-glass-border'
                                  : 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-amber-500/10'
                              }`}
                            >
                              <option value="No Order Today">⚪ No Order Today</option>
                              <option value="Pending">⏳ Pending Handover</option>
                              <option value="Dispatched">📦 Dispatched / Email Received</option>
                              <option value="Collected">✅ Collected by Staff</option>
                              <option value="Skipped (PC Offline)">⚡ Skipped (PC Offline)</option>
                            </select>
                          </td>
                          <td className="p-3.5 align-middle text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleSendReminderNow(item.id)}
                                disabled={sendingReminderId === item.id}
                                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 disabled:opacity-50 transition-all active:scale-95 cursor-pointer shadow-md hover:shadow-emerald-500/20 shrink-0"
                              >
                                {sendingReminderId === item.id ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <Send size={13} />
                                )}
                                <span>{sendingReminderId === item.id ? 'Sending...' : 'Send Now'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setExpandedPreviewId(isPreviewOpen ? null : item.id)}
                                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer active:scale-95 shrink-0 ${
                                  isPreviewOpen
                                    ? 'bg-amber-500/25 text-amber-300 border-amber-500/50 shadow-md font-black'
                                    : 'bg-bg3/60 text-muted hover:text-text border-glass-border hover:bg-bg3'
                                }`}
                                title="Edit Direct Text Message"
                              >
                                <Edit3 size={13} />
                                <span>{isPreviewOpen ? 'Close' : 'Edit Text'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* WhatsApp Reminder Direct Message Editor Sub-Row */}
                        {isPreviewOpen && (
                          <tr className="bg-bg3/20 border-b border-glass-border/50">
                            <td colSpan={5} className="p-4">
                              <div className="p-4 rounded-2xl bg-bg2/95 border border-glass-border/80 space-y-3.5 text-xs shadow-2xl backdrop-blur-xl transition-all">
                                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-glass-border/40 pb-2.5">
                                  <span className="font-extrabold text-amber-400 flex items-center gap-2 text-xs">
                                    <Edit3 size={16} /> Direct WhatsApp Message Editor <span className="text-text font-black">({item.distributor_name})</span>
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const defaultMsg = `📦 Has today's order been dispatched or collected by ${boyName}${boyPhone ? ` ${boyPhone}` : ''}? - Pharmacy Store`;
                                        setCustomMessages(prev => ({ ...prev, [item.id]: defaultMsg }));
                                        showNotif('Reset to default message');
                                      }}
                                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-bg hover:bg-bg3 text-muted hover:text-text border border-glass-border flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                    >
                                      <RefreshCw size={11} /> Reset Text
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentText = customMessages[item.id] !== undefined
                                          ? customMessages[item.id]
                                          : `📦 Has today's order been dispatched or collected by ${boyName}${boyPhone ? ` ${boyPhone}` : ''}? - Pharmacy Store`;
                                        navigator.clipboard.writeText(currentText);
                                        showNotif('Message text copied to clipboard');
                                      }}
                                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-bg hover:bg-bg3 text-text border border-glass-border flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                    >
                                      📋 Copy Text
                                    </button>
                                  </div>
                                </div>

                                {/* Direct Text Editor Box */}
                                <textarea
                                  rows={3}
                                  value={
                                    customMessages[item.id] !== undefined
                                      ? customMessages[item.id]
                                      : `📦 Has today's order been dispatched or collected by ${boyName}${boyPhone ? ` ${boyPhone}` : ''}? - Pharmacy Store`
                                  }
                                  onChange={e => {
                                    const val = e.target.value;
                                    setCustomMessages(prev => ({ ...prev, [item.id]: val }));
                                  }}
                                  placeholder="Type or edit reminder message directly..."
                                  className="w-full p-3.5 rounded-xl bg-bg text-text font-mono text-xs border border-glass-border focus:outline-none focus:border-amber-400/60 leading-relaxed shadow-inner transition-all"
                                />

                                <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                                  <span className="text-[11px] text-muted font-medium flex items-center gap-1">
                                    💡 Edit the text directly above and click <strong className="text-emerald-400 font-bold">⚡ Send Custom Text Now</strong> to dispatch via WhatsApp.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSendReminderNow(item.id, customMessages[item.id])}
                                    disabled={sendingReminderId === item.id}
                                    className="flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 disabled:opacity-50 transition-all cursor-pointer shadow-lg hover:shadow-emerald-500/20 active:scale-95"
                                  >
                                    {sendingReminderId === item.id ? (
                                      <RefreshCw size={14} className="animate-spin" />
                                    ) : (
                                      <Send size={14} />
                                    )}
                                    <span>{sendingReminderId === item.id ? 'Sending...' : '⚡ Send Custom Text Now'}</span>
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Separate Orders Details Sub-Row */}
                        {isOrdersOpen && (
                          <tr className="bg-bg3/20 border-b border-glass-border/50">
                            <td colSpan={5} className="p-4">
                              <div className="p-4 rounded-2xl bg-bg2/95 border border-glass-border/80 space-y-3 text-xs shadow-2xl backdrop-blur-xl transition-all">
                                <div className="flex items-center justify-between border-b border-glass-border/40 pb-2">
                                  <div className="flex items-center gap-2">
                                    <Package size={15} className="text-amber-400" />
                                    <span className="font-extrabold text-xs text-text">
                                      Orders Placed Today with <span className="text-amber-300 font-black">{item.distributor_name}</span> ({item.orders_list?.length || item.order_count || 1} {((item.orders_list?.length || item.order_count || 1) === 1 ? 'Order' : 'Orders')})
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedOrderDetailsId(null)}
                                    className="p-1 rounded-md bg-bg3 text-muted hover:text-text cursor-pointer"
                                    title="Close Details"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>

                                {item.orders_list && item.orders_list.length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {item.orders_list.map((ord: LocalDistributorOrderEntry, oIdx: number) => (
                                      <div key={ord.id || oIdx} className="p-3 rounded-xl bg-bg border border-glass-border/70 space-y-2">
                                        <div className="flex items-center justify-between text-[11px] font-bold">
                                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                            Order #{oIdx + 1}
                                          </span>
                                          <span className="text-muted font-mono flex items-center gap-1">
                                            <Clock size={11} /> {ord.order_time || 'Today'}
                                          </span>
                                        </div>
                                        <div className="space-y-1">
                                          <div className="text-[10px] uppercase font-bold text-muted tracking-wider">
                                            {ord.items_count} item{ord.items_count === 1 ? '' : 's'}:
                                          </div>
                                          <ul className="space-y-0.5 text-xs text-text">
                                            {ord.items_preview && ord.items_preview.length > 0 ? (
                                              ord.items_preview.map((pText: string, pIdx: number) => (
                                                <li key={pIdx} className="flex items-center gap-1.5 text-[11px] font-medium">
                                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                                  <span className="truncate">{pText}</span>
                                                </li>
                                              ))
                                            ) : (
                                              <li className="text-[11px] text-muted italic">Order logged from cart</li>
                                            )}
                                          </ul>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-3 rounded-xl bg-bg text-muted text-xs italic">
                                    Standard order placed today with this distributor.
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB CONTENT 3: DELIVERY STAFF DIRECTORY ── */}
      {(activeTab === 'staff' || activeTab === 'all') && (
        <div className="glass-panel p-5 space-y-5 bg-bg2/40 border border-glass-border/80 rounded-2xl shadow-2xl backdrop-blur-xl transition-all duration-300">
          <div className="flex justify-between items-center flex-wrap gap-3 border-b border-glass-border/60 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500/25 to-purple-600/10 text-purple-400 flex items-center justify-center font-bold border border-purple-500/30 shadow-lg shadow-purple-500/10 shrink-0">
                <User size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-sm uppercase tracking-wider text-text">Delivery Personnel Directory</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-500/15 text-purple-400 border border-purple-500/30">
                    Active Staff Hub
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">Manage active store staff, assigned WhatsApp contact numbers, and status.</p>
              </div>
            </div>
            <span className="text-xs font-mono font-black px-3 py-1.5 rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm">
              {allBoys.length} Registered Staff
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
        <div className="glass-panel p-5 space-y-5 bg-bg2/40 border border-glass-border/80 rounded-2xl shadow-2xl backdrop-blur-xl transition-all duration-300">
          <div className="flex justify-between items-center flex-wrap gap-3 border-b border-glass-border/60 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-emerald-600/10 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/30 shadow-lg shadow-emerald-500/10 shrink-0">
                <Send size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-sm uppercase tracking-wider text-text">WhatsApp Message History Logs</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Audit Trail
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">Complete trace of all automated collection and dispatch messages sent to staff & distributors.</p>
              </div>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-muted font-bold uppercase flex items-center gap-1.5">
                <Calendar size={13} className="text-emerald-400" /> Select Date:
              </span>
              {messageDates.length > 0 ? (
                <select
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-xs font-mono font-black px-3.5 py-1.5 rounded-xl bg-bg border border-glass-border text-text cursor-pointer focus:outline-none focus:border-emerald-400/50 shadow-inner transition-all"
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
                  className="text-xs font-mono font-black px-3.5 py-1.5 rounded-xl bg-bg border border-glass-border text-text focus:outline-none shadow-inner"
                />
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-glass-border bg-bg/20">
            <table className="w-full text-left border-collapse text-xs table-fixed min-w-[850px]">
              <thead className="bg-bg2/90 border-b border-glass-border sticky top-0 z-10">
                <tr>
                  <th className="w-[12%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Time</th>
                  <th className="w-[20%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Recipient</th>
                  <th className="w-[16%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Phone Number</th>
                  <th className="w-[14%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Status</th>
                  <th className="w-[38%] px-4 py-3.5 text-[11px] font-bold text-muted uppercase tracking-wider border-b border-glass-border whitespace-nowrap">Exact WhatsApp Message Body</th>
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

      {showTemplateModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl max-w-lg w-full bg-bg2 border border-glass-border shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-glass-border pb-3">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <MessageSquare className="text-amber-400" size={18} /> Edit Default Reminder Message Template
              </h3>
              <button type="button" onClick={() => setShowTemplateModal(false)} className="text-muted hover:text-text p-1 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Customize the default format used for auto-reminders and manual dispatches. Use placeholder tags to insert live data dynamically.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-text">Template Format:</label>
              <textarea
                rows={4}
                value={globalTemplate}
                onChange={e => setGlobalTemplate(e.target.value)}
                className="w-full p-3 rounded-xl bg-bg text-text font-mono text-xs border border-glass-border focus:outline-none focus:border-amber-400/60 leading-relaxed"
                placeholder="📦 Has today's order been dispatched or collected by {delivery_boy} ({phone})? - {store_name}"
              />
            </div>

            <div className="p-3 rounded-xl bg-bg/50 border border-glass-border text-[11px] space-y-1 text-muted">
              <p className="font-bold text-text">Available Dynamic Placeholders:</p>
              <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-bg3 text-amber-300 font-bold">{'{distributor_name}'}</span>
                <span className="px-1.5 py-0.5 rounded bg-bg3 text-sky font-bold">{'{delivery_boy}'}</span>
                <span className="px-1.5 py-0.5 rounded bg-bg3 text-emerald-300 font-bold">{'{phone}'}</span>
                <span className="px-1.5 py-0.5 rounded bg-bg3 text-purple-300 font-bold">{'{store_name}'}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-glass-border">
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-muted font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveGlobalTemplate}
                disabled={savingTemplate}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {savingTemplate ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Save Template
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showManualOrderModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl max-w-md w-full bg-bg2 border border-glass-border shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-glass-border pb-3">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <PhoneCall className="text-emerald-400" size={18} /> Record Phone Call Order Reminder
              </h3>
              <button type="button" onClick={() => setShowManualOrderModal(false)} className="text-muted hover:text-text p-1 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Add a distributor order placed via personal phone call. The system will track and trigger dispatch reminders automatically if no stock email or invoice is received.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Distributor Name *</label>
                <input
                  type="text"
                  value={manualDistributorName}
                  onChange={e => setManualDistributorName(e.target.value)}
                  placeholder="e.g. Mahavir Pharma"
                  className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none focus:border-emerald-400/60 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Distributor Phone (WhatsApp)</label>
                <input
                  type="text"
                  value={manualDistributorPhone}
                  onChange={e => setManualDistributorPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none focus:border-emerald-400/60 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Assigned Delivery Staff</label>
                <select
                  value={manualDeliveryBoyId || ''}
                  onChange={e => setManualDeliveryBoyId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 rounded-xl bg-bg text-text text-xs border border-glass-border focus:outline-none font-medium cursor-pointer"
                >
                  <option value="">👤 Unassigned / Store Admin</option>
                  {deliveryBoys.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-glass-border">
              <button
                type="button"
                onClick={() => setShowManualOrderModal(false)}
                className="px-4 py-2 rounded-xl bg-bg3 hover:bg-bg3/80 text-muted font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateManualOrder}
                disabled={savingManualOrder}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-xs hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                {savingManualOrder ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                Add Phone Order
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
