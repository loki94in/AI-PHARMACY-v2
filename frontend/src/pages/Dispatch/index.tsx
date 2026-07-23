import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Truck, Package, Clock, CheckCircle, MapPin, Plus, X, User, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { api } from '../../services/api';
import { toastEvent } from '../../services/events';

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

// Module-level cache for instant re-mount
let cachedOrders: DispatchOrder[] | null = null;
let cachedDeliveryBoys: DeliveryBoy[] | null = null;

const Dispatch = () => {
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
    setLoading(true);
    try {
      const [ordersData, boysData] = await Promise.all([
        api.getDispatchOrders(),
        api.getDeliveryBoys(),
      ]);
      const ordersArr = Array.isArray(ordersData) ? ordersData : [];
      const rawBoys = Array.isArray(boysData) ? boysData : [];
      const activeBoysArr = rawBoys.filter((b: DeliveryBoy) => b.is_active);
      cachedOrders = ordersArr;
      cachedDeliveryBoys = activeBoysArr;
      setOrders(ordersArr);
      setAllBoys(rawBoys);
      setDeliveryBoys(activeBoysArr);
    } catch (err) {
      console.error('Dispatch fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
      showNotif(`Delivery boy "${newBoyName}" added successfully!`);
      setNewBoyName('');
      setNewBoyPhone('');
      fetchAll();
    } catch { showNotif('Failed to add delivery boy', 'error'); }
    finally { setAddingBoy(false); }
  };

  const handleToggleBoyActive = async (boy: DeliveryBoy) => {
    try {
      const newActive = boy.is_active ? 0 : 1;
      await api.updateDeliveryBoy(boy.id, { is_active: newActive });
      showNotif(`Delivery boy "${boy.name}" ${newActive ? 'activated' : 'deactivated'}`);
      fetchAll();
    } catch { showNotif('Failed to update status', 'error'); }
  };

  const handleDeleteBoy = async (id: number, name: string) => {
    if (!confirm(`Delete delivery boy "${name}"?`)) return;
    try {
      await api.deleteDeliveryBoy(id);
      showNotif(`Delivery boy "${name}" deleted`);
      fetchAll();
    } catch { showNotif('Failed to delete delivery boy', 'error'); }
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

  const pending = orders.filter(o => o.status === 'Pending').length;
  const inTransit = orders.filter(o => o.status === 'In Transit').length;
  const deliveredToday = orders.filter(o => {
    if (o.status !== 'Delivered' || !o.delivered_at) return false;
    return new Date(o.delivered_at).toDateString() === new Date().toDateString();
  }).length;

  return (
    <div className="h-full flex flex-col p-6 gap-3 pb-4 animate-in fade-in duration-500">


      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight mb-1">Dispatch & Delivery</h2>
          <p className="text-muted text-sm">Manage and track home delivery assignments & delivery personnel.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2 rounded-lg bg-white/5 border border-glass-border hover:bg-white/10 text-muted" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowBoysModal(true)}
            className="premium-btn bg-sky/20 border border-sky/30 text-sky hover:bg-sky/30 text-xs flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold transition-all"
          >
            <User size={15} /> Delivery Boys ({allBoys.length})
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600"
          >
            <Plus size={16} /> New Dispatch
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Clock size={24} className="text-amber-400" />
          </div>
          <div>
            <p className="text-xs text-muted font-bold uppercase tracking-wider mb-1">Pending Deliveries</p>
            <p className="text-2xl font-extrabold text-amber-400">{pending}</p>
          </div>
        </div>
        <div className="glass-panel p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-sky/10 flex items-center justify-center">
            <Truck size={24} className="text-sky" />
          </div>
          <div>
            <p className="text-xs text-muted font-bold uppercase tracking-wider mb-1">In Transit</p>
            <p className="text-2xl font-extrabold text-sky">{inTransit}</p>
          </div>
        </div>
        <div className="glass-panel p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green/10 flex items-center justify-center">
            <CheckCircle size={24} className="text-green" />
          </div>
          <div>
            <p className="text-xs text-muted font-bold uppercase tracking-wider mb-1">Delivered Today</p>
            <p className="text-2xl font-extrabold text-green">{deliveredToday}</p>
          </div>
        </div>
      </div>

      {/* Dispatch Queue Table */}
      <div className="glass-panel flex-1 flex flex-col overflow-hidden">
        <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5">
          <h3 className="font-bold flex items-center gap-2 text-sm">
            <Package size={16} className="text-primary" /> Dispatch Queue
          </h3>
        </div>
        <div className="flex-1 overflow-auto bg-black/20">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#18181b]/95 backdrop-blur z-10">
              <tr>
                {['Patient', 'Phone', 'Items', 'Address', 'Delivery Boy', 'Invoice', 'Status', 'Actions'].map(h => (
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
                  No dispatch orders yet. Click "New Dispatch" to create one.
                </td></tr>
              ) : orders.map(order => (
                <tr key={order.id} className="hover:bg-white/5 border-b border-glass-border/30 transition-all">
                  <td className="p-3 font-semibold text-text">{order.patient_name}</td>
                  <td className="p-3 font-mono text-muted">{order.patient_phone || '-'}</td>
                  <td className="p-3 text-muted max-w-[140px] truncate">{order.items || '-'}</td>
                  <td className="p-3 text-muted max-w-[130px] truncate flex items-start gap-1">
                    {order.address ? <><MapPin size={11} className="mt-0.5 shrink-0 text-muted/50" />{order.address}</> : '-'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <User size={11} className="text-muted" />
                      <span className={order.delivery_boy_name ? 'text-sky font-semibold' : 'text-muted'}>
                        {order.delivery_boy_name || 'Unassigned'}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-muted">{order.invoice_no || '-'}</td>
                  <td className="p-3">
                    <select
                      value={order.status}
                      onChange={e => handleStatusChange(order.id, e.target.value)}
                      className={`text-[10px] font-bold px-2 py-1 rounded border cursor-pointer bg-transparent ${statusStyles[order.status]}`}
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Transit">In Transit</option>
                      <option value="Delivered">Delivered</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button onClick={() => handleDelete(order.id)}
                      className="p-1.5 rounded hover:bg-red/20 text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-glass-border bg-black/10 text-[10px] text-muted px-4">
          Total Orders: <strong>{orders.length}</strong> | Active: <strong>{pending + inTransit}</strong>
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
                  <div key={boy.id} className="flex items-center justify-between p-3 rounded-xl bg-bg border border-glass-border hover:border-sky/40 transition-all">
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
