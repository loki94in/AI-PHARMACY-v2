// AI Learning & Automation Command Center
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import {
  Brain,
  Database,
  FileText,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Settings,
  Plus,
  Sparkles,
  Play,
  Stethoscope,
  Search,
  Truck,
  Check,
  Edit,
  GitMerge,
  Building2,
  ExternalLink,
  QrCode,
  Sliders,
  AlertCircle
} from 'lucide-react';
import { api, apiClient } from '../../services/api';
import { toastEvent } from '../../services/events';
import { shortcutEvent } from '../../services/keyboardShortcuts';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getNDaysAgoString, formatDisplayDate } from '../../utils/date';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { isValid10DigitPhone } from '../../utils/phone';

interface LearningProfileSummary {
  distributor_id: number;
  distributor_name: string;
  distributor_email: string | null;
  distributor_phone: string | null;
  last_updated: string | null;
  files_count: number;
  last_status: string | null;
}

interface ProfileDetail {
  distributor_id: number;
  file_mapping_rules: string;
  last_updated: string;
}

interface OcrCorrection {
  id: number;
  ocr: string;
  correct: string;
  created_at: string;
}

let cachedDoctorsList: any[] = [];
let cachedProfiles: LearningProfileSummary[] = [];
const cachedProfileDetailsMap: Record<number, any> = {};

const VALID_LEARNING_TABS = ['clinical', 'doctors', 'distributors', 'operations'];

const Learning: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPageVisible = usePageActive();

  const normalizeTab = (t: string | null) => {
    if (!t) return 'clinical';
    const lower = t.toLowerCase();
    if (lower === 'distributor_layouts' || lower === 'distributors') return 'distributors';
    if (lower === 'ingestion' || lower === 'operations') return 'operations';
    if (VALID_LEARNING_TABS.includes(lower)) return lower;
    return 'clinical';
  };

  const [activeTab, setActiveTab] = useState<string>(normalizeTab(searchParams.get('tab')));
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');

  // Sandbox state
  const [testBrandInput, setTestBrandInput] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testingBrand, setTestingBrand] = useState(false);

  // Custom OCR Correction state
  const [newOcrRaw, setNewOcrRaw] = useState('');
  const [newOcrCorrected, setNewOcrCorrected] = useState('');

  // Doctor Form state
  const [docName, setDocName] = useState('');
  const [docReg, setDocReg] = useState('');
  const [docPhone, setDocPhone] = useState('');
  const [docSpecialty, setDocSpecialty] = useState('');
  const [docClinic, setDocClinic] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');

  // Retrain state
  const [retraining, setRetraining] = useState(false);

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [primaryMergeId, setPrimaryMergeId] = useState<number | null>(null);
  const [secondaryMergeId, setSecondaryMergeId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Edit Distributor modal state
  const [editingDistributor, setEditingDistributor] = useState<{
    id: number;
    name: string;
    phone: string;
    email: string;
    mappingRulesStr: string;
  } | null>(null);
  const [isSavingDistributor, setIsSavingDistributor] = useState(false);
  const [shakeDistributorPhone, setShakeDistributorPhone] = useState(false);
  const [shakeDoctorPhone, setShakeDoctorPhone] = useState(false);

  // Edit Doctor modal state
  const [editingDoctor, setEditingDoctor] = useState<{
    id: number;
    name: string;
    reg_number: string;
    phone: string;
    specialty: string;
    clinic: string;
  } | null>(null);
  const [isSavingDoctor, setIsSavingDoctor] = useState(false);
  const [shakeEditDoctorPhone, setShakeEditDoctorPhone] = useState(false);

  const handleOpenEditDistributor = async (p: LearningProfileSummary) => {
    let mappingStr = '{}';
    try {
      if (cachedProfileDetailsMap[p.distributor_id]) {
        mappingStr = JSON.stringify(JSON.parse(cachedProfileDetailsMap[p.distributor_id].file_mapping_rules || '{}'), null, 2);
      } else {
        const res = await apiClient.get(`/learning/profiles/${p.distributor_id}`);
        if (res.data?.file_mapping_rules) {
          mappingStr = JSON.stringify(JSON.parse(res.data.file_mapping_rules), null, 2);
        }
      }
    } catch {
      mappingStr = '{}';
    }

    setEditingDistributor({
      id: p.distributor_id,
      name: p.distributor_name || '',
      phone: p.distributor_phone || '',
      email: p.distributor_email || '',
      mappingRulesStr: mappingStr
    });
  };

  const handleSaveDistributorDetails = async () => {
    if (!editingDistributor) return;
    if (editingDistributor.phone.trim() && !isValid10DigitPhone(editingDistributor.phone)) {
      setShakeDistributorPhone(true);
      setTimeout(() => setShakeDistributorPhone(false), 400);
      toastEvent.trigger('Distributor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }
    setIsSavingDistributor(true);
    try {
      await apiClient.put(`/distributors/${editingDistributor.id}`, {
        name: editingDistributor.name.trim(),
        phone: editingDistributor.phone.trim(),
        email: editingDistributor.email.trim()
      });

      if (editingDistributor.mappingRulesStr.trim()) {
        try {
          const parsedRules = JSON.parse(editingDistributor.mappingRulesStr);
          await apiClient.post(`/learning/profiles/${editingDistributor.id}/mapping`, {
            mappingRules: parsedRules
          });
        } catch {
          toastEvent.trigger('Invalid JSON format in OCR rules — contact details saved', 'info');
        }
      }

      toastEvent.trigger('Distributor details & OCR rules updated successfully!', 'success');
      setEditingDistributor(null);
      delete cachedProfileDetailsMap[editingDistributor.id];
      refetchProfiles();
    } catch (err: any) {
      toastEvent.trigger('Failed to update distributor: ' + (err.message || 'Server error'), 'error');
    } finally {
      setIsSavingDistributor(false);
    }
  };

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(normalizeTab(tabParam));
    }
    const idParam = searchParams.get('id') || searchParams.get('distributor_id');
    if (idParam && !isNaN(Number(idParam))) {
      setSelectedProfileId(Number(idParam));
    }
  }, [searchParams]);

  const handleTabChange = (tabId: string) => {
    const paramValue = tabId === 'distributors' ? 'distributor_layouts' : tabId;
    setActiveTab(tabId);
    setSearchParams({ tab: paramValue });
  };

  const queryClient = useQueryClient();

  // ponytail: Stagger initial mount fetches
  const [showSecondaryData, setShowSecondaryData] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowSecondaryData(true), 400);
    return () => clearTimeout(timer);
  }, []);

  // Doctors Query with module caching
  const { data: doctorsList = cachedDoctorsList, isLoading: loadingDoctors, refetch: refetchDoctors } = useApiQuery<any[]>(
    'crm-doctors',
    async () => {
      const res = await apiClient.get('/crm/doctors');
      const data = res.data || [];
      cachedDoctorsList = data;
      return data;
    },
    {
      staleTime: 300000,
      refetchOnWindowFocus: false
    }
  );

  // Learning Stats
  const { data: stats, refetch: refetchStats } = useApiQuery<{ activeOcrCorrections: number; learnedRxCombos: number; lastRetrainedAt: string | null }>(
    'learning-stats',
    () => apiClient.get('/learning/stats').then(res => res.data),
    { enabled: isPageVisible, staleTime: 60000 }
  );

  // Custom OCR Corrections list
  const { data: corrections = [], refetch: refetchCorrections } = useApiQuery<OcrCorrection[]>(
    'ocr-corrections',
    () => apiClient.get('/learning/corrections').then(res => res.data || []),
    { enabled: isPageVisible, staleTime: 60000 }
  );

  // Profiles Query with module caching
  const { data: rawProfiles = cachedProfiles, isLoading: loadingProfiles, refetch: refetchProfiles } = useApiQuery<any>(
    'learning-profiles',
    async () => {
      const res = await apiClient.get('/learning/profiles');
      const data = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.profiles) ? res.data.profiles : []);
      cachedProfiles = data;
      return data;
    },
    {
      enabled: isPageVisible && showSecondaryData,
      staleTime: 120000,
      refetchOnWindowFocus: false
    }
  );

  // Selected Profile detail query
  const { data: selectedProfileDetail } = useApiQuery<ProfileDetail | null>(
    ['learning-profile-detail', selectedProfileId],
    async () => {
      if (!selectedProfileId) return null;
      if (cachedProfileDetailsMap[selectedProfileId]) {
        return cachedProfileDetailsMap[selectedProfileId];
      }
      const res = await apiClient.get(`/learning/profiles/${selectedProfileId}`);
      const data = res.data || null;
      if (data) {
        cachedProfileDetailsMap[selectedProfileId] = data;
      }
      return data;
    },
    {
      enabled: !!selectedProfileId && isPageVisible
    }
  );

  // Retrain AI Model
  const handleRetrain = async () => {
    setRetraining(true);
    try {
      await apiClient.post('/learning/retrain');
      toastEvent.trigger('AI Clinical Model retrained successfully!', 'success');
      refetchStats();
    } catch (err: any) {
      toastEvent.trigger('Retraining failed: ' + (err.message || 'Server error'), 'error');
    } finally {
      setRetraining(false);
    }
  };

  // Test Mapping Sandbox
  const handleTestMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testBrandInput.trim()) return;
    setTestingBrand(true);
    setTestResult(null);
    try {
      const data = await api.getLearnedMapping(testBrandInput.trim());
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || 'No mapping found' });
    } finally {
      setTestingBrand(false);
    }
  };

  // Add OCR Correction Rule
  const handleAddCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOcrRaw.trim() || !newOcrCorrected.trim()) return;
    try {
      await apiClient.post('/learning/corrections', {
        raw_text: newOcrRaw.trim(),
        corrected_name: newOcrCorrected.trim()
      });
      toastEvent.trigger('OCR correction rule added', 'success');
      setNewOcrRaw('');
      setNewOcrCorrected('');
      refetchCorrections();
      refetchStats();
    } catch (err: any) {
      toastEvent.trigger('Failed to add OCR rule: ' + err.message, 'error');
    }
  };

  // Delete OCR Correction Rule
  const handleDeleteCorrection = async (id: number) => {
    try {
      await apiClient.delete(`/learning/corrections/${id}`);
      toastEvent.trigger('OCR rule deleted', 'success');
      refetchCorrections();
      refetchStats();
    } catch (err: any) {
      toastEvent.trigger('Failed to delete rule: ' + err.message, 'error');
    }
  };

  // Add Doctor
  const handleAddDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) return;
    if (docPhone.trim() && !isValid10DigitPhone(docPhone)) {
      setShakeDoctorPhone(true);
      setTimeout(() => setShakeDoctorPhone(false), 400);
      toastEvent.trigger('Doctor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }
    try {
      await apiClient.post('/crm/doctors', {
        name: docName.trim(),
        reg_number: docReg.trim(),
        phone: docPhone.trim(),
        specialty: docSpecialty.trim(),
        clinic: docClinic.trim()
      });
      toastEvent.trigger('Doctor registered successfully', 'success');
      setDocName('');
      setDocReg('');
      setDocPhone('');
      setDocSpecialty('');
      setDocClinic('');
      refetchDoctors();
    } catch (err: any) {
      toastEvent.trigger('Failed to register doctor: ' + err.message, 'error');
    }
  };

  // Delete Doctor
  const handleDeleteDoctor = async (id: number) => {
    try {
      await apiClient.delete(`/crm/doctors/${id}`);
      toastEvent.trigger('Doctor removed from directory', 'success');
      refetchDoctors();
    } catch (err: any) {
      toastEvent.trigger('Failed to remove doctor: ' + err.message, 'error');
    }
  };

  // Edit Doctor Handlers
  const handleOpenEditDoctor = (d: any) => {
    setEditingDoctor({
      id: d.id,
      name: d.name || '',
      reg_number: d.reg_number || d.reg_no || '',
      phone: d.phone || '',
      specialty: d.specialty || d.speciality || '',
      clinic: d.clinic || d.hospital || ''
    });
  };

  const handleSaveDoctorDetails = async () => {
    if (!editingDoctor) return;
    if (!editingDoctor.name.trim()) {
      toastEvent.trigger('Doctor name is required', 'error');
      return;
    }
    if (editingDoctor.phone.trim() && !isValid10DigitPhone(editingDoctor.phone)) {
      setShakeEditDoctorPhone(true);
      setTimeout(() => setShakeEditDoctorPhone(false), 400);
      toastEvent.trigger('Doctor phone number must be exactly 10 digits (or leave blank)', 'error');
      return;
    }

    setIsSavingDoctor(true);
    try {
      await apiClient.put(`/crm/doctors/${editingDoctor.id}`, {
        name: editingDoctor.name.trim(),
        reg_number: editingDoctor.reg_number.trim(),
        phone: editingDoctor.phone.trim(),
        specialty: editingDoctor.specialty.trim(),
        clinic: editingDoctor.clinic.trim()
      });
      toastEvent.trigger('Doctor details updated successfully', 'success');
      setEditingDoctor(null);
      refetchDoctors();
    } catch (err: any) {
      toastEvent.trigger('Failed to update doctor: ' + (err.message || 'Server error'), 'error');
    } finally {
      setIsSavingDoctor(false);
    }
  };

  // Execute Profile Merge
  const handleMergeProfiles = async () => {
    if (!primaryMergeId || !secondaryMergeId || primaryMergeId === secondaryMergeId) {
      toastEvent.trigger('Please select two distinct distributor profiles to merge', 'error');
      return;
    }
    setIsMerging(true);
    try {
      await apiClient.post('/learning/profiles/merge', {
        primaryId: primaryMergeId,
        secondaryId: secondaryMergeId
      });
      toastEvent.trigger('Distributor profiles merged successfully!', 'success');
      setShowMergeModal(false);
      setPrimaryMergeId(null);
      setSecondaryMergeId(null);
      refetchProfiles();
    } catch (err: any) {
      toastEvent.trigger('Failed to merge profiles: ' + err.message, 'error');
    } finally {
      setIsMerging(false);
    }
  };

  // Ensure defensive arrays
  const profilesList: LearningProfileSummary[] = Array.isArray(rawProfiles)
    ? rawProfiles
    : (Array.isArray((rawProfiles as any)?.profiles) ? (rawProfiles as any).profiles : []);
  const doctorsArray: any[] = Array.isArray(doctorsList)
    ? doctorsList
    : (Array.isArray((doctorsList as any)?.doctors) ? (doctorsList as any).doctors : []);
  const correctionsArray: OcrCorrection[] = Array.isArray(corrections)
    ? corrections
    : (Array.isArray((corrections as any)?.corrections) ? (corrections as any).corrections : []);

  // Filtered Doctors
  const filteredDoctors = doctorsArray.filter((d: any) => {
    if (!doctorSearch.trim()) return true;
    const q = doctorSearch.toLowerCase();
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.reg_number && d.reg_number.toLowerCase().includes(q)) ||
      (d.specialty && d.specialty.toLowerCase().includes(q)) ||
      (d.clinic && d.clinic.toLowerCase().includes(q))
    );
  });

  // Filtered Profiles
  const filteredProfiles = profilesList.filter(p => {
    if (!profileSearchQuery.trim()) return true;
    const q = profileSearchQuery.toLowerCase();
    return (
      (p.distributor_name && p.distributor_name.toLowerCase().includes(q)) ||
      (p.distributor_email && p.distributor_email.toLowerCase().includes(q)) ||
      (p.distributor_phone && p.distributor_phone.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg2 border border-border rounded-2xl p-3 px-4 shadow-sm">
        {/* Title & Retrain Action */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Brain size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-text leading-none">AI Learning & Automation Hub</h1>
              <p className="text-[11px] text-muted mt-0.5">Clinical model, OCR rules, doctors & distributor layout parser</p>
            </div>
          </div>

          <button
            onClick={handleRetrain}
            disabled={retraining}
            className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw size={13} className={retraining ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{retraining ? 'Retraining...' : 'Retrain AI'}</span>
          </button>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/40 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {[
            { id: 'clinical', label: 'Clinical AI & OCR Rules', icon: Brain },
            { id: 'doctors', label: 'Doctor Directory', icon: Stethoscope },
            { id: 'distributors', label: 'Distributor OCR Layouts', icon: Database },
            { id: 'operations', label: 'Scanner Sandbox', icon: QrCode },
          ].map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleTabChange(t.id)}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-primary' : 'text-muted'} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Clinical AI & OCR Rules */}
      {activeTab === 'clinical' && (
        <div className="space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-xl p-4 flex items-center gap-3">
              <div className="p-3 rounded-lg bg-sky/10 text-sky border border-sky/20">
                <Brain size={20} />
              </div>
              <div>
                <div className="text-xs text-muted font-medium">Active OCR Correction Rules</div>
                <div className="text-xl font-bold text-text mt-0.5">
                  {stats?.activeOcrCorrections ?? correctionsArray.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-xl p-4 flex items-center gap-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="text-xs text-muted font-medium">Learned Rx Combinations</div>
                <div className="text-xl font-bold text-text mt-0.5">
                  {stats?.learnedRxCombos ?? 0}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-xl p-4 flex items-center gap-3">
              <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <RefreshCw size={20} />
              </div>
              <div>
                <div className="text-xs text-muted font-medium">Last Clinical Retrain</div>
                <div className="text-xs font-bold text-text mt-1">
                  {stats?.lastRetrainedAt ? formatDisplayDate(stats.lastRetrainedAt) : 'Ready for training'}
                </div>
              </div>
            </div>
          </div>

          {/* Test Mapping Sandbox */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-text font-bold text-base">
              <Sparkles size={18} className="text-primary" />
              OCR Database Mapping Sandbox
            </div>
            <p className="text-xs text-muted">
              Test how raw scanned text from cameras or invoice OCR resolves to master database products.
            </p>

            <form onSubmit={handleTestMapping} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter raw scanned text (e.g. D0L0 650, CROC1N)..."
                value={testBrandInput}
                onChange={e => setTestBrandInput(e.target.value)}
                className="flex-1 bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={testingBrand}
                className="px-4 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testingBrand ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                Test Resolution
              </button>
            </form>

            {testResult && (
              <div className={`p-4 rounded-xl border text-xs ${testResult.mapped ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                {testResult.mapped ? (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> Correctly Mapped to Master Medicine:
                    </div>
                    <div className="text-sm font-black text-text pl-5">{testResult.medicine?.name}</div>
                    <div className="pl-5 text-muted text-[11px]">
                      MRP: ₹{testResult.medicine?.mrp} | Rate: ₹{testResult.medicine?.rate} | GST: {testResult.medicine?.cgst_per + testResult.medicine?.sgst_per}%
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} />
                    <span>{testResult.error || 'No automatic match found. Add a custom OCR rule below to map this brand.'}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add OCR Rule & Registry */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-text">OCR Text Correction Registry</h3>
                <p className="text-xs text-muted mt-0.5">Define custom raw OCR text mappings to correct brand names.</p>
              </div>
            </div>

            {/* Add Rule Form */}
            <form onSubmit={handleAddCorrection} className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-2">
              <input
                type="text"
                placeholder="Scanned Raw OCR Text (e.g. D0L0 650)"
                value={newOcrRaw}
                onChange={e => setNewOcrRaw(e.target.value)}
                className="sm:col-span-2 bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                placeholder="Corrected Master Medicine Name (e.g. Dolo 650mg)"
                value={newOcrCorrected}
                onChange={e => setNewOcrCorrected(e.target.value)}
                className="sm:col-span-2 bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="bg-emerald-500 text-white font-bold text-xs rounded-xl px-4 py-2.5 hover:bg-emerald-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} /> Add Rule
              </button>
            </form>

            {/* Corrections Table */}
            <div className="overflow-x-auto rounded-xl border border-border mt-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-bg2 text-muted font-bold border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Raw Scanned OCR Text</th>
                    <th className="py-3 px-4">Mapped Correct Name</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {correctionsArray.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted italic">
                        No custom OCR correction rules defined yet.
                      </td>
                    </tr>
                  ) : (
                    correctionsArray.map(c => (
                      <tr key={c.id} className="hover:bg-bg2/50 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-bold text-amber-400">{c.ocr}</td>
                        <td className="py-2.5 px-4 font-bold text-text">{c.correct}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => handleDeleteCorrection(c.id)}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Delete OCR Rule"
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
        </div>
      )}

      {/* TAB 2: Doctor Directory */}
      {activeTab === 'doctors' && (
        <div className="space-y-6">
          {/* Add Doctor Card */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-text font-bold text-base">
              <Stethoscope size={18} className="text-primary" />
              Register Medical Practitioner / Doctor
            </div>
            <p className="text-xs text-muted">
              Add doctor credentials to enable automatic doctor selection and prescription mapping.
            </p>

            <form onSubmit={handleAddDoctor} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
              <input
                type="text"
                placeholder="Doctor Name (e.g. Dr. A. Sharma)"
                value={docName}
                onChange={e => setDocName(e.target.value)}
                className="sm:col-span-2 bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
                required
              />
              <input
                type="text"
                placeholder="Reg. Number (e.g. MCI-98765)"
                value={docReg}
                onChange={e => setDocReg(e.target.value)}
                className="bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
              <PhoneInputWithBadge
                value={docPhone}
                onChange={val => setDocPhone(val)}
                placeholder="Phone (10 digits)"
                shakeOnError={shakeDoctorPhone}
                allowEmpty={true}
              />
              <input
                type="text"
                placeholder="Specialty (e.g. Cardiologist)"
                value={docSpecialty}
                onChange={e => setDocSpecialty(e.target.value)}
                className="bg-bg border border-border rounded-xl px-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="bg-primary text-white font-bold text-xs rounded-xl px-4 py-2.5 hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} /> Add Doctor
              </button>
            </form>
          </div>

          {/* Search & Doctors Directory */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-text">Doctor Registry Directory</h3>
                <p className="text-xs text-muted mt-0.5">Manage registered doctors and clinical affiliations.</p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-3 text-muted" />
                <input
                  type="text"
                  placeholder="Search doctors..."
                  value={doctorSearch}
                  onChange={e => setDoctorSearch(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-bg2 text-muted font-bold border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Doctor Name</th>
                    <th className="py-3 px-4">Reg / License #</th>
                    <th className="py-3 px-4">Specialty</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDoctors.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted italic">
                        {loadingDoctors ? 'Loading doctor registry...' : 'No doctors registered yet.'}
                      </td>
                    </tr>
                  ) : (
                    filteredDoctors.map((d: any) => (
                      <tr key={d.id} className="hover:bg-bg2/50 transition-colors">
                        <td className="py-2.5 px-4 font-bold text-text flex items-center gap-2">
                          <Stethoscope size={14} className="text-sky shrink-0" />
                          {d.name}
                        </td>
                        <td className="py-2.5 px-4 text-muted font-mono">{d.reg_number || 'N/A'}</td>
                        <td className="py-2.5 px-4 text-text">{d.specialty || 'General Practitioner'}</td>
                        <td className="py-2.5 px-4 text-muted">{d.phone || 'N/A'}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => handleOpenEditDoctor(d)}
                            className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer border border-border mr-1.5"
                            title="Edit Doctor Details & Credentials"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteDoctor(d.id)}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer border border-rose-500/20"
                            title="Remove Doctor"
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
        </div>
      )}

      {/* TAB 3: Distributor OCR Layouts */}
      {activeTab === 'distributors' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-text">Distributor OCR Layout Profiles</h2>
              <p className="text-xs text-muted mt-0.5">
                Saved distributor OCR column parsing rules learned from invoices and CSV files.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMergeModal(true)}
                className="px-3.5 py-2 bg-bg2 border border-border text-text font-bold text-xs rounded-xl hover:border-primary/50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <GitMerge size={14} className="text-amber-400" />
                Merge Profiles
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-3.5 text-muted" />
            <input
              type="text"
              placeholder="Search distributor profiles..."
              value={profileSearchQuery}
              onChange={e => setProfileSearchQuery(e.target.value)}
              className="w-full bg-glass-bg border border-glass-border rounded-xl pl-10 pr-4 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary"
            />
          </div>

          {/* Profiles Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProfiles.length === 0 ? (
              <div className="col-span-full bg-glass-bg border border-glass-border rounded-2xl p-8 text-center text-muted text-xs">
                {loadingProfiles ? 'Loading distributor profiles...' : 'No distributor OCR profiles found matching query.'}
              </div>
            ) : (
              filteredProfiles.map(p => {
                const isSelected = selectedProfileId === p.distributor_id;
                return (
                  <div
                    key={p.distributor_id}
                    onClick={() => setSelectedProfileId(p.distributor_id)}
                    className={`
                      bg-glass-bg border rounded-2xl p-4 cursor-pointer transition-all duration-200 space-y-3
                      ${isSelected ? 'border-primary shadow-md shadow-primary/10' : 'border-glass-border hover:border-primary/40'}
                    `}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                          <Building2 size={18} />
                        </div>
                        <div>
                          <div className="font-bold text-text text-sm truncate max-w-[180px]">
                            {p.distributor_name}
                          </div>
                          <div className="text-[10px] text-muted">ID #{p.distributor_id}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditDistributor(p);
                          }}
                          className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer border border-border"
                          title="Edit Distributor Profile & OCR Rules"
                        >
                          <Edit size={14} />
                        </button>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                          {p.files_count} files learned
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-muted space-y-1 pt-1 border-t border-border/50">
                      {p.distributor_phone && <div>📞 {p.distributor_phone}</div>}
                      {p.distributor_email && <div>✉️ {p.distributor_email}</div>}
                      <div className="text-[10px] text-muted">
                        Updated: {p.last_updated ? formatDisplayDate(p.last_updated) : 'N/A'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selected Profile Mapping Detail */}
          {selectedProfileId && selectedProfileDetail && (
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-text text-base flex items-center gap-2">
                  <Sliders size={18} className="text-primary" />
                  Mapping Rules Configuration (Distributor #{selectedProfileId})
                </div>
                <button
                  onClick={() => setSelectedProfileId(null)}
                  className="text-muted hover:text-text cursor-pointer p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <pre className="p-4 bg-bg border border-border rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-60 scrollbar-thin">
                {JSON.stringify(JSON.parse(selectedProfileDetail.file_mapping_rules || '{}'), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Document Scanner Sandbox */}
      {activeTab === 'operations' && (
        <div className="space-y-6">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-text font-bold text-base">
              <QrCode size={18} className="text-primary" />
              Invoice & Document OCR Scanner Playground
            </div>
            <p className="text-xs text-muted">
              Simulate file uploads or scan QR codes to test real-time OCR extraction logic without writing to main stock tables.
            </p>

            <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-8 text-center space-y-3 bg-bg/50 transition-colors cursor-pointer">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto">
                <QrCode size={24} />
              </div>
              <div>
                <div className="font-bold text-text text-sm">Drop PDF Invoice or Scan QR Image</div>
                <div className="text-xs text-muted mt-1">Supports PDF, PNG, JPG, and CSV invoice files</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MERGE MODAL PORTAL */}
      {showMergeModal && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <GitMerge size={18} className="text-amber-400" />
                Merge Duplicate Distributor Profiles
              </div>
              <button
                onClick={() => setShowMergeModal(false)}
                className="text-muted hover:text-text cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted">
              Select the primary profile to retain and the secondary profile to merge into it.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Primary Profile (Keep)</label>
                <select
                  value={primaryMergeId || ''}
                  onChange={e => setPrimaryMergeId(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary"
                >
                  <option value="">Select Primary Distributor...</option>
                  {profilesList.map(p => (
                    <option key={p.distributor_id} value={p.distributor_id}>
                      {p.distributor_name} (#{p.distributor_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Secondary Profile (Merge & Remove)</label>
                <select
                  value={secondaryMergeId || ''}
                  onChange={e => setSecondaryMergeId(Number(e.target.value))}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary"
                >
                  <option value="">Select Secondary Distributor...</option>
                  {profilesList.filter(p => p.distributor_id !== primaryMergeId).map(p => (
                    <option key={p.distributor_id} value={p.distributor_id}>
                      {p.distributor_name} (#{p.distributor_id})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleMergeProfiles}
                disabled={isMerging || !primaryMergeId || !secondaryMergeId}
                className="px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-xs cursor-pointer hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isMerging ? <RefreshCw size={14} className="animate-spin" /> : <GitMerge size={14} />}
                Confirm Merge
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT DISTRIBUTOR MODAL PORTAL */}
      {editingDistributor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Edit size={18} className="text-primary" />
                Edit Distributor Profile & OCR Rules
              </div>
              <button
                onClick={() => setEditingDistributor(null)}
                className="text-muted hover:text-text cursor-pointer p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Distributor Name *</label>
                <input
                  type="text"
                  value={editingDistributor.name}
                  onChange={e => setEditingDistributor({ ...editingDistributor, name: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PhoneInputWithBadge
                  label="Phone Number"
                  value={editingDistributor.phone}
                  onChange={val => setEditingDistributor({ ...editingDistributor, phone: val })}
                  shakeOnError={shakeDistributorPhone}
                  allowEmpty={true}
                />
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Email Address</label>
                  <input
                    type="email"
                    value={editingDistributor.email}
                    onChange={e => setEditingDistributor({ ...editingDistributor, email: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">OCR Column Mapping Rules (JSON)</label>
                <textarea
                  rows={6}
                  value={editingDistributor.mappingRulesStr}
                  onChange={e => setEditingDistributor({ ...editingDistributor, mappingRulesStr: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-primary scrollbar-thin"
                  placeholder='{ "item_name": "Product", "quantity": "Qty", "mrp": "MRP" }'
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setEditingDistributor(null)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDistributorDetails}
                disabled={isSavingDistributor || !editingDistributor.name.trim()}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingDistributor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT DOCTOR MODAL PORTAL */}
      {editingDoctor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Stethoscope size={18} className="text-primary" />
                Edit Doctor Details & Credentials
              </div>
              <button
                onClick={() => setEditingDoctor(null)}
                className="text-muted hover:text-text cursor-pointer p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-text block mb-1">Doctor Full Name *</label>
                <input
                  type="text"
                  value={editingDoctor.name}
                  onChange={e => setEditingDoctor({ ...editingDoctor, name: e.target.value })}
                  placeholder="e.g. Dr. A. K. Sharma"
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Reg / License No.</label>
                  <input
                    type="text"
                    value={editingDoctor.reg_number}
                    onChange={e => setEditingDoctor({ ...editingDoctor, reg_number: e.target.value })}
                    placeholder="e.g. MCI-98765"
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text block mb-1">Specialty</label>
                  <input
                    type="text"
                    value={editingDoctor.specialty}
                    onChange={e => setEditingDoctor({ ...editingDoctor, specialty: e.target.value })}
                    placeholder="e.g. Cardiologist"
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <PhoneInputWithBadge
                  label="Phone Number"
                  value={editingDoctor.phone}
                  onChange={val => setEditingDoctor({ ...editingDoctor, phone: val })}
                  shakeOnError={shakeEditDoctorPhone}
                  allowEmpty={true}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-text block mb-1">Clinic / Hospital Affiliation</label>
                <input
                  type="text"
                  value={editingDoctor.clinic}
                  onChange={e => setEditingDoctor({ ...editingDoctor, clinic: e.target.value })}
                  placeholder="e.g. City Care Hospital"
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setEditingDoctor(null)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDoctorDetails}
                disabled={isSavingDoctor || !editingDoctor.name.trim()}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingDoctor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Learning;
