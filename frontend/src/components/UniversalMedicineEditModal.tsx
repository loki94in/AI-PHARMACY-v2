import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, RefreshCw, AlertTriangle, Pill, Package, Factory, LayoutGrid, Barcode, Tag, MapPin, Database, ChevronDown } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  medicineId: number;
  onClose: () => void;
  onSave: () => void;
}

export const UniversalMedicineEditModal: React.FC<Props> = ({ medicineId, onClose, onSave }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [inventoryId, setInventoryId] = useState<number | null>(null);
  const [totalStock, setTotalStock] = useState<number>(0);
  const [mfgSuggestions, setMfgSuggestions] = useState<string[]>([]);
  const [showMfgSuggestions, setShowMfgSuggestions] = useState(false);

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

  useEffect(() => {
    setLoading(true);
    api.getQuickEditMedicine(medicineId)
      .then((data: any) => {
        if (data && data.medicine) {
          setForm({
            name: data.medicine.name || '',
            generic_name: data.medicine.generic_name || '',
            manufacturer: data.medicine.manufacturer || '',
            marketed_by: data.medicine.marketed_by || '',
            packaging: data.medicine.packaging || '',
            pack_unit: data.medicine.pack_unit || '',
            item_code: data.medicine.item_code || '',
            category: data.medicine.category || '',
            api_reference: data.medicine.api_reference || '',
            // Inventory primary record data
            quantity: data.inventory?.quantity || 0,
            rack_location: data.inventory?.rack_location || ''
          });
          setInventoryId(data.inventory?.inventory_id || null);
          setTotalStock(data.total_stock || 0);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev: any) => ({ ...prev, [name]: name === 'quantity' ? parseInt(value) || 0 : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateQuickEditMedicine(medicineId, {
        ...form,
        inventory_id: inventoryId
      });
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
        <div className="flex-1 overflow-y-auto p-6 scrollbar-custom">
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
              
              {/* Product Identity */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Pill size={16} className="text-primary" /> Identity & Branding
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Medicine Name *</label>
                    <input 
                      type="text" name="name" required value={form.name} onChange={handleChange}
                      className="w-full px-4 py-2.5 bg-bg3 border border-glass-border rounded-xl text-text focus:border-primary focus:outline-none transition-all font-bold text-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Generic Name (Formula)</label>
                    <input 
                      type="text" name="generic_name" value={form.generic_name} onChange={handleChange}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Category</label>
                    <div className="relative">
                      <Tag size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <select 
                        name="category" 
                        value={form.category} 
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
                </div>
              </section>

              {/* Manufacturers */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Factory size={16} className="text-amber-500" /> Manufacturing
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-muted mb-1.5">Manufacturer</label>
                    <input 
                      type="text" 
                      name="manufacturer" 
                      value={form.manufacturer} 
                      onChange={(e) => handleMfgChange(e.target.value)}
                      onFocus={(e) => handleMfgFocus(e.target.value)}
                      onBlur={() => setTimeout(() => setShowMfgSuggestions(false), 200)}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
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
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Marketed By</label>
                    <input 
                      type="text" name="marketed_by" value={form.marketed_by} onChange={handleChange}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                    />
                  </div>
                </div>
              </section>

              {/* Packaging & Logistics */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Package size={16} className="text-sky-500" /> Packaging & Codes
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Pack Size (e.g., 10x10)</label>
                    <input 
                      type="text" name="packaging" value={form.packaging} onChange={handleChange}
                      className="w-full px-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Barcode / Item Code</label>
                    <div className="relative">
                      <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input 
                        type="text" name="item_code" value={form.item_code} onChange={handleChange}
                        className="w-full pl-9 pr-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Primary Stock */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <Database size={16} className="text-emerald-500" /> Primary Stock Info
                </h4>
                {inventoryId ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
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
                          className="w-full pl-9 pr-4 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-emerald-500 focus:outline-none transition-all uppercase"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-bg2 border border-glass-border text-center text-sm text-muted">
                    No physical inventory stock recorded for this medicine yet.
                  </div>
                )}
              </section>

              {/* Notes */}
              <section>
                <h4 className="text-sm font-bold text-text uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-glass-border pb-2">
                  <LayoutGrid size={16} className="text-purple-500" /> Additional Notes
                </h4>
                <textarea 
                  name="api_reference" 
                  value={form.api_reference} 
                  onChange={handleChange}
                  rows={3}
                  placeholder="Composition details, storage instructions, or general notes..."
                  className="w-full px-4 py-3 bg-bg3 border border-glass-border rounded-xl text-sm text-text focus:border-primary focus:outline-none transition-all resize-none"
                />
              </section>

            </form>
          )}
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
