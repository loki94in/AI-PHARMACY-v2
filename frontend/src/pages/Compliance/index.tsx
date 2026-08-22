import React, { useState, useEffect } from 'react';
import { 
  Shield, Calendar, Search, Download, Printer, User, FileText, 
  AlertTriangle, RefreshCw, Filter, Edit3, Check, X
} from 'lucide-react';
import { api } from '../../services/api';
import { formatDisplayDate, toDateInputValue } from '../../utils/date';

interface ComplianceLog {
  id: number;
  date: string;
  drug_name: string;
  patient_name: string;
  doctor_name: string | null;
  license_no?: string | null;
  qty: number;
  bill_no: string;
  schedule_type: string;
  missing_license?: number;
}

let cachedComplianceStats = {
  todayH1Sales: 0,
  monthlyH1Sales: 0,
  pendingDoctorAssignments: 0,
  totalComplianceLogs: 0
};
let cachedComplianceLogs: ComplianceLog[] = [];

const CompliancePage: React.FC = () => {
  const [stats, setStats] = useState(cachedComplianceStats);
  const [logs, setLogs] = useState<ComplianceLog[]>(cachedComplianceLogs);
  const [loading, setLoading] = useState(cachedComplianceLogs.length === 0);
  const [search, setSearch] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Doctor Edit Modal
  const [editLog, setEditLog] = useState<ComplianceLog | null>(null);
  const [editDoctorName, setEditDoctorName] = useState('');
  const [editLicenseNo, setEditLicenseNo] = useState('');
  const [savingDoctor, setSavingDoctor] = useState(false);

  const fetchDashboardStats = async () => {
    try {
      const res = await api.getComplianceDashboard();
      if (res && res.success) {
        const newStats = {
          todayH1Sales: res.todayH1Sales || 0,
          monthlyH1Sales: res.monthlyH1Sales || 0,
          pendingDoctorAssignments: res.pendingDoctorAssignments || 0,
          totalComplianceLogs: res.totalComplianceLogs || 0
        };
        cachedComplianceStats = newStats;
        setStats(newStats);
      }
    } catch (err) {
      console.error('Failed to load compliance stats:', err);
    }
  };

  const fetchLogs = async () => {
    if (cachedComplianceLogs.length === 0) {
      setLoading(true);
    }
    try {
      const data = await api.getH1Register({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
        doctor: doctorFilter || undefined,
        scheduleType: scheduleFilter !== 'ALL' ? scheduleFilter : undefined
      });
      const list = data || [];
      cachedComplianceLogs = list;
      setLogs(list);
    } catch (err) {
      console.error('Failed to load H1 register:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardStats();
    fetchLogs();
  }, []);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLog || !editDoctorName.trim()) return;
    setSavingDoctor(true);
    try {
      await api.updateComplianceDoctor(editLog.id, {
        doctor_name: editDoctorName.trim(),
        license_no: editLicenseNo.trim() || undefined
      });
      setEditLog(null);
      fetchDashboardStats();
      fetchLogs();
    } catch (err) {
      console.error('Failed to update doctor details:', err);
      alert('Failed to update doctor details');
    } finally {
      setSavingDoctor(false);
    }
  };

  const handleExportCsv = () => {
    window.open('/api/compliance/export', '_blank');
  };

  const handlePrintRegister = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-glass-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-text tracking-tight">Schedule H1 Regulatory Compliance</h1>
            <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Statutory Register
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Drugs & Cosmetics Rules (Schedule H1 / H / X) dispensing logbook for statutory Drug Inspector audits.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            className="px-4 py-2 bg-bg2 border border-glass-border hover:bg-bg3 text-text rounded-xl text-xs font-bold transition-all flex items-center gap-2"
          >
            <Download size={14} className="text-emerald-400" />
            Export CSV
          </button>
          <button
            onClick={handlePrintRegister}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <Printer size={14} />
            Print Register
          </button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-bg2 border border-glass-border rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted">Today H1 Sales</p>
            <h3 className="text-2xl font-black text-text mt-1">{stats.todayH1Sales}</h3>
            <p className="text-[10px] text-emerald-400 mt-1">● Statutory Dispensed Today</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Shield size={24} />
          </div>
        </div>

        <div className="p-4 bg-bg2 border border-glass-border rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted">Monthly H1 Sales</p>
            <h3 className="text-2xl font-black text-text mt-1">{stats.monthlyH1Sales}</h3>
            <p className="text-[10px] text-muted mt-1">Current Billing Month</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
            <Calendar size={24} />
          </div>
        </div>

        <div className="p-4 bg-bg2 border border-glass-border rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted">Pending Doctor Assignments</p>
            <h3 className={`text-2xl font-black mt-1 ${stats.pendingDoctorAssignments > 0 ? 'text-amber-400' : 'text-text'}`}>
              {stats.pendingDoctorAssignments}
            </h3>
            <p className="text-[10px] text-amber-400 mt-1">Requires Prescriber Review</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
            <AlertTriangle size={24} />
          </div>
        </div>

        <div className="p-4 bg-bg2 border border-glass-border rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted">Total Statutory Logs</p>
            <h3 className="text-2xl font-black text-text mt-1">{stats.totalComplianceLogs}</h3>
            <p className="text-[10px] text-muted mt-1">All-time Logged Sales</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <FileText size={24} />
          </div>
        </div>
      </div>

      {/* Compliance Warning Banner — missing registration info */}
      {stats.pendingDoctorAssignments > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/40 rounded-2xl">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-400">
              {stats.pendingDoctorAssignments} Compliance Record{stats.pendingDoctorAssignments > 1 ? 's' : ''} Require Prescriber / Registration Review
            </p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              These Schedule H/H1/X drug sales were dispensed without a verified doctor registration number.
              Under the Drugs &amp; Cosmetics Rules, a valid prescriber registration must be recorded.
              Use the <strong>Assign Doctor</strong> button on each affected row to enter the real information.
              No fake or placeholder registration number has been stored.
            </p>
          </div>
        </div>
      )}

      {/* Filter Bar */}

      <form onSubmit={handleFilterSubmit} className="p-4 bg-bg2 border border-glass-border rounded-2xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-text uppercase tracking-wider">
          <Filter size={14} className="text-primary" /> Filter H1 Compliance Register
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">Search Keyword</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Drug, Patient or Bill #"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">Prescribing Doctor</label>
            <input
              type="text"
              placeholder="Doctor Name"
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">Schedule Type</label>
            <select
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            >
              <option value="ALL">All Restricted Schedules</option>
              <option value="H1">Schedule H1 (Restricted Antibiotics)</option>
              <option value="H">Schedule H (Prescription)</option>
              <option value="X">Schedule X (Strict Narcotics)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">Start Date</label>
            <input
              type="date"
              value={toDateInputValue(startDate)}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">End Date</label>
            <input
              type="date"
              value={toDateInputValue(endDate)}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-text focus:outline-none focus:border-primary font-medium"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDoctorFilter('');
              setScheduleFilter('ALL');
              setStartDate('');
              setEndDate('');
              fetchLogs();
            }}
            className="px-4 py-1.5 bg-bg3 hover:bg-bg border border-glass-border text-muted rounded-xl text-xs font-bold transition-all"
          >
            Reset Filters
          </button>
          <button
            type="submit"
            className="px-5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs font-bold transition-all"
          >
            Apply Filters
          </button>
        </div>
      </form>

      {/* Register Table */}
      <div className="bg-bg2 border border-glass-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-glass-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
            <FileText size={16} className="text-primary" /> Statutory Schedule H1 Sales Register
          </h3>
          <span className="text-xs text-muted font-mono">{logs.length} Logged Entries</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg3 text-muted uppercase font-bold text-[10px] tracking-wider border-b border-glass-border">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Drug Name</th>
                <th className="p-3">Schedule</th>
                <th className="p-3">Patient Name</th>
                <th className="p-3">Prescribing Doctor</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Bill No</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glass-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted">
                    <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-primary" />
                    Loading Schedule H1 register logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted">
                    No compliance logs recorded for the selected filter criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isDoctorPending = !log.doctor_name || log.doctor_name.includes('Pending') || log.doctor_name.includes('Self') || !!log.missing_license;
                  return (
                    <tr key={log.id} className="hover:bg-bg3/50 transition-colors">
                      <td className="p-3 font-mono text-muted whitespace-nowrap">{formatDisplayDate(log.date)}</td>
                      <td className="p-3 font-bold text-text">{log.drug_name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase">
                          {log.schedule_type || 'Schedule H1'}
                        </span>
                      </td>
                      <td className="p-3 font-medium text-text">{log.patient_name || 'Walk-in Customer'}</td>
                      <td className="p-3 font-medium">
                        {isDoctorPending ? (
                          <span className="text-amber-400 font-bold flex items-center gap-1">
                            <AlertTriangle size={12} /> Pending Doctor Assignment
                          </span>
                        ) : (
                          <span className="text-text font-bold">
                            Dr. {log.doctor_name}
                            {log.license_no
                              ? ` (${log.license_no})`
                              : <span className="ml-1 text-amber-400 text-[10px] font-bold"><AlertTriangle size={10} className="inline" /> Reg. No. Missing</span>
                            }
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-text">{log.qty}</td>
                      <td className="p-3 text-right font-mono text-primary font-bold">{log.bill_no || '—'}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            setEditLog(log);
                            setEditDoctorName(log.doctor_name || '');
                            setEditLicenseNo(log.license_no || '');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-bold text-[11px] border border-primary/30 transition-all flex items-center gap-1 mx-auto"
                        >
                          <Edit3 size={12} /> Assign Doctor
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Doctor Assignment Modal */}
      {editLog && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditLog(null)} />
          <div className="relative bg-bg border border-glass-border rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-glass-border pb-3">
              <div className="flex items-center gap-2">
                <User size={18} className="text-primary" />
                <h3 className="text-base font-bold text-text">Assign Prescribing Doctor</h3>
              </div>
              <button onClick={() => setEditLog(null)} className="text-muted hover:text-text">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveDoctor} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Drug Name</label>
                <input
                  type="text"
                  disabled
                  value={editLog.drug_name}
                  className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-xs text-muted font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Doctor Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Rajesh Sharma"
                  value={editDoctorName}
                  onChange={(e) => setEditDoctorName(e.target.value)}
                  className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-bold focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Doctor Medical Council Reg / License No</label>
                <input
                  type="text"
                  placeholder="e.g. MCI-99481"
                  value={editLicenseNo}
                  onChange={(e) => setEditLicenseNo(e.target.value)}
                  className="w-full px-3 py-2 bg-bg3 border border-glass-border rounded-xl text-sm text-text font-mono focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-glass-border">
                <button
                  type="button"
                  onClick={() => setEditLog(null)}
                  className="px-4 py-2 bg-bg3 border border-glass-border text-muted hover:text-text rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDoctor}
                  className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold flex items-center gap-2"
                >
                  {savingDoctor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  Save Doctor Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompliancePage;
