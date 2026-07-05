import React, { useState, useEffect, useMemo } from 'react';
import { api, apiClient } from '../../services/api';
import { 
  Users, Phone, Calendar, Clock, CheckCircle2, AlertCircle, ShoppingCart, 
  Send, RefreshCw, Check, Search, ArrowRight, ShieldAlert, BadgeCheck
} from 'lucide-react';
import { toastEvent, liveCartAddEvent } from '../../services/events';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

interface GroupedRefillMedicine {
  id: number;
  medicine_id: number;
  medicine_name: string;
  quantity_needed: number;
  in_stock_qty: number;
  stock_verified_override: number;
  acknowledged: number;
  hold_for_stock: number;
  is_ready: number;
  status: string;
  quick_bill_id: number | null;
}

interface GroupedRefillPatient {
  patient_name: string;
  patient_phone: string;
  next_refill_date: string;
  medicines: GroupedRefillMedicine[];
}

const RefillsPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [groupedRefills, setGroupedRefills] = useState<GroupedRefillPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [runningCheck, setRunningCheck] = useState(false);
  const [noticeDays, setNoticeDays] = useState(3);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [sendingReminderPhone, setSendingReminderPhone] = useState<string | null>(null);

  const fetchRefillsPanel = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<GroupedRefillPatient[]>('/refills/panel');
      setGroupedRefills(Array.isArray(response.data) ? response.data : []);
    } catch (err: any) {
      console.error('Failed to load refills panel:', err);
      toastEvent.trigger('Failed to load refills data.', 'error', '/refills');
    } finally {
      setLoading(false);
    }
  };

  const fetchNoticeDays = async () => {
    try {
      const response = await apiClient.get('/settings');
      if (response.data && response.data.refill_notice_days) {
        setNoticeDays(parseInt(response.data.refill_notice_days, 10) || 3);
      }
    } catch (err) {
      console.error('Failed to load notice days:', err);
    }
  };

  useEffect(() => {
    fetchRefillsPanel();
    fetchNoticeDays();
  }, []);

  const handleManualCheck = async () => {
    setRunningCheck(true);
    try {
      await apiClient.post('/refills/check');
      toastEvent.trigger('Manual refill evaluation triggered successfully.', 'success', '/refills');
      await fetchRefillsPanel();
    } catch (err: any) {
      console.error('Failed manual check:', err);
      toastEvent.trigger('Manual check failed: ' + (err.response?.data?.error || err.message), 'error', '/refills');
    } finally {
      setRunningCheck(false);
    }
  };

  const handleToggleOverride = async (refillId: number) => {
    setActionLoadingId(refillId);
    try {
      const res = await apiClient.post(`/refills/${refillId}/toggle-override`);
      const overrideVal = res.data?.stock_verified_override;
      toastEvent.trigger(
        overrideVal === 1 ? 'Physical stock verified.' : 'Physical stock verification removed.',
        'success',
        '/refills'
      );
      await fetchRefillsPanel();
    } catch (err: any) {
      console.error('Failed toggle override:', err);
      toastEvent.trigger('Failed to update override.', 'error', '/refills');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSendToPOS = (patientName: string, patientPhone: string, med: GroupedRefillMedicine) => {
    navigate('/pos', {
      state: {
        prefill: {
          patientName,
          patientPhone,
          medicineId: med.medicine_id,
          quantity: med.quantity_needed || 10
        }
      }
    });
  };

  const handleAddTomorrowReminder = async (patientPhone: string) => {
    setSendingReminderPhone(patientPhone);
    try {
      await apiClient.post('/refills/send-tomorrow-reminder', { patient_phone: patientPhone });
      toastEvent.trigger('WhatsApp reminder queued successfully.', 'success', '/refills');
      await fetchRefillsPanel();
    } catch (err: any) {
      console.error('Failed to send reminder:', err);
      toastEvent.trigger(err.response?.data?.error || 'Failed to send WhatsApp reminder.', 'error', '/refills');
    } finally {
      setSendingReminderPhone(null);
    }
  };

  const filteredPatients = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return groupedRefills;
    return groupedRefills.filter(p => 
      p.patient_name.toLowerCase().includes(query) ||
      p.patient_phone.includes(query) ||
      p.medicines.some(m => m.medicine_name.toLowerCase().includes(query))
    );
  }, [groupedRefills, searchQuery]);

  return (
    <div className="h-full flex flex-col fade-in gap-3 pb-4 overflow-hidden">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 bg-white/[0.02] p-4 rounded-2xl border border-glass-border">
        <div>
          <h2 className="text-lg font-bold bg-gradient-to-r from-text to-sky bg-clip-text text-transparent flex items-center gap-2">
            <Clock size={20} className="text-sky" />
            Patient Refills Panel
          </h2>
          <p className="text-xs text-muted mt-1">
            Grouped patient refills view with auto stock precheck, live cart fallback, and WhatsApp reminders.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={handleManualCheck}
            disabled={runningCheck}
            className="premium-btn bg-white/5 border border-glass-border hover:bg-white/10 text-text px-4 py-2 text-xs flex items-center gap-1.5 font-bold"
          >
            <RefreshCw size={13} className={runningCheck ? 'animate-spin' : ''} />
            {runningCheck ? 'Checking...' : 'Check Refills Engine'}
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 flex flex-col min-h-0 glass-panel bg-white/5 border-glass-border overflow-hidden">
        <div className="p-4 border-b border-glass-border bg-black/10 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 text-muted" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search patient, phone, medicine..."
              className="premium-input pl-9 pr-4 py-1.5 text-xs w-full"
            />
          </div>
          <div className="text-xs text-muted font-semibold bg-white/5 px-3 py-1.5 rounded-xl border border-glass-border">
            Configured notice lead-time: <span className="text-sky font-bold font-mono">{noticeDays} days</span>
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-black/10">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted">
              <RefreshCw size={28} className="animate-spin text-sky mb-3 opacity-60" />
              <span>Loading refills panel...</span>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted">
              <Users size={40} className="text-muted/40 mb-3" />
              <span>No pending refills matching search query.</span>
            </div>
          ) : (
            filteredPatients.map((patient) => {
              // Check if any refill is due tomorrow
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const tomorrowDateStr = tomorrow.toISOString().split('T')[0];

              const hasTomorrowRefill = patient.medicines.some(m => {
                const due = new Date(patient.next_refill_date);
                return due.toISOString().split('T')[0] === tomorrowDateStr && (m.is_ready === 1 || m.stock_verified_override === 1);
              });

              return (
                <div key={patient.patient_phone} className="p-5 rounded-2xl bg-bg2/40 border border-glass-border flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 transition-all hover:bg-bg2/60">
                  {/* Left Column: Patient Meta */}
                  <div className="space-y-2 max-w-sm">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-primary" />
                      <span className="font-bold text-text text-sm">{patient.patient_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted font-mono">
                      <Phone size={12} />
                      <span>{patient.patient_phone}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <Calendar size={12} />
                      <span>Next Due: <strong className="text-sky font-mono font-semibold">{new Date(patient.next_refill_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</strong></span>
                    </div>
                  </div>

                  {/* Middle Column: Medicines Sublist */}
                  <div className="flex-1 w-full lg:w-auto">
                    <div className="text-[10px] font-black text-muted uppercase tracking-wider mb-2">Refill Medications Check</div>
                    <div className="flex flex-col gap-3">
                      {patient.medicines.map((med) => {
                        const inStock = med.in_stock_qty >= med.quantity_needed;
                        const isVerified = med.stock_verified_override === 1;
                        const readyToBill = inStock || isVerified;

                        return (
                          <div key={med.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-black/20 border border-glass-border/30">
                            <div className="flex flex-col">
                              <span className="font-bold text-xs text-text">{med.medicine_name}</span>
                              <span className="text-[10px] text-muted mt-0.5 font-medium">Needed: {med.quantity_needed} units · Local Stock: {med.in_stock_qty} units</span>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 self-stretch sm:self-auto justify-between sm:justify-end">
                              {/* Stock status badge */}
                              {readyToBill ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                                  <BadgeCheck size={12} />
                                  {isVerified ? 'Stock Verified' : 'In Stock'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-red/10 border border-red/20 text-red text-[10px] font-bold">
                                  <ShieldAlert size={12} />
                                  Out of Stock
                                </span>
                              )}

                              {/* Action tools */}
                              <div className="flex items-center gap-1.5">
                                {/* Verified override toggle */}
                                <label className="inline-flex items-center gap-1.5 bg-white/5 border border-glass-border hover:bg-white/10 px-2 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-text cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={med.stock_verified_override === 1}
                                    disabled={actionLoadingId === med.id}
                                    onChange={() => handleToggleOverride(med.id)}
                                    className="accent-primary h-3.5 w-3.5 rounded"
                                  />
                                  <span>Override</span>
                                </label>

                                {/* Bill send to POS */}
                                {readyToBill ? (
                                  <button
                                    onClick={() => handleSendToPOS(patient.patient_name, patient.patient_phone, med)}
                                    className="py-1 px-3 bg-primary hover:bg-primary/95 text-white font-bold text-[10px] rounded-lg flex items-center gap-1 shadow-sm transition-all"
                                  >
                                    Send to POS
                                    <ArrowRight size={11} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen()}
                                    className="py-1 px-3 bg-red/20 hover:bg-red/30 border border-red/40 text-red font-bold text-[10px] rounded-lg flex items-center gap-1 transition-all"
                                  >
                                    <ShoppingCart size={11} />
                                    Add to Live Cart
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Collection reminders */}
                  <div className="flex flex-col gap-2 shrink-0 w-full lg:w-auto items-end">
                    {hasTomorrowRefill ? (
                      <button
                        onClick={() => handleAddTomorrowReminder(patient.patient_phone)}
                        disabled={sendingReminderPhone === patient.patient_phone}
                        className="w-full lg:w-auto py-2.5 px-4 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-[0_4px_14px_rgba(168,85,247,0.15)] shrink-0 animate-pulse-slow"
                      >
                        <Send size={12} />
                        {sendingReminderPhone === patient.patient_phone ? 'Queuing...' : 'Send WhatsApp Reminder'}
                      </button>
                    ) : (
                      <div className="text-[10px] text-muted italic font-medium">No tomorrow reminders eligible</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default RefillsPage;
