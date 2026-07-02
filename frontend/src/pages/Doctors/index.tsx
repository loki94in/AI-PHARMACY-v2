import { useEffect, useState } from 'react';
import { UserPlus, Stethoscope, Trash2, Edit2, Search, X, Phone, Building2, BadgePercent, Hash } from 'lucide-react';
import { api } from '../../services/api';

interface DoctorForm {
  name: string;
  specialization: string;
  phone: string;
  hospital: string;
  commission_percent: string;
  registration_no: string;
}

const emptyForm: DoctorForm = {
  name: '',
  specialization: '',
  phone: '',
  hospital: '',
  commission_percent: '',
  registration_no: '',
};

/* Deterministic hue from a string — used for avatar gradient & badge */
const hueFrom = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
};

const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

let cachedDoctorsList: any[] | null = null;

const Doctors = () => {
  const [doctors, setDoctors] = useState<any[]>(cachedDoctorsList || []);
  const [loading, setLoading] = useState(!cachedDoctorsList);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<DoctorForm>(emptyForm);
  const [editingDoctorId, setEditingDoctorId] = useState<number | null>(null);

  const fetchDoctors = (silent = false) => {
    if (!silent && !cachedDoctorsList) setLoading(true);
    api.getDoctors()
      .then(data => {
        setDoctors(data);
        cachedDoctorsList = data;
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchDoctors(); }, []);

  const handleChange = (field: keyof DoctorForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleEditClick = (d: any) => {
    setEditingDoctorId(d.id);
    setForm({
      name: d.name || '',
      specialization: d.speciality || d.specialization || '',
      phone: d.phone || '',
      hospital: d.hospital || '',
      commission_percent: d.commission_percent != null ? String(d.commission_percent) : '',
      registration_no: d.reg_no || d.registration_no || '',
    });
  };

  const handleCancelEdit = () => { setEditingDoctorId(null); setForm(emptyForm); };

  const handleDelete = (id: number, name: string) => {
    if (!window.confirm(`Delete Dr. ${name}?`)) return;
    // Optimistic UI update
    setDoctors(prev => {
      const next = prev.filter(d => d.id !== id);
      cachedDoctorsList = next;
      return next;
    });
    api.deleteDoctor(id)
      .catch(err => {
        console.error('Failed to delete doctor:', err);
        fetchDoctors(true);
      });
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      speciality: form.specialization.trim(),
      phone: form.phone.trim(),
      hospital: form.hospital.trim(),
      reg_no: form.registration_no.trim(),
      commission_percent: form.commission_percent ? Number(form.commission_percent) : 0,
    };
    const apiCall = editingDoctorId ? api.updateDoctor(editingDoctorId, payload) : api.addDoctor(payload);
    apiCall
      .then(() => { setForm(emptyForm); setEditingDoctorId(null); fetchDoctors(); })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  const filtered = doctors.filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const spec = d.speciality || d.specialization || '';
    const reg = d.reg_no || d.registration_no || '';
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      spec.toLowerCase().includes(q) ||
      (d.phone && d.phone.toLowerCase().includes(q)) ||
      (d.hospital && d.hospital.toLowerCase().includes(q)) ||
      reg.toLowerCase().includes(q)
    );
  });

  /* unique specializations for stats */
  const uniqueSpecs = [...new Set(doctors.map(d => d.speciality || d.specialization || '').filter(Boolean))].length;

  return (
    <div className="h-full flex flex-col gap-6 fade-in">

      {/* ── Stat Strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Doctors', value: doctors.length, icon: <Stethoscope size={18} />, color: '#3b82f6' },
          { label: 'Specializations', value: uniqueSpecs, icon: <BadgePercent size={18} />, color: '#10b981' },
          { label: 'Filtered', value: filtered.length, icon: <Search size={18} />, color: '#0ea5e9' },
          { label: 'Registered', value: doctors.filter(d => d.reg_no || d.registration_no).length, icon: <Hash size={18} />, color: '#a78bfa' },
        ].map(s => (
          <div
            key={s.label}
            className="glass-panel px-5 py-4 flex items-center gap-4"
            style={{ borderColor: `${s.color}22` }}
          >
            <div className="rounded-2xl p-2.5 flex-shrink-0" style={{ background: `${s.color}18`, color: s.color }}>
              {s.icon}
            </div>
            <div>
              <p className="text-2xl font-bold text-text">{s.value}</p>
              <p className="text-xs text-muted leading-tight">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main Layout ─────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-0">

        {/* ── Left – Form Panel ─────────────────────────────────────── */}
        <div className="md:col-span-1">
          <div className="glass-panel p-6 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="rounded-2xl p-2.5 bg-primary/10 text-primary">
                <UserPlus size={18} />
              </div>
              <div>
                <h2 className="font-bold text-text text-base leading-tight">
                  {editingDoctorId ? 'Edit Doctor' : 'Register Doctor'}
                </h2>
                <p className="text-xs text-muted">{editingDoctorId ? 'Update existing record' : 'Add a new doctor'}</p>
              </div>
              {editingDoctorId && (
                <button
                  onClick={handleCancelEdit}
                  className="ml-auto p-1.5 rounded-xl hover:bg-bg3 text-muted hover:text-text transition-colors"
                  title="Cancel edit"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Fields */}
            <div className="flex-1 space-y-4">
              {(
                [
                  { id: 'doc-name',       field: 'name',               label: 'Full Name *',           placeholder: 'Dr. Full Name',           type: 'text'   },
                  { id: 'doc-spec',       field: 'specialization',      label: 'Specialization',         placeholder: 'e.g. Cardiologist, ENT',  type: 'text'   },
                  { id: 'doc-phone',      field: 'phone',               label: 'Phone',                  placeholder: '10-digit number',         type: 'text'   },
                  { id: 'doc-hospital',   field: 'hospital',            label: 'Hospital / Clinic',      placeholder: 'Hospital or clinic name', type: 'text'   },
                  { id: 'doc-commission', field: 'commission_percent',  label: 'Commission %',           placeholder: 'e.g. 10',                 type: 'number' },
                  { id: 'doc-reg',        field: 'registration_no',     label: 'Registration No.',       placeholder: 'Medical council reg. no.',type: 'text'   },
                ] as const
              ).map(({ id, field, label, placeholder, type }) => (
                <div key={id} className="space-y-1.5">
                  <label htmlFor={id} className="text-xs font-semibold text-muted uppercase tracking-wider block">{label}</label>
                  <input
                    id={id}
                    type={type}
                    className="premium-input w-full"
                    placeholder={placeholder}
                    value={form[field as keyof DoctorForm]}
                    onChange={e => handleChange(field as keyof DoctorForm, e.target.value)}
                    min={type === 'number' ? 0 : undefined}
                    max={type === 'number' ? 100 : undefined}
                  />
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-6 space-y-2">
              <button
                id="doc-save-btn"
                className="premium-btn w-full text-white"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
              >
                {saving ? 'Saving…' : editingDoctorId ? 'Update Doctor' : 'Save Doctor'}
              </button>
              {editingDoctorId && (
                <button
                  id="doc-cancel-btn"
                  className="premium-btn bg-bg3 border border-glass-border hover:bg-bg2 text-muted hover:text-text w-full"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right – Doctor Directory ──────────────────────────────── */}
        <div className="md:col-span-2 glass-panel flex flex-col overflow-hidden">

          {/* Directory Header */}
          <div className="px-6 py-4 border-b border-glass-border flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl p-2.5 bg-sky-bg text-sky">
                <Stethoscope size={18} />
              </div>
              <h2 className="font-bold text-text">Doctor Directory</h2>
            </div>
            <div className="relative">
              <input
                id="doc-search"
                type="text"
                className="premium-input w-56"
                placeholder="Search doctors…"
                aria-label="Search doctors"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
                  onClick={() => setSearch('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Card Grid */}
          <div className="flex-1 overflow-auto p-5">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border border-glass-border bg-bg3/40 animate-pulse h-36" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted">
                <Stethoscope size={40} className="opacity-20" />
                <p className="text-sm">{search ? 'No matching doctors found.' : 'No doctors registered yet.'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filtered.map(d => {
                  const spec = d.speciality || d.specialization || '';
                  const hue = hueFrom(spec || d.name || '');
                  const avatarStyle = {
                    background: `linear-gradient(135deg, hsl(${hue},70%,50%), hsl(${(hue + 40) % 360},65%,45%))`,
                  };
                  const badgeStyle = {
                    background: `hsla(${hue},70%,55%,0.15)`,
                    color: `hsl(${hue},65%,62%)`,
                    border: `1px solid hsla(${hue},60%,55%,0.25)`,
                  };

                  return (
                    <div
                      key={d.id}
                      className="rounded-2xl border border-glass-border bg-bg3/30 hover:bg-bg3/60 transition-all duration-300 p-4 group hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      {/* Top row: avatar + name + actions */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div
                            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md"
                            style={avatarStyle}
                          >
                            {initials(d.name || '?')}
                          </div>
                          <div>
                            <p className="font-semibold text-text text-sm leading-tight">{d.name}</p>
                            {spec && (
                              <span
                                className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={badgeStyle}
                              >
                                {spec}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Action buttons */}
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            id={`doc-edit-${d.id}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleEditClick(d);
                            }}
                            className="p-1.5 rounded-xl hover:bg-primary/10 text-muted hover:text-primary transition-colors"
                            aria-label={`Edit doctor ${d.name}`}
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            id={`doc-delete-${d.id}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleDelete(d.id, d.name);
                            }}
                            className="p-1.5 rounded-xl hover:bg-red-bg text-muted hover:text-red transition-colors"
                            aria-label={`Delete doctor ${d.name}`}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Info chips */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          { icon: <Phone size={11} />, value: d.phone || null, label: 'phone' },
                          { icon: <Building2 size={11} />, value: d.hospital || null, label: 'hospital' },
                          { icon: <BadgePercent size={11} />, value: d.commission_percent != null ? `${d.commission_percent}% commission` : null, label: 'commission' },
                          { icon: <Hash size={11} />, value: d.reg_no || d.registration_no || null, label: 'reg' },
                        ].filter(c => c.value).map(chip => (
                          <div
                            key={chip.label}
                            className="flex items-center gap-1.5 text-muted text-xs bg-bg3/50 rounded-xl px-2.5 py-1.5 truncate"
                          >
                            <span className="flex-shrink-0 opacity-60">{chip.icon}</span>
                            <span className="truncate">{chip.value}</span>
                          </div>
                        ))}
                      </div>

                      {/* Footer: ID */}
                      <p className="mt-3 text-[10px] text-muted/50 font-mono">ID #{d.id}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Doctors;
