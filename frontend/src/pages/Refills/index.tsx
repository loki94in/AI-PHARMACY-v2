import React, { useState, useEffect, useMemo } from 'react';
import { api, apiClient } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getLocalDateString, formatDisplayDate } from '../../utils/date';
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
    <div className="h-full flex flex-col fade-in gap-4 pb-4 overflow-hidden">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 bg-bg2/40 backdrop-blur-md p-5 rounded-2xl border border-glass-border/40 shadow-sm">
        <div>
          <h2 className="text-lg font-extrabold bg-gradient-to-r from-text to-sky bg-clip-text text-transparent flex items-center gap-2">
            <Clock size={20} className="text-sky animate-pulse-slow" />
            Patient Refills Panel
          </h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            Grouped patient refills view with automated stock checking, live cart fallbacks, and WhatsApp reminders.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={handleManualCheck}
            disabled={runningCheck}
            className="premium-btn bg-bg3/65 border border-glass-border/40 hover:bg-bg2 text-text px-4 py-2 text-xs flex items-center gap-1.5 font-bold hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <RefreshCw size={13} className={runningCheck ? 'animate-spin' : ''} />
            {runningCheck ? 'Evaluating...' : 'Check Refills Engine'}
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 flex flex-col min-h-0 bg-bg2/30 border border-glass-border/40 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-glass-border/30 bg-bg3/30 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-3 text-muted" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search patient, phone, or medicine..."
              className="premium-input pl-9 pr-4 py-2 text-xs w-full rounded-xl border-glass-border/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all"
            />
          </div>
          <div className="text-xs text-muted font-bold bg-bg3/60 px-4 py-2 rounded-xl border border-glass-border/30 shadow-inner flex items-center gap-2">
            Notice Lead-time: <span className="text-sky font-extrabold font-mono">{noticeDays} Days</span>
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-bg2/10 custom-scrollbar">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted">
              <RefreshCw size={28} className="animate-spin text-sky mb-3 opacity-60" />
              <span>Loading refills panel...</span>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted gap-2">
              <Users size={36} className="text-muted/40" />
              <span className="text-xs font-medium">No pending refills matching search query.</span>
            </div>
          ) : (
            filteredPatients.map((patient) => {
              // Check if any refill is due tomorrow
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const tomorrowDateStr = getLocalDateString(tomorrow);

              const hasTomorrowRefill = patient.medicines.some(m => {
                const due = new Date(patient.next_refill_date);
                return getLocalDateString(due) === tomorrowDateStr && (m.is_ready === 1 || m.stock_verified_override === 1);
              });

              return (
                <div key={patient.patient_phone} className="p-5 rounded-2xl bg-bg2/50 border border-glass-border/30 hover:border-glass-border/50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:scale-[1.005] duration-200">
                  {/* Left Column: Patient Meta */}
                  <div className="space-y-2.5 max-w-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm shrink-0">
                        <Users size={15} />
                      </div>
                      <span className="font-bold text-text text-sm">{patient.patient_name}</span>
                    </div>
                    <div className="space-y-1.5 pl-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted font-mono">
                        <Phone size={12} className="text-muted/70" />
                        <span>{patient.patient_phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <Calendar size={12} className="text-muted/70" />
                        <span>Next Due: <strong className="text-sky font-mono font-bold bg-sky/10 border border-sky/20 px-2 py-0.5 rounded-lg">{formatDisplayDate(patient.next_refill_date)}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Middle Column: Medicines Sublist */}
                  <div className="flex-1 w-full lg:w-auto">
                    <div className="text-[10px] font-black text-muted uppercase tracking-wider mb-2.5 pl-1">Refill Medications Check</div>
                    <div className="flex flex-col gap-3">
                      {patient.medicines.map((med) => {
                        const inStock = med.in_stock_qty >= med.quantity_needed;
                        const isVerified = med.stock_verified_override === 1;
                        const readyToBill = inStock || isVerified;

                        return (
                          <div key={med.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 p-3.5 rounded-xl bg-bg3/20 border border-glass-border/20 hover:border-glass-border/30 transition-all">
                            <div className="flex flex-col">
                              <span className="font-bold text-xs text-text">{med.medicine_name}</span>
                              <span className="text-[10px] text-muted mt-1 font-semibold">
                                Needed: <span className="text-text font-mono">{med.quantity_needed}</span> · Local Stock: <span className="text-text font-mono">{med.in_stock_qty}</span>
                              </span>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 self-stretch sm:self-auto justify-between sm:justify-end">
                              {/* Stock status badge */}
                              {readyToBill ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green/10 border border-green/20 text-green text-[10px] font-black uppercase font-mono shadow-sm">
                                  <BadgeCheck size={12} className="animate-pulse" />
                                  {isVerified ? 'Stock Verified' : 'In Stock'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red/10 border border-red/20 text-red text-[10px] font-black uppercase font-mono shadow-sm">
                                  <ShieldAlert size={12} className="animate-bounce" />
                                  Out of Stock
                                </span>
                              )}

                              {/* Action tools */}
                              <div className="flex items-center gap-2">
                                {/* Verified override toggle */}
                                <label className="inline-flex items-center gap-1.5 bg-bg3 border border-glass-border/40 hover:bg-bg2 px-2.5 py-1 rounded-lg text-[10px] font-bold text-muted hover:text-text cursor-pointer select-none transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={med.stock_verified_override === 1}
                                    disabled={actionLoadingId === med.id}
                                    onChange={() => handleToggleOverride(med.id)}
                                    className="accent-primary h-3.5 w-3.5 rounded border-glass-border bg-bg"
                                  />
                                  <span>Override</span>
                                </label>

                                {/* Bill send to POS */}
                                {readyToBill ? (
                                  <button
                                    onClick={() => handleSendToPOS(patient.patient_name, patient.patient_phone, med)}
                                    className="py-1 px-3 bg-primary hover:bg-green/90 text-bg font-extrabold text-[10px] rounded-lg flex items-center gap-1.5 shadow-[0_2px_8px_rgba(34,197,94,0.2)] hover:scale-105 active:scale-95 transition-all uppercase tracking-wider"
                                  >
                                    Send to POS
                                    <ArrowRight size={11} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen()}
                                    className="py-1 px-3 bg-red/10 hover:bg-red/20 border border-red/30 text-red font-extrabold text-[10px] rounded-lg flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-all uppercase tracking-wider"
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
                        className="w-full lg:w-auto py-2.5 px-4.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0 shadow-[0_4px_12px_rgba(168,85,247,0.1)]"
                      >
                        <Send size={12} className={sendingReminderPhone === patient.patient_phone ? 'animate-bounce' : 'animate-pulse'} />
                        {sendingReminderPhone === patient.patient_phone ? 'Queuing...' : 'Send WhatsApp Reminder'}
                      </button>
                    ) : (
                      <div className="text-[10px] text-muted italic font-semibold pr-1">No tomorrow reminders eligible</div>
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
