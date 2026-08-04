import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Truck, Package, Clock, CheckCircle, MapPin, Plus, X, User, Trash2, RefreshCw, ChevronDown, Send, Check, Edit3 } from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';
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
  Pending: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  'In Transit': 'bg-sky/20 text-sky border border-sky/30',
  Delivered: 'bg-green/20 text-green border border-green/30',
};

const emptyForm = { patient_name: '', patient_phone: '', address: '', items: '', notes: '', delivery_boy_id: '', invoice_no: '' };

const Dispatch = () => {
  const cachedOrders = getDispatchOrdersCache() as DispatchOrder[] | null;
  const cachedDeliveryBoys = getDispatchDeliveryBoysCache() as DeliveryBoy[] | null;
  const [orders, setOrders] = useState<DispatchOrder[]>(cachedOrders || []);
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>(cachedDeliveryBoys || []);
  const [allBoys, setAllBoys] = useState<DeliveryBoy[]>([]);
  const [loading, setLoading] = useState(!cachedOrders);
  const [showModal, setShowModal] = useState(false);
  const [showBoysModal, setShowBoysModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // New delivery boy form states
  const [newBoyName, setNewBoyName] = useState('');
  const [newBoyPhone, setNewBoyPhone] = useState('');
  const [addingBoy, setAddingBoy] = useState(false);

  const showNotif = (msg: string, type: 'success' | 'error' = 'success') => {
    toastEvent.trigger(msg, type, '/dispatch');
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

  useEffect(() => {
    fetchAll();
    fetchMessageDates();
    const handlePhoneUpdate = () => {
      clearDispatchPageCache();
      fetchAll();
      fetchMessageDates();
    };
    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    window.addEventListener('settings-updated', handlePhoneUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
      window.removeEventListener('settings-updated', handlePhoneUpdate);
    };
  }, [fetchAll, fetchMessageDates]);

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
      setTimeout(() => fetchMessageDates(), 2000);
    } catch (err: any) {
      showNotif(err?.response?.data?.error || 'Failed to enqueue WhatsApp messages', 'error');
    }
  };

  const pending = orders.filter(o => o.status === 'Pending').length;
  const inTransit = orders.filter(o => o.status === 'In Transit').length;
  const deliveredToday = orders.filter(o => {
    if (o.status !== 'Delivered' || !o.delivered_at) return false;
    return new Date(o.delivered_at).toDateString() === new Date().toDateString();
  }).length;

  return (
    <div className="w-full flex-1 flex flex-col gap-4 pb-6 animate-in fade-in duration-500 text-left">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-text">Dispatch & Delivery Management</h2>
          <p className="text-muted text-xs">Directly manage delivery staff, track active orders, and view WhatsApp dispatch message history.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { fetchAll(); fetchMessageDates(); }} className="p-2 rounded-lg bg-bg2 border border-glass-border hover:bg-bg3 text-muted transition-all" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleSendAllViaWhatsApp}
            className="premium-btn bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold transition-all"
            title="Send all active collection orders via WhatsApp with 8s-12s pacing"
          >
            <Send size={15} /> Send All via WhatsApp
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 text-xs px-3.5 py-2 rounded-xl font-bold"
          >
            <Plus size={16} /> New Dispatch Order
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-panel p-4 flex items-center gap-3 bg-bg2/30">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <Clock size={20} className="text-amber-400" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Pending</p>
            <p className="text-xl font-extrabold text-amber-400">{pending}</p>
          </div>
        </div>
        <div className="glass-panel p-4 flex items-center gap-3 bg-bg2/30">
          <div className="w-10 h-10 rounded-xl bg-sky/10 flex items-center justify-center shrink-0">
            <Truck size={20} className="text-sky" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">In Transit</p>
            <p className="text-xl font-extrabold text-sky">{inTransit}</p>
          </div>
        </div>
        <div className="glass-panel p-4 flex items-center gap-3 bg-bg2/30">
          <div className="w-10 h-10 rounded-xl bg-green/10 flex items-center justify-center shrink-0">
            <CheckCircle size={20} className="text-green" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Delivered Today</p>
            <p className="text-xl font-extrabold text-green">{deliveredToday}</p>
          </div>
        </div>
        <div className="glass-panel p-4 flex items-center gap-3 bg-bg2/30">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
            <User size={20} className="text-purple-400" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Active Staff</p>
            <p className="text-xl font-extrabold text-purple-400">{deliveryBoys.length}</p>
          </div>
        </div>
      </div>

      {/* ── SECTION 1: Delivery Staff Directory (Directly Visible) ── */}
      <div className="glass-panel p-4 space-y-3 bg-bg2/20 border border-glass-border">
        <div className="flex justify-between items-center flex-wrap gap-2 border-b border-glass-border/40 pb-2">
          <div className="flex items-center gap-2">
            <User size={16} className="text-sky" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-text">Delivery Staff Directory</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky/15 text-sky border border-sky/20">
              {allBoys.length} Total Registered
            </span>
          </div>
        </div>

        {/* Delivery Staff Cards & Add Form Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Add Delivery Boy Inline Form */}
          <form onSubmit={handleAddDeliveryBoy} className="p-3.5 rounded-xl border border-dashed border-glass-border bg-bg/40 flex flex-col justify-between gap-2.5">
            <span className="text-[11px] font-extrabold text-primary flex items-center gap-1">
              <Plus size={13} /> Add Delivery Staff Member
            </span>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Full Name (e.g. Dinesh)"
                value={newBoyName}
                onChange={e => setNewBoyName(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-bg2 border border-glass-border text-text focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                placeholder="WhatsApp Phone (10 digits)"
                value={newBoyPhone}
                onChange={e => setNewBoyPhone(sanitizePhoneInput(e.target.value))}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-bg2 border border-glass-border text-text focus:outline-none focus:border-primary font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={addingBoy || !newBoyName.trim()}
              className="w-full text-xs py-1.5 font-bold rounded-lg bg-sky hover:bg-sky-400 text-black transition-all disabled:opacity-40"
            >
              {addingBoy ? 'Adding...' : 'Save Delivery Staff'}
            </button>
          </form>

          {/* Delivery Staff List Cards */}
          {allBoys.map(boy => {
            const isEditing = editingBoyId === boy.id;
            const cleanPhone = (boy.whatsapp_number || '').replace(/\D/g, '');
            const formattedPhone = cleanPhone ? (cleanPhone.length === 10 ? `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}` : `+${cleanPhone}`) : 'No phone saved';

            return (
              <div key={boy.id} className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition-all shadow-sm ${boy.is_active ? 'bg-bg2/40 border-glass-border' : 'bg-bg/20 border-glass-border/30 opacity-60'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editBoyName}
                      onChange={e => setEditBoyName(e.target.value)}
                      className="w-full text-xs px-2 py-1 rounded bg-bg border border-glass-border text-text font-bold"
                    />
                    <input
                      type="text"
                      value={editBoyPhone}
                      onChange={e => setEditBoyPhone(sanitizePhoneInput(e.target.value))}
                      className="w-full text-xs px-2 py-1 rounded bg-bg border border-glass-border text-text font-mono"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditingBoyId(null)} className="px-2 py-1 text-[10px] text-muted hover:text-text">Cancel</button>
                      <button onClick={() => handleSaveBoyEdit(boy.id)} className="px-2.5 py-1 text-[10px] bg-green text-white font-bold rounded">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${boy.is_active ? 'bg-sky/20 text-sky border border-sky/30' : 'bg-zinc-800 text-muted'}`}>
                          {boy.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-black text-text truncate">{boy.name}</span>
                          <span className="text-[10px] font-mono text-muted truncate">{formattedPhone}</span>
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

                    <div className="flex items-center justify-between pt-1 border-t border-glass-border/30 text-[10px]">
                      {cleanPhone ? (
                        <a
                          href={`https://api.whatsapp.com/send?phone=${cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:underline font-bold flex items-center gap-1"
                        >
                          <Send size={10} /> Send WhatsApp
                        </a>
                      ) : <span className="text-muted italic">No phone</span>}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingBoyId(boy.id); setEditBoyName(boy.name); setEditBoyPhone(boy.whatsapp_number || ''); }}
                          className="text-muted hover:text-sky font-bold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteBoy(boy.id, boy.name)}
                          className="text-muted hover:text-red-400 font-bold"
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

      {/* ── SECTION 2: Active Dispatch Queue ── */}
      <div className="glass-panel flex-1 flex flex-col overflow-hidden bg-bg2/20 border border-glass-border">
        <div className="p-4 border-b border-glass-border flex justify-between items-center bg-bg3/20">
          <h3 className="font-bold flex items-center gap-2 text-xs uppercase tracking-wider text-text">
            <Package size={15} className="text-primary" /> Active Dispatch Queue
          </h3>
          <span className="text-[10px] text-muted font-bold font-mono">
            {orders.length} Total Orders
          </span>
        </div>
        <div className="flex-1 overflow-auto bg-bg/20">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-bg2/95 backdrop-blur z-10">
              <tr>
                {['Patient', 'Phone', 'Items', 'Address', 'Assigned Delivery Staff', 'Invoice', 'Status', 'Actions'].map(h => (
                  <th key={h} className="p-3 text-[10px] font-bold text-muted uppercase tracking-wider border-b border-glass-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center text-muted">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-primary/50" />
                  Loading dispatch orders...
                </td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={8} className="p-14 text-center text-muted">
                  <Truck size={32} className="mx-auto mb-3 opacity-20" />
                  No dispatch orders created yet. Click "New Dispatch Order" to assign home delivery.
                </td></tr>
              ) : orders.map(order => (
                <tr key={order.id} className="hover:bg-bg3/30 border-b border-glass-border/30 transition-all">
                  <td className="p-3 font-semibold text-text">{order.patient_name}</td>
                  <td className="p-3 font-mono text-muted">{order.patient_phone || '-'}</td>
                  <td className="p-3 text-muted max-w-[140px] truncate">{order.items || '-'}</td>
                  <td className="p-3 text-muted max-w-[130px] truncate flex items-start gap-1">
                    {order.address ? <><MapPin size={11} className="mt-0.5 shrink-0 text-muted/50" />{order.address}</> : '-'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <User size={11} className="text-muted" />
                      <span className={order.delivery_boy_name ? 'text-sky font-bold' : 'text-muted'}>
                        {order.delivery_boy_name || 'Unassigned'}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-muted">{order.invoice_no || '-'}</td>
                  <td className="p-3">
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order.id, e.target.value)}
                      className={`text-[10px] font-bold px-2 py-1 rounded border cursor-pointer bg-bg ${statusStyles[order.status]}`}
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Transit">In Transit</option>
                      <option value="Delivered">Delivered</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button onClick={() => handleDelete(order.id)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                      title="Delete Dispatch Order">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 3: Delivery Staff Sent Message History (Dating Format) ── */}
      <div className="glass-panel p-4 space-y-3 bg-bg2/20 border border-glass-border">
        <div className="flex justify-between items-center flex-wrap gap-2 border-b border-glass-border/40 pb-2">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-emerald-400" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-text">Delivery Staff WhatsApp Message History</h3>
            <span className="text-[10px] font-mono text-muted">
              App-dispatched collection & assignment messages
            </span>
          </div>

          {/* Date Selector Chips / Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted font-bold uppercase">Select Date:</span>
            {messageDates.length > 0 ? (
              <select
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-bg border border-glass-border text-text cursor-pointer"
              >
                {messageDates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-bg border border-glass-border text-text"
              />
            )}
          </div>
        </div>

        {/* Message Log Table */}
        <div className="overflow-x-auto rounded-xl border border-glass-border/40 bg-bg/30">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-bg3/30 border-b border-glass-border/40">
              <tr>
                <th className="p-2.5 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[90px]">Time</th>
                <th className="p-2.5 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[130px]">Delivery Staff</th>
                <th className="p-2.5 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[110px]">Phone Number</th>
                <th className="p-2.5 text-[10px] font-bold text-muted uppercase tracking-wider min-w-[90px]">Status</th>
                <th className="p-2.5 text-[10px] font-bold text-muted uppercase tracking-wider">Exact Dispatched App Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glass-border/30">
              {loadingMessages ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted">
                    <RefreshCw size={16} className="animate-spin mx-auto mb-1 text-emerald-400" />
                    Loading delivery boy sent message logs...
                  </td>
                </tr>
              ) : sentMessages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted italic">
                    No WhatsApp messages sent to delivery staff on {selectedDate || 'this date'}.
                  </td>
                </tr>
              ) : (
                sentMessages.map(msg => {
                  const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
                  const rawPhone = (msg.recipient_phone || '').replace(/\D/g, '');
                  const formattedPhone = rawPhone.length === 10 ? `+91 ${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}` : (rawPhone ? `+${rawPhone}` : 'N/A');

                  return (
                    <tr key={msg.id} className="hover:bg-bg3/20 transition-colors">
                      <td className="p-2.5 font-mono text-muted text-[11px] whitespace-nowrap">{timeStr}</td>
                      <td className="p-2.5 font-bold text-sky text-xs whitespace-nowrap">
                        {msg.recipient_name || 'Delivery Staff'}
                      </td>
                      <td className="p-2.5 font-mono text-muted text-xs whitespace-nowrap">{formattedPhone}</td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                          msg.status === 'sent' || msg.status === 'sent_manually'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : msg.status === 'failed'
                            ? 'bg-red-500/15 text-red-400 border-red-500/30'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        }`}>
                          {msg.status}
                        </span>
                      </td>
                      <td className="p-2.5">
                        <div className="p-2 rounded-lg bg-bg2/60 border border-glass-border/40 text-[11px] text-text font-sans whitespace-pre-wrap max-h-28 overflow-y-auto font-medium leading-relaxed">
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

      {/* New Dispatch Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel p-6 w-full max-w-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2 text-sm">
                <Truck size={16} className="text-primary" /> New Dispatch Order
              </h3>
              <button onClick={() => { setShowModal(false); setForm(emptyForm); }} className="text-muted hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Patient Name *</label>
                  <input className="premium-input w-full text-xs" placeholder="Full Name" value={form.patient_name}
                    onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Phone</label>
                  <input className="premium-input w-full text-xs font-mono" placeholder="9876543210" value={form.patient_phone}
                    onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Address</label>
                <input className="premium-input w-full text-xs" placeholder="Delivery address" value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Items / Medicines</label>
                <input className="premium-input w-full text-xs" placeholder="e.g. Metformin x2, Amlodipine x1" value={form.items}
                  onChange={e => setForm(f => ({ ...f, items: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Invoice No</label>
                  <input className="premium-input w-full text-xs font-mono" placeholder="INV-..." value={form.invoice_no}
                    onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Assign Delivery Boy</label>
                  <select className="premium-input w-full text-xs" value={form.delivery_boy_id}
                    onChange={e => setForm(f => ({ ...f, delivery_boy_id: e.target.value }))}>
                    <option value="">-- Unassigned --</option>
                    {deliveryBoys.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Notes</label>
                <input className="premium-input w-full text-xs" placeholder="Any special instructions..." value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving}
                  className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 flex-1 font-bold">
                  {saving ? 'Creating...' : 'Create Dispatch Order'}
                </button>
                <button type="button" onClick={() => { setShowModal(false); setForm(emptyForm); }}
                  className="premium-btn bg-white/5 border border-glass-border text-muted hover:bg-white/10">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
      {/* Delivery Boys Management Modal */}
      {showBoysModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="glass-panel p-6 w-full max-w-lg space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0 border-b border-glass-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-sm text-text">
                <User size={18} className="text-sky" /> Delivery Boys Management
              </h3>
              <button onClick={() => setShowBoysModal(false)} className="text-muted hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Add New Delivery Boy Form */}
            <form onSubmit={handleAddDeliveryBoy} className="p-3 bg-bg2 rounded-xl border border-glass-border space-y-2 shrink-0">
              <p className="text-xs font-bold text-sky uppercase tracking-wider">Add New Delivery Boy</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Delivery Boy Name *"
                  className="premium-input w-full text-xs"
                  value={newBoyName}
                  onChange={e => setNewBoyName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="WhatsApp Phone (e.g. 9876543210)"
                  className="premium-input w-full text-xs font-mono"
                  value={newBoyPhone}
                  onChange={e => setNewBoyPhone(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={addingBoy}
                className="w-full premium-btn bg-sky hover:bg-sky-400 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              >
                <Plus size={14} /> {addingBoy ? 'Adding...' : 'Add Delivery Boy'}
              </button>
            </form>

            {/* Delivery Boys List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <p className="text-xs font-bold text-muted uppercase tracking-wider">All Delivery Personnel ({allBoys.length})</p>
              {allBoys.length === 0 ? (
                <div className="p-6 text-center text-muted text-xs border border-dashed border-glass-border rounded-xl">
                  No delivery personnel added yet. Use the form above to add one.
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
                            placeholder="Delivery Boy Name"
                            className="premium-input w-full text-xs font-bold"
                          />
                          <input
                            type="text"
                            value={editBoyPhone}
                            onChange={e => setEditBoyPhone(e.target.value)}
                            placeholder="WhatsApp Number"
                            className="premium-input w-full text-xs font-mono"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveBoyEdit(boy.id)}
                            disabled={savingBoyEdit}
                            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg flex items-center gap-1 transition-all"
                          >
                            <Check size={12} /> {savingBoyEdit ? 'Saving...' : 'Save Phone Number'}
                          </button>
                          <button
                            onClick={() => setEditingBoyId(null)}
                            className="px-3 py-1 bg-white/5 border border-glass-border text-muted hover:text-white text-xs rounded-lg flex items-center gap-1 transition-all"
                          >
                            <X size={12} /> Cancel
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
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingBoyId(boy.id);
                              setEditBoyName(boy.name);
                              setEditBoyPhone(boy.whatsapp_number || '');
                            }}
                            className="p-1.5 rounded-lg hover:bg-sky-500/20 text-sky-400 border border-transparent hover:border-sky-500/30 transition-all"
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
                className="premium-btn bg-white/5 border border-glass-border text-xs text-muted hover:bg-white/10 px-4 py-2"
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
