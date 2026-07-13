// @ts-nocheck
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bell, 
  Plus, 
  Trash2, 
  Send, 
  Play, 
  Pause, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  RefreshCw,
  Clock, 
  Sliders,
  ExternalLink,
  MessageSquare,
  Users,
  Mail,
  Settings,
  Copy,
} from 'lucide-react';
import { api, apiClient } from '../../services/api';
import type { Refill, AutomationNotification } from '../../services/api';
import { toastEvent } from '../../services/events';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';

// Module-level cache to persist data across page navigation (unmount/remount)
let cachedRefills: Refill[] = [];
let cachedLogs: AutomationNotification[] = [];

const AutomationCenter = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'reminders' | 'logs'>('reminders');

  // Refill global notice days setting
  const [noticeDays, setNoticeDays] = useState<number>(3);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await apiClient.get('/settings');
        if (response.data && response.data.refill_notice_days) {
          setNoticeDays(parseInt(response.data.refill_notice_days, 10) || 3);
        }
      } catch (err) {
        console.error('Failed to load notice days:', err);
      }
    };
    loadSettings();
  }, []);

  const handleUpdateNoticeDays = async (val: number) => {
    const clamped = Math.max(1, Math.min(30, val));
    setNoticeDays(clamped);
    try {
      await apiClient.post('/settings/save', { refill_notice_days: String(clamped) });
      showToast(`Refill notice lead time updated to ${clamped} days.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    } catch (err) {
      console.error('Failed to save notice days:', err);
      showToast('Failed to update lead time.', 'error');
    }
  };

  // Reminders States
  const { data: refills = [], isLoading: loadingRefills, refetch: refetchRefills } = useApiQuery<Refill[]>(
    'automation-refills',
    () => api.getRefills().then(d => (Array.isArray(d) ? d.slice(0, 100) : [])),
    { enabled: activeTab === 'reminders' }
  );
  const [refillSearch, setRefillSearch] = useState('');
  const [logsSearch, setLogsSearch] = useState('');
  const [logsStatusFilter, setLogsStatusFilter] = useState('All');
  const [logsTypeFilter, setLogsTypeFilter] = useState('All');

  // Communication Logs Query
  const [logsSearchTerm, setLogsSearchTerm] = useState('');
  const logsKey = ['automation-logs', logsTypeFilter, logsStatusFilter, logsSearchTerm] as const;
  const { data: logs = [], isLoading: loadingLogs, refetch: refetchLogs } = useApiQuery<AutomationNotification[]>(
    logsKey,
    () => {
      const type = logsTypeFilter === 'All' ? undefined : logsTypeFilter;
      const status = logsStatusFilter === 'All' ? undefined : logsStatusFilter;
      return api.getAutomationNotifications({ type, status, search: logsSearchTerm || undefined, limit: 100 }).then(d => Array.isArray(d) ? d : []);
    },
    { enabled: activeTab === 'logs' }
  );


  const [editingRefillId, setEditingRefillId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [refillInterval, setRefillInterval] = useState<number>(30);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [selectedMedicines, setSelectedMedicines] = useState<Array<{ id: number; name: string }>>([]);
  const [medicineSearchResults, setMedicineSearchResults] = useState<any[]>([]);
  const [showMedicineDropdown, setShowMedicineDropdown] = useState(false);
  const [loadingMedicineSearch, setLoadingMedicineSearch] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  const [showReminderModal, setShowReminderModal] = useState(false);

  // Manual Send Details Dialog State
  const [manualSendNotification, setManualSendNotification] = useState<AutomationNotification | null>(null);

  const filteredRefills = useMemo(() => {
    const term = refillSearch.toLowerCase();
    if (!term) return refills;
    return refills.filter(r =>
      r.patient_name.toLowerCase().includes(term) ||
      r.patient_phone.includes(term) ||
      (r.medicine_name && r.medicine_name.toLowerCase().includes(term))
    );
  }, [refills, refillSearch]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    toastEvent.trigger(message, type === 'success' ? 'automation' : type, '/automation-center');
  }, []);

  // ponytail: RQ handles fetch triggering via enabled flag and key changes — no useDeferredEffect needed.

  const medicineSearchTimeout = useRef<number | null>(null);
  useEffect(() => {
    if (!medicineQuery.trim() || medicineQuery.trim().length < 2) {
      setMedicineSearchResults([]);
      setShowMedicineDropdown(false);
      setLoadingMedicineSearch(false);
      return;
    }

    if (medicineSearchTimeout.current) {
      window.clearTimeout(medicineSearchTimeout.current);
    }

    setLoadingMedicineSearch(true);
    medicineSearchTimeout.current = window.setTimeout(async () => {
      try {
        // Search from medicines table directly instead of heavy inventory master (AC3)
        const searchData = await api.searchMedicine(medicineQuery.trim());
        const medsList = Array.isArray(searchData) ? searchData : [];
        const uniqueMeds = medsList
          .map((item: any, idx: number) => {
            const name = item.name || item.medicine_name || '';
            const id = item.id || item.medicine_id || idx;
            return { id, name };
          })
          .filter((item) => item.name && !selectedMedicines.find(m => m.name === item.name))
          .slice(0, 15); // limit display to 15 items
        
        setMedicineSearchResults(uniqueMeds);
        setShowMedicineDropdown(uniqueMeds.length > 0);
      } catch (err) {
        console.error('Medicine query failed:', err);
        setMedicineSearchResults([]);
      } finally {
        setLoadingMedicineSearch(false);
      }
    }, 300);

    return () => {
      if (medicineSearchTimeout.current) window.clearTimeout(medicineSearchTimeout.current);
    };
  }, [medicineQuery, selectedMedicines]);

  const handleSelectMedicine = useCallback((med: any) => {
    // Add to selected medicines array (multi-select)
    setSelectedMedicines(prev => {
      if (!prev.find(m => m.id === med.id)) {
        return [...prev, { id: med.id, name: med.name }];
      }
      return prev;
    });
    setMedicineQuery(''); // Clear input after selection
    setShowMedicineDropdown(false);
  }, []);

  const handleRemoveMedicine = useCallback((medId: number) => {
    setSelectedMedicines(prev => prev.filter(m => m.id !== medId));
  }, []);

  const handleSaveReminder = useCallback(async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!patientName.trim()) return showToast('Patient name is required.', 'error');
    if (!patientPhone.trim()) return showToast('Phone number is required.', 'error');
    if (patientPhone.replace(/\D/g, '').length < 10) return showToast('Please enter a valid 10-digit phone number.', 'error');
    if (selectedMedicines.length === 0) return showToast('Please select at least one medicine from inventory.', 'error');
    if (refillInterval < 0 || refillInterval > 120) return showToast('Refill interval must be 0 to 120 days.', 'error');

    setModalSubmitting(true);
    const cleanPhone = patientPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    try {
      if (editingRefillId) {
        // For editing, just update the first medicine (backward compatibility)
        await api.updateRefill(editingRefillId, {
          patient_name: patientName.trim(),
          patient_phone: formattedPhone,
          medicine_id: selectedMedicines[0].id,
          refill_interval_days: refillInterval,
        });
        showToast('Prescription refill reminder updated.', 'success');
      } else {
        // Create multiple refill entries (one for each medicine)
        for (const medicine of selectedMedicines) {
          await api.createRefill({
            patient_name: patientName.trim(),
            patient_phone: formattedPhone,
            medicine_id: medicine.id,
            refill_interval_days: refillInterval,
          });
        }
        showToast(`Refill reminders created for ${selectedMedicines.length} medicine${selectedMedicines.length > 1 ? 's' : ''}.`, 'success');
      }

      setShowReminderModal(false);
      setEditingRefillId(null);
      setPatientName('');
      setPatientPhone('');
      setRefillInterval(30);
      setMedicineQuery('');
      setSelectedMedicines([]);
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    } catch (err) {
      console.error('Error saving reminder:', err);
      showToast('Failed to save refill reminder.', 'error');
    } finally {
      setModalSubmitting(false);
    }
  }, [editingRefillId, patientName, patientPhone, refillInterval, selectedMedicines, queryClient, showToast]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSaveReminder();
      return;
    }
    if (e.key === 'Escape') {
      setShowReminderModal(false);
      setEditingRefillId(null);
      setPatientName('');
      setPatientPhone('');
      setRefillInterval(30);
      setMedicineQuery('');
      setSelectedMedicines([]);
      setManualSendNotification(null);
    }
  }, [handleSaveReminder]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleEditReminderClick = useCallback((refill: Refill) => {
    setEditingRefillId(refill.id);
    setPatientName(refill.patient_name);
    setPatientPhone(refill.patient_phone);
    setRefillInterval(refill.refill_interval_days);
    // For edit mode, pre-select the current medicine
    setSelectedMedicines([{ id: refill.medicine_id, name: refill.medicine_name || `Medicine ${refill.medicine_id}` }]);
    setMedicineQuery('');
    setShowReminderModal(true);
  }, []);

  const handleToggleActive = useCallback(async (refill: Refill) => {
    const nextActive = refill.is_active === 1 ? 0 : 1;
    try {
      await api.updateRefill(refill.id, { is_active: nextActive });
      showToast(`Refill schedule is now ${nextActive === 1 ? 'Active' : 'Paused'}.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    } catch (err) {
      console.error('Failed to toggle active status:', err);
      showToast('Failed to change status. Reverting.', 'error');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    }
  }, [queryClient, showToast]);

  const handleSendNow = useCallback(async (id: number) => {
    try {
      showToast('Triggering manual message dispatch...', 'info');
      await api.sendRefillNow(id);
      showToast('Refill reminder dispatched via WhatsApp!', 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    } catch (err: any) {
      console.error('Failed to trigger send:', err);
      showToast('WhatsApp dispatch failed: ' + (err.response?.data?.error || err.message), 'error');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    }
  }, [queryClient, showToast]);

  const handleSaveIntervalInline = useCallback(async (id: number, interval: number) => {
    if (interval < 0 || interval > 120) return showToast('Interval must be 0 to 120 days.', 'error');
    try {
      await api.updateRefill(id, { refill_interval_days: interval });
      showToast('Refill interval updated.', 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    } catch (err) {
      console.error('Failed to update interval inline:', err);
      showToast('Failed to update interval.', 'error');
    }
  }, [queryClient, showToast]);

  const handleDeleteReminder = useCallback(async (id: number) => {
    if (!confirm('Are you sure you want to cancel this refill schedule?')) return;
    try {
      await api.deleteRefill(id);
      showToast('Refill schedule deleted successfully.', 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    } catch (err) {
      console.error('Failed to delete refill:', err);
      showToast('Failed to delete refill schedule.', 'error');
      queryClient.invalidateQueries({ queryKey: ['automation-refills'] });
    }
  }, [queryClient, showToast]);

  const handleRetryDispatch = useCallback(async (id: number) => {
    try {
      showToast('Retrying message dispatch...', 'info');
      await api.retryNotification(id);
      showToast('Message resent successfully!', 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    } catch (err: any) {
      console.error('Failed to retry:', err);
      showToast('Resend failed: ' + (err.response?.data?.error || err.message), 'error');
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    }
  }, [queryClient, showToast]);

  const handleCancelDispatch = useCallback(async (id: number) => {
    try {
      showToast('Cancelling notification...', 'info');
      await api.cancelNotification(id);
      showToast('Notification successfully cancelled.', 'success');
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    } catch (err: any) {
      console.error('Failed to cancel:', err);
      showToast('Cancel failed: ' + (err.response?.data?.error || err.message), 'error');
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });
    }
  }, [queryClient, showToast]);

  const handleMarkSentManually = useCallback(async (notification: AutomationNotification) => {
    try {
      await api.manualNotification(notification.id);
      showToast('Message marked as sent manually.', 'success');
      setManualSendNotification(null);
      queryClient.invalidateQueries({ queryKey: ['automation-logs'] });

      const phone = notification.recipient_phone;
      const text = encodeURIComponent(notification.message);
      const url = `https://wa.me/${phone}?text=${text}`;
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to mark sent manually:', err);
      showToast('Failed to update message status.', 'error');
    }
  }, [queryClient, showToast]);

  const handleCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  }, [showToast]);

  const getLogTypeLabel = useCallback((type: string) => {
    switch (type) {
      case 'refill_reminder':
        return 'Patient Refill';
      case 'distributor_invoice':
        return 'Invoice Summary';
      case 'delivery_boy':
        return 'Delivery Alert';
      case 'quick_order':
        return 'Quick Order Confirm';
      case 'order_ready':
        return 'Order Ready Notification';
      case 'uncollected_reminder':
        return 'Uncollected Reminder';
      default:
        return type;
    }
  }, []);

  const getLogTypeIcon = useCallback((type: string) => {
    switch (type) {
      case 'refill_reminder':
        return <Users size={14} className="text-primary" />;
      case 'distributor_invoice':
        return <Mail size={14} className="text-purple-400" />;
      case 'delivery_boy':
        return <Sliders size={14} className="text-amber-400" />;
      default:
        return <MessageSquare size={14} className="text-sky-400" />;
    }
  }, []);

  return (
    <div className="h-full flex flex-col fade-in gap-4 pb-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 bg-bg2/40 backdrop-blur-md p-5 rounded-2xl border border-glass-border/40 shadow-sm">
        <div>
          <h2 className="text-lg font-extrabold bg-gradient-to-r from-text to-sky bg-clip-text text-transparent flex items-center gap-2">
            <Sliders size={20} className="text-sky animate-pulse-slow" />
            Communication & Automation Center
          </h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">Manage patient refill intervals, monitor message delivery status logs, and configure manual retry controls.</p>
        </div>

        <div className="flex bg-bg3/50 border border-glass-border/30 rounded-xl p-1 gap-1 w-full sm:w-auto shrink-0 shadow-sm">
          <button
            onClick={() => setActiveTab('reminders')}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase flex items-center justify-center gap-2 ${
              activeTab === 'reminders'
                ? 'bg-primary/10 border border-primary/20 text-primary shadow-[0_2px_8px_rgba(34,197,94,0.06)]'
                : 'border border-transparent text-muted hover:text-text hover:bg-bg3/30'
            }`}
          >
            <Clock size={14} />
            Refills & Reminders
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase flex items-center justify-center gap-2 ${
              activeTab === 'logs'
                ? 'bg-primary/10 border border-primary/20 text-primary shadow-[0_2px_8px_rgba(34,197,94,0.06)]'
                : 'border border-transparent text-muted hover:text-text hover:bg-bg3/30'
            }`}
          >
            <MessageSquare size={14} />
            Communication Logs
          </button>
        </div>
      </div>

      {activeTab === 'reminders' && (
        <div className="flex-1 flex flex-col min-h-0 bg-bg2/30 border border-glass-border/40 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-glass-border/30 bg-bg3/30 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-3 text-muted" size={14} />
              <input
                type="text"
                value={refillSearch}
                onChange={e => setRefillSearch(e.target.value)}
                placeholder="Search patient, phone, or medicine..."
                className="premium-input pl-9 pr-4 py-2 text-xs w-full rounded-xl border-glass-border/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all"
              />
            </div>

            <div className="flex items-center gap-3.5 w-full sm:w-auto justify-end">
              <div className="flex items-center gap-2 bg-bg3/60 px-3.5 py-1.5 rounded-xl border border-glass-border/30 shadow-inner">
                <span className="text-[10px] font-black text-muted uppercase tracking-wider">Notice Days:</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={noticeDays}
                  onChange={e => handleUpdateNoticeDays(parseInt(e.target.value) || 3)}
                  className="w-12 text-center font-mono font-bold bg-bg border border-glass-border/50 rounded-lg px-1.5 py-0.5 text-text focus:outline-none focus:border-primary/40 text-xs"
                />
              </div>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['automation-refills'] })}
                className="p-2.5 rounded-xl bg-bg3 hover:bg-bg2 text-muted hover:text-text border border-glass-border/40 hover:scale-105 active:scale-95 transition-all shadow-sm"
                title="Refresh List"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => {
                  setEditingRefillId(null);
                  setPatientName('');
                  setPatientPhone('');
                  setRefillInterval(30);
                  setMedicineQuery('');
                  setSelectedMedicines([]);
                  setShowReminderModal(true);
                }}
                className="premium-btn bg-primary hover:bg-green/90 text-bg shadow-[0_4px_12px_rgba(34,197,94,0.2)] px-4 py-2 text-xs flex items-center gap-1.5 font-bold hover:scale-[1.02] active:scale-[0.98] transition-all rounded-xl"
              >
                <Plus size={14} />
                Create Refill Reminder
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-bg2/10 custom-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-bg3/85 backdrop-blur-md z-10">
                <tr>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Patient Info</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Medicine</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30 text-center">Refill Cycle (Days)</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Next Due Date</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30 text-center">Automation Status</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30 text-center">Refill Status</th>
                  <th className="p-4 text-xs font-black border-b border-glass-border/30 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/10">
                {loadingRefills ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-muted">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-sky opacity-60" />
                      Loading patient refills...
                    </td>
                  </tr>
                ) : filteredRefills.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-16 text-center text-muted font-medium">
                      <Clock size={36} className="mx-auto mb-3 text-muted/40 animate-pulse-slow" />
                      No active refill reminder schedules found.
                    </td>
                  </tr>
                ) : (
                  filteredRefills.map(refill => (
                    <tr key={refill.id} className="hover:bg-bg3/40 border-b border-glass-border/10 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-text">{refill.patient_name}</div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">{refill.patient_phone}</div>
                      </td>
                      <td className="p-4 font-semibold text-text max-w-[200px] truncate">
                        {refill.medicine_name || `Medicine ID: ${refill.medicine_id}`}
                      </td>
                      <td className="p-4 text-center">
                        <input
                          type="number"
                          min="0"
                          max="120"
                          defaultValue={refill.refill_interval_days}
                          onBlur={e => handleSaveIntervalInline(refill.id, parseInt(e.target.value) || 30)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="w-16 text-center font-mono font-bold bg-bg border border-glass-border/40 rounded-lg px-2 py-0.5 text-text focus:outline-none focus:border-primary/50 transition-colors"
                        />
                      </td>
                      <td className="p-4 font-mono font-semibold text-text select-none">
                        <span className="bg-sky/10 border border-sky/20 px-2.5 py-0.5 rounded-lg text-sky">
                          {refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString() : 'N/A'}
                        </span>
                        <div className="text-[9px] text-muted font-medium mt-1 pl-1">
                          {refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleToggleActive(refill)}
                          className={`px-3 py-1 rounded-xl text-[10px] font-extrabold border flex items-center justify-center gap-1 mx-auto transition-all duration-150 ${
                            refill.is_active === 1
                              ? 'bg-green/10 border-green/30 text-green hover:bg-green/20'
                              : 'bg-zinc-500/10 border-glass-border/30 text-muted hover:bg-bg3/60'
                          }`}
                        >
                          {refill.is_active === 1 ? <Play size={10} className="animate-pulse" /> : <Pause size={10} />}
                          {refill.is_active === 1 ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="p-4 text-center select-none">
                        {refill.status === 'pending' && refill.is_ready === 1 ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-green/15 text-green border border-green/30 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.1)]">
                            Ready (Manual Send)
                          </span>
                        ) : (
                          <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border font-mono ${
                            refill.status === 'notified'
                              ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}>
                            {refill.status}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleSendNow(refill.id)}
                            disabled={refill.is_active !== 1}
                            className="p-1.5 rounded-lg bg-sky/10 border border-sky/30 text-sky hover:bg-sky/20 disabled:opacity-40 hover:scale-105 active:scale-95 transition-all flex items-center gap-1 shadow-sm"
                            title="Send WhatsApp reminder notification immediately"
                          >
                            <Send size={12} />
                            <span className="text-[10px] font-extrabold uppercase tracking-wider">Send</span>
                          </button>
                          <button
                            onClick={() => handleEditReminderClick(refill)}
                            className="p-1.5 rounded-lg bg-bg3 border border-glass-border/40 hover:bg-bg2 text-muted hover:text-text hover:scale-105 active:scale-95 transition-all shadow-sm"
                            title="Edit reminder configuration"
                          >
                            <Settings size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteReminder(refill.id)}
                            className="p-1.5 rounded-lg bg-red/10 border border-red/20 hover:bg-red/20 hover:scale-105 active:scale-95 text-red transition-all shadow-sm"
                            title="Cancel schedule"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {activeTab === 'logs' && (
        <div className="flex-1 flex flex-col min-h-0 bg-bg2/30 border border-glass-border/40 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-glass-border/30 bg-bg3/30 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4 shrink-0">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-3 text-muted" size={14} />
              <input
                type="text"
                value={logsSearch}
                onChange={e => setLogsSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setLogsSearchTerm(logsSearch)}
                placeholder="Search logs and press Enter..."
                className="premium-input pl-9 pr-4 py-2 text-xs w-full rounded-xl border-glass-border/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted font-black uppercase">Type:</span>
                <select
                  value={logsTypeFilter}
                  onChange={e => setLogsTypeFilter(e.target.value)}
                  className="px-3 py-1.5 bg-bg border border-glass-border/60 text-xs text-text rounded-lg focus:outline-none focus:border-primary/45 transition-colors"
                >
                  <option value="All">All Types</option>
                  <option value="refill_reminder">Patient Refills</option>
                  <option value="distributor_invoice">Invoice summary</option>
                  <option value="delivery_boy">Delivery Alerts</option>
                  <option value="quick_order">Order Confirmations</option>
                  <option value="order_ready">Ready Notifications</option>
                  <option value="uncollected_reminder">Uncollected Reminders</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted font-black uppercase">Status:</span>
                <select
                  value={logsStatusFilter}
                  onChange={e => setLogsStatusFilter(e.target.value)}
                  className="px-3 py-1.5 bg-bg border border-glass-border/60 text-xs text-text rounded-lg focus:outline-none focus:border-primary/45 transition-colors"
                >
                  <option value="All">All Statuses</option>
                  <option value="sent">Sent Automatically</option>
                  <option value="failed">Failed / Queued</option>
                  <option value="sent_manually">Sent Manually</option>
                </select>
              </div>

              <button
                onClick={() => setLogsSearchTerm(logsSearch)}
                className="p-2.5 rounded-xl bg-bg3 border border-glass-border/40 hover:bg-bg2 hover:text-text text-muted hover:scale-105 active:scale-95 shadow-sm transition-all"
                title="Refresh Logs"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-bg2/10 custom-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-bg3/85 backdrop-blur-md z-10">
                <tr>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Message Type</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Recipient</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30 max-w-sm">Message Snippet</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Status</th>
                  <th className="p-4 text-xs font-black text-muted uppercase border-b border-glass-border/30">Time Dispatched</th>
                  <th className="p-4 text-xs font-black border-b border-glass-border/30 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/10">
                {loadingLogs ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-muted">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-sky opacity-60" />
                      Loading message history logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-16 text-center text-muted font-medium">
                      <MessageSquare size={36} className="mx-auto mb-3 text-muted/40 animate-pulse-slow" />
                      No matching communication records found.
                    </td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="hover:bg-bg3/40 border-b border-glass-border/10 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getLogTypeIcon(log.type)}
                          <span className="font-bold text-text">{getLogTypeLabel(log.type)}</span>
                        </div>
                        {log.reference_id && (
                          <div className="text-[9px] text-muted font-mono mt-0.5 pl-5">Ref ID: #{log.reference_id}</div>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-text">{log.recipient_name || 'System Admin'}</div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">{log.recipient_phone || 'None'}</div>
                      </td>
                      <td className="p-4 max-w-xs truncate font-semibold text-text select-text" title={log.message}>
                        {log.message}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase inline-flex items-center gap-1 border ${
                          log.status === 'sent'
                            ? 'bg-green/10 border-green/30 text-green'
                            : log.status === 'sent_manually'
                              ? 'bg-sky-500/10 border-sky-500/30 text-sky'
                              : log.status === 'pending'
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-550'
                                : log.status === 'cancelled'
                                  ? 'bg-zinc-500/10 border-glass-border/30 text-muted'
                                  : 'bg-red/10 border-red/30 text-red'
                        }`}>
                          {log.status === 'sent' && <CheckCircle2 size={10} />}
                          {log.status === 'failed' && <AlertCircle size={10} />}
                          {log.status === 'pending' && <Clock size={10} />}
                          {log.status.replace('_', ' ')}
                        </span>
                        {log.error_message && (
                          <div className="text-[9px] text-red mt-1 font-semibold max-w-[150px] truncate" title={log.error_message}>
                            Error: {log.error_message}
                          </div>
                        )}
                      </td>
                      <td className="p-4 font-mono font-semibold text-text select-none">
                        {new Date(log.created_at).toLocaleDateString()}
                        <div className="text-[9px] text-muted font-medium">
                           {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          {log.status === 'failed' && (
                            <button
                              onClick={() => handleRetryDispatch(log.id)}
                              className="p-1.5 rounded-lg bg-sky/10 border border-sky/30 hover:bg-sky/20 text-sky hover:text-white transition-all text-[10px] font-bold flex items-center gap-1 hover:scale-105 active:scale-95 shadow-sm"
                              title="Resend this message automatically via WhatsApp queue"
                            >
                              <Send size={11} />
                              Retry
                            </button>
                          )}
                          {(log.status === 'pending' || log.status === 'failed') && (
                            <button
                              onClick={() => handleCancelDispatch(log.id)}
                              className="p-1.5 rounded-lg bg-red/10 border border-red/30 hover:bg-red/20 text-red transition-all text-[10px] font-bold flex items-center gap-1 hover:scale-105 active:scale-95 shadow-sm"
                              title="Cancel this notification"
                            >
                              <Trash2 size={11} />
                              Cancel
                            </button>
                          )}
                          {log.status === 'failed' && (
                            <button
                              onClick={() => setManualSendNotification(log)}
                              className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-500 hover:text-white transition-all text-[10px] font-bold flex items-center gap-1 hover:scale-105 active:scale-95 shadow-sm"
                              title="Open manual copyable layout to dispatch to customer manually"
                            >
                              <ExternalLink size={11} />
                              Copy & Send
                            </button>
                          )}
                          {log.status !== 'pending' && log.status !== 'failed' && (
                            <span className="text-[10px] text-muted italic select-none pr-2 font-semibold">Processed</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReminderModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-bg2 border border-glass-border w-full max-w-md p-6 rounded-3xl shadow-2xl relative my-8 backdrop-blur-xl animate-zoom-in">
            <h3 className="text-base font-extrabold text-text mb-4 border-b border-glass-border/30 pb-3">
              {editingRefillId ? 'Modify Refill Reminder Configuration' : 'Register Patient Refill Schedule'}
            </h3>
            <form onSubmit={handleSaveReminder} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-wider">Patient Name *</label>
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="Patient Name"
                  className="premium-input w-full font-semibold rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-wider">Patient Phone * (WhatsApp Number)</label>
                <input
                  type="tel"
                  required
                  value={patientPhone}
                  onChange={e => setPatientPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  maxLength={10}
                  className="premium-input w-full font-mono font-semibold rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
              <div className="space-y-2 relative">
                <label className="text-[10px] font-black text-muted uppercase tracking-wider">Select Inventory Medicines * (Multiple)</label>
                <input
                  type="text"
                  value={medicineQuery}
                  onChange={e => {
                    setMedicineQuery(e.target.value);
                  }}
                  onFocus={() => { if (medicineSearchResults.length > 0) setShowMedicineDropdown(true); }}
                  placeholder="Search inventory medicines..."
                  className="premium-input w-full font-semibold rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                />
                {loadingMedicineSearch && (
                  <div className="absolute right-3 top-8">
                    <RefreshCw size={14} className="animate-spin text-sky" />
                  </div>
                )}
                {showMedicineDropdown && medicineSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-bg3 border border-glass-border rounded-xl shadow-2xl z-[10000] max-h-48 overflow-y-auto scrollbar-thin">
                    {medicineSearchResults.map((med, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectMedicine(med)}
                        className="p-2.5 border-b border-glass-border/10 hover:bg-bg2/85 transition-colors cursor-pointer text-xs font-semibold text-text flex justify-between"
                      >
                        <span>{med.name}</span>
                        {med.strength && <span className="text-[10px] text-muted">{med.strength}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {selectedMedicines.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedMedicines.map(med => (
                      <div
                        key={med.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 border border-primary/30 rounded-lg text-[11px] font-bold text-primary shadow-sm"
                      >
                        <span>{med.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMedicine(med.id)}
                          className="hover:text-primary/70 transition-colors"
                          title="Remove medicine"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-muted uppercase tracking-wider">Refill Cycle Interval (0 - 120 Days) *</label>
                  <span className="text-xs font-bold text-primary font-mono bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg">{refillInterval} days</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="120"
                    value={refillInterval}
                    onChange={e => setRefillInterval(parseInt(e.target.value) || 0)}
                    className="flex-1 accent-primary h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    required
                    value={refillInterval}
                    onChange={e => setRefillInterval(Math.max(0, Math.min(120, parseInt(e.target.value) || 0)))}
                    min="0"
                    max="120"
                    className="premium-input w-20 text-center font-mono font-semibold rounded-lg border-glass-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-4 border-t border-glass-border/30">
                <button
                  type="button"
                  onClick={() => setShowReminderModal(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-glass-border/40 text-muted hover:text-text hover:bg-bg3 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting}
                  className="premium-btn bg-primary text-bg shadow-[0_4px_12px_rgba(34,197,94,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all px-5 py-2 text-xs font-bold rounded-xl"
                >
                  {modalSubmitting ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {manualSendNotification && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-bg2 border border-glass-border w-full max-w-lg p-6 rounded-3xl shadow-2xl my-8 animate-zoom-in backdrop-blur-xl">
            <h3 className="text-base font-extrabold text-text mb-2 flex items-center gap-2">
              <ExternalLink size={18} className="text-amber-500 animate-pulse" />
              Manual WhatsApp Send Assistant
            </h3>
            <p className="text-xs text-muted mb-4 leading-relaxed">
              Since automated dispatch failed, you can manually copy this message text and share it via WhatsApp Web.
            </p>
            <div className="space-y-4">
              <div className="p-3.5 bg-bg3/40 border border-glass-border/30 rounded-2xl shadow-inner">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-muted font-black uppercase block tracking-wider">Recipient Name</span>
                    <span className="font-bold text-text">{manualSendNotification.recipient_name || 'Customer'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted font-black uppercase block tracking-wider">WhatsApp Number</span>
                    <span className="font-bold font-mono text-text">{manualSendNotification.recipient_phone}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center pr-1">
                  <span className="text-[10px] text-muted font-black uppercase tracking-wider">Message Content</span>
                  <button
                    onClick={() => handleCopyMessage(manualSendNotification.message)}
                    className="text-[10px] text-sky hover:underline font-bold flex items-center gap-1 transition-all"
                  >
                    <Copy size={11} />
                    Copy Text
                  </button>
                </div>
                <div className="p-4 bg-bg3/60 border border-glass-border/35 rounded-2xl text-xs font-semibold text-text select-all font-sans whitespace-pre-wrap leading-relaxed shadow-inner">
                  {manualSendNotification.message}
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-4 border-t border-glass-border/30">
                <button
                  type="button"
                  onClick={() => setManualSendNotification(null)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-glass-border/40 text-muted hover:text-text hover:bg-bg3 transition-colors"
                >
                  Close Assistant
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkSentManually(manualSendNotification)}
                  className="premium-btn bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-500 px-5 py-2 text-xs font-bold flex items-center gap-1.5 shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all rounded-xl"
                >
                  <Send size={13} className="animate-pulse" />
                  Open WhatsApp & Mark Sent
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default AutomationCenter;
