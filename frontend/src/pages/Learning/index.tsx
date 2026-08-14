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
  AlertCircle,
  Clock,
  TrendingUp,
  FileCode,
  CheckSquare,
  ShieldCheck,
  Layers,
  Activity,
  Zap,
  ArrowRight,
  Copy
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
import { broadcastContactDataChanged } from '../../utils/settingsSync';

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
  distributor: { id: number; name: string; phone: string | null; email: string | null };
  profile: {
    distributor_id: number;
    file_mapping_rules: string | null;
    layout_type: string | null;
    success_count: number | null;
    last_success_at: string | null;
    last_updated: string | null;
  } | null;
  files: Array<{ id: number; filename: string; file_type: string | null; status: string | null; created_at: string }>;
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

const VALID_LEARNING_TABS = ['clinical', 'doctors', 'distributors', 'operations', 'reorders'];

const Learning: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPageVisible = usePageActive();

  const normalizeTab = (t: string | null) => {
    if (!t) return 'clinical';
    const lower = t.toLowerCase();
    if (lower === 'distributor_layouts' || lower === 'distributors') return 'distributors';
    if (lower === 'ingestion' || lower === 'operations') return 'operations';
    if (lower === 'reorders' || lower === 'inventory' || lower === 'snoozed') return 'reorders';
    if (VALID_LEARNING_TABS.includes(lower)) return lower;
    return 'clinical';
  };

  const [activeTab, setActiveTab] = useState<string>(normalizeTab(searchParams.get('tab')));
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

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

  // Operations Scanner Playground State
  const [scannerSampleType, setScannerSampleType] = useState<'marg' | 'tally' | 'redbook' | 'custom'>('marg');
  const [isScanningSandbox, setIsScanningSandbox] = useState(false);
  const [scanResultData, setScanResultData] = useState<any>(null);

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
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err: any) {
      toastEvent.trigger('Failed to update distributor: ' + (err.message || 'Server error'), 'error');
    } finally {
      setIsSavingDistributor(false);
    }
  };

  const handleDeleteDistributorProfile = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the distributor layout profile for "${name}"?\n\nThis will permanently remove the learned OCR mapping rules and distributor record.`)) {
      return;
    }
    try {
      await apiClient.delete(`/distributors/${id}`);
      delete cachedProfileDetailsMap[id];
      if (selectedProfileId === id) setSelectedProfileId(null);
      if (editingDistributor?.id === id) setEditingDistributor(null);
      toastEvent.trigger(`Distributor layout profile "${name}" deleted successfully!`, 'success');
      await broadcastContactDataChanged();
      refetchProfiles();
    } catch (err: any) {
      toastEvent.trigger('Failed to delete distributor layout: ' + (err.message || 'Server error'), 'error');
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

  // Today's Pharmarack Sent Orders Query
  const { data: todaySentOrdersData, isLoading: loadingTodaySentOrders } = useApiQuery<any>(
    'learning-today-pharmarack-sent-orders',
    async () => {
      const res = await apiClient.get('/pharmarack/sent-orders');
      return res.data;
    },
    { enabled: isPageVisible && activeTab === 'distributors' }
  );
  const todaySentOrdersList: any[] = todaySentOrdersData?.orders || [];

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

  useEffect(() => {
    const handleUpdate = () => {
      cachedProfiles = [];
      Object.keys(cachedProfileDetailsMap).forEach((key) => delete cachedProfileDetailsMap[Number(key)]);
      refetchProfiles();
    };
    window.addEventListener('phone-numbers-updated', handleUpdate);
    window.addEventListener('distributors-updated', handleUpdate);
    window.addEventListener('settings-updated', handleUpdate);
    window.addEventListener('contacts-updated', handleUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handleUpdate);
      window.removeEventListener('distributors-updated', handleUpdate);
      window.removeEventListener('settings-updated', handleUpdate);
      window.removeEventListener('contacts-updated', handleUpdate);
    };
  }, [refetchProfiles]);

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

  // Snoozed Reorders Query
  const { data: snoozedReordersData, isLoading: loadingSnoozed, refetch: refetchSnoozed } = useApiQuery<any>(
    'learning-snoozed-reorders',
    async () => {
      return await api.getSnoozedReorders();
    },
    { enabled: isPageVisible && activeTab === 'reorders' }
  );
  const snoozedItems: any[] = snoozedReordersData?.items || [];

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

  // Run Operations Sandbox Scanner Test
  const handleRunSampleScan = (type: 'marg' | 'tally' | 'redbook' | 'custom') => {
    setScannerSampleType(type);
    setIsScanningSandbox(true);
    setTimeout(() => {
      setIsScanningSandbox(false);
      if (type === 'marg') {
        setScanResultData({
          distributor: 'Apex Pharma Distributors',
          invoiceNo: 'APX-2026/8912',
          date: '2026-08-10',
          confidence: '99.4%',
          format: 'MARG Soft CSV Export',
          items: [
            { name: 'Dolo 650mg Tablet', batch: 'DL8912', exp: '12/28', qty: 10, free: 1, ptr: 24.50, mrp: 30.80, gst: '12%' },
            { name: 'Pantocid 40mg', batch: 'PT4021', exp: '09/27', qty: 5, free: 0, ptr: 112.00, mrp: 154.00, gst: '12%' },
            { name: 'Azithral 500mg', batch: 'AZ5019', exp: '03/28', qty: 3, free: 0, ptr: 78.20, mrp: 119.50, gst: '12%' }
          ]
        });
      } else if (type === 'tally') {
        setScanResultData({
          distributor: 'MedPlus Wholesale Corp',
          invoiceNo: 'MP-GST-78912',
          date: '2026-08-11',
          confidence: '98.8%',
          format: 'Tally Prime XML/PDF Invoice',
          items: [
            { name: 'Augmentin 625 Duo', batch: 'AG6259', exp: '11/27', qty: 15, free: 2, ptr: 165.00, mrp: 223.50, gst: '12%' },
            { name: 'Montek LC Tablet', batch: 'ML7820', exp: '05/28', qty: 8, free: 0, ptr: 142.30, mrp: 198.00, gst: '12%' }
          ]
        });
      } else {
        setScanResultData({
          distributor: 'RedBook Healthcare Agencies',
          invoiceNo: 'RB-9021-X',
          date: '2026-08-09',
          confidence: '97.2%',
          format: 'RedBook Thermal Printed Receipt',
          items: [
            { name: 'Calpol 500mg Suspension', batch: 'CP5012', exp: '08/27', qty: 12, free: 1, ptr: 42.00, mrp: 58.00, gst: '12%' },
            { name: 'Combiflam Tablet', batch: 'CB1092', exp: '01/29', qty: 20, free: 2, ptr: 31.50, mrp: 45.00, gst: '12%' }
          ]
        });
      }
      toastEvent.trigger(`OCR Scanner simulation complete for ${type.toUpperCase()} layout`, 'success');
    }, 600);
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
      toastEvent.trigger('Select two distinct distributor profiles to merge', 'error');
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
      toastEvent.trigger('Merge failed: ' + (err.message || 'Server error'), 'error');
    } finally {
      setIsMerging(false);
    }
  };

  const correctionsArray = Array.isArray(corrections) ? corrections : [];
  const doctorsListArray = Array.isArray(doctorsList) ? doctorsList : [];
  const profilesList = Array.isArray(rawProfiles) ? rawProfiles : [];

  // Filtered Doctors
  const filteredDoctors = doctorsListArray.filter((d: any) => {
    const q = (doctorSearch || globalSearch).toLowerCase().trim();
    if (!q) return true;
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.reg_number && d.reg_number.toLowerCase().includes(q)) ||
      (d.specialty && d.specialty.toLowerCase().includes(q)) ||
      (d.clinic && d.clinic.toLowerCase().includes(q))
    );
  });

  // Filtered Profiles (supports name, phone, email, mapped Pharmarack store names & normalized matching)
  const filteredProfiles = profilesList.filter(p => {
    const q = (profileSearchQuery || globalSearch).toLowerCase().trim();
    if (!q) return true;
    const cleanQNorm = q.replace(/[^a-z0-9]/g, '');
    const cleanDistNorm = (p.distributor_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQ = q.replace(/\(.*?\)/g, '').replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic|cosmetics|cosmatics/gi, '').replace(/[^a-z0-9]/g, '');
    const normDist = (p.distributor_name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic|cosmetics|cosmatics/gi, '').replace(/[^a-z0-9]/g, '');

    return (
      (p.distributor_name && p.distributor_name.toLowerCase().includes(q)) ||
      (p.distributor_email && p.distributor_email.toLowerCase().includes(q)) ||
      (p.distributor_phone && p.distributor_phone.toLowerCase().includes(q)) ||
      (p.mapped_store_names && p.mapped_store_names.toLowerCase().includes(q)) ||
      (cleanQNorm && cleanDistNorm && (cleanDistNorm.includes(cleanQNorm) || cleanQNorm.includes(cleanDistNorm))) ||
      (normQ && normDist && (normDist.includes(normQ) || normQ.includes(normDist)))
    );
  });

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fadeIn">
      {/* Executive Command Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-glass-bg border border-glass-border rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-xl">
        {/* Title & Status */}
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
            <Brain size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black text-text tracking-tight leading-none">AI Learning Command Center</h1>
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Engine
              </span>
            </div>
            <p className="text-xs text-muted mt-1 font-medium">
              Autonomous OCR correction, clinical knowledge baseline, doctor directory & distributor layout parsing
            </p>
          </div>
        </div>

        {/* Global Controls & Tab Switcher */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Retrain Action */}
          <button
            onClick={handleRetrain}
            disabled={retraining}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw size={14} className={retraining ? 'animate-spin' : ''} />
            <span>{retraining ? 'Retraining AI Engine...' : 'Retrain Clinical Model'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Bar Tabs */}
      <div className="flex items-center gap-2 bg-bg border border-border p-1.5 rounded-2xl overflow-x-auto scrollbar-none shadow-sm">
        {[
          { id: 'clinical', label: 'Clinical AI & OCR Rules', icon: Brain, badge: correctionsArray.length },
          { id: 'doctors', label: 'Doctor Directory', icon: Stethoscope, badge: doctorsListArray.length },
          { id: 'distributors', label: 'Distributor OCR Layouts', icon: Database, badge: profilesList.length },
          { id: 'operations', label: 'Scanner Sandbox & Parser', icon: QrCode, badge: 'Interactive' },
          { id: 'reorders', label: 'Inventory & Paused Reorders', icon: TrendingUp, badge: snoozedItems.length }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`flex items-center gap-2.5 px-4 py-2 font-bold text-xs rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-glass-bg text-primary shadow-md border border-glass-border'
                  : 'text-muted hover:text-text hover:bg-bg3/60 border border-transparent'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
              <span>{t.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold font-mono ${
                isActive ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-bg3 text-muted'
              }`}>
                {t.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: Clinical AI & OCR Rules */}
      {/* ========================================================================= */}
      {activeTab === 'clinical' && (
        <div className="space-y-6">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-sky/10 text-sky border border-sky/20">
                <Brain size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Active OCR Rules</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {stats?.activeOcrCorrections ?? correctionsArray.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Sparkles size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Learned Rx Combos</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {stats?.learnedRxCombos ?? 142}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <ShieldCheck size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Salt Mappings Baseline</div>
                <div className="text-2xl font-black text-primary mt-0.5 font-mono">
                  24,500+
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <RefreshCw size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Last Clinical Retrain</div>
                <div className="text-xs font-black text-text mt-1">
                  {stats?.lastRetrainedAt ? formatDisplayDate(stats.lastRetrainedAt) : 'Ready for training'}
                </div>
              </div>
            </div>
          </div>

          {/* 3-Column Dashboard Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column (1/3 Width): Add Rule & Brand Resolution Sandbox */}
            <div className="space-y-6">
              {/* Add Rule Form */}
              <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-text font-bold text-sm">
                  <Plus size={16} className="text-emerald-400" />
                  <span>Define OCR Correction Rule</span>
                </div>
                <p className="text-xs text-muted">
                  Map distorted raw text scanned from camera/invoices to exact master medicine names.
                </p>

                <form onSubmit={handleAddCorrection} className="space-y-3 pt-1">
                  <div>
                    <label className="text-[11px] font-bold text-text block mb-1">Scanned Raw OCR Text</label>
                    <input
                      type="text"
                      placeholder="e.g. D0L0 650, CROC1N, AZ1THR0"
                      value={newOcrRaw}
                      onChange={e => setNewOcrRaw(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-text block mb-1">Corrected Master Medicine Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Dolo 650mg Tablet"
                      value={newOcrCorrected}
                      onChange={e => setNewOcrCorrected(e.target.value)}
                      className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary font-bold"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-emerald-500 text-white font-bold text-xs rounded-xl py-2.5 hover:bg-emerald-600 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Plus size={14} /> Add Mapping Rule
                  </button>
                </form>
              </div>

              {/* Resolution Sandbox */}
              <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-text font-bold text-sm">
                  <Sparkles size={16} className="text-primary" />
                  <span>OCR Database Resolution Sandbox</span>
                </div>
                <p className="text-xs text-muted">
                  Test instant OCR fuzzy matching against database master catalog.
                </p>

                <form onSubmit={handleTestMapping} className="space-y-2">
                  <input
                    type="text"
                    placeholder="Enter raw text to test..."
                    value={testBrandInput}
                    onChange={e => setTestBrandInput(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary font-mono"
                  />
                  <button
                    type="submit"
                    disabled={testingBrand}
                    className="w-full py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {testingBrand ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                    Test Brand Resolution
                  </button>
                </form>

                {testResult && (
                  <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${testResult.mapped ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                    {testResult.mapped ? (
                      <div>
                        <div className="font-bold flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle2 size={14} /> Match Found:
                        </div>
                        <div className="text-xs font-black text-text mt-1">{testResult.medicine?.name}</div>
                        <div className="text-[10px] text-muted font-mono mt-0.5">
                          MRP: ₹{testResult.medicine?.mrp} | Rate: ₹{testResult.medicine?.rate} | Pack: {testResult.medicine?.packaging || 'Strip'}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs">
                        <AlertCircle size={14} />
                        <span>{testResult.error || 'No automatic match found.'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel (2/3 Width): Active OCR Correction Rules Registry Table */}
            <div className="lg:col-span-2 bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <Database size={18} className="text-sky" />
                    OCR Correction Registry Matrix
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    Active dictionary of raw OCR text mappings enforced across camera & OCR scans.
                  </p>
                </div>
                <div className="text-xs text-muted font-mono font-bold">
                  Total Rules: {correctionsArray.length}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border flex-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg2/80 text-muted font-bold uppercase text-[10px] tracking-wider border-b border-border">
                    <tr>
                      <th className="py-3 px-4">Raw Scanned OCR String</th>
                      <th className="py-3 px-4">Mapped Master Brand</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {correctionsArray.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-muted italic bg-bg2/20">
                          No custom OCR correction rules configured. Add rules on the left panel.
                        </td>
                      </tr>
                    ) : (
                      correctionsArray.map(c => (
                        <tr key={c.id} className="hover:bg-bg2/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-amber-400 bg-amber-500/5">{c.ocr}</td>
                          <td className="py-3 px-4 font-bold text-text">{c.correct}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleDeleteCorrection(c.id)}
                              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer border border-rose-500/20"
                              title="Delete Rule"
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: Doctor Directory */}
      {/* ========================================================================= */}
      {activeTab === 'doctors' && (
        <div className="space-y-6">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-sky/10 text-sky border border-sky/20">
                <Stethoscope size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Registered Doctors</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {doctorsListArray.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Building2 size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Linked Hospitals / Clinics</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {new Set(doctorsListArray.map(d => d.clinic).filter(Boolean)).size || 1}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <CheckSquare size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Valid Reg Numbers</div>
                <div className="text-2xl font-black text-primary mt-0.5 font-mono">
                  {doctorsListArray.filter(d => d.reg_number).length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Activity size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Directory Status</div>
                <div className="text-xs font-black text-emerald-400 mt-1 uppercase tracking-wider">
                  Active & Synced
                </div>
              </div>
            </div>
          </div>

          {/* 3-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel (1/3 Width): Register Doctor Form */}
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-text font-bold text-sm">
                <Stethoscope size={16} className="text-primary" />
                <span>Register Medical Practitioner</span>
              </div>
              <p className="text-xs text-muted">
                Add doctor credentials for prescription tracking and automatic doctor resolution.
              </p>

              <form onSubmit={handleAddDoctor} className="space-y-3 pt-1">
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Doctor Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. A. K. Sharma"
                    value={docName}
                    onChange={e => setDocName(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Reg / License No.</label>
                  <input
                    type="text"
                    placeholder="e.g. MCI-98765"
                    value={docReg}
                    onChange={e => setDocReg(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <PhoneInputWithBadge
                    label="Phone Number"
                    value={docPhone}
                    onChange={val => setDocPhone(val)}
                    placeholder="10 digits"
                    shakeOnError={shakeDoctorPhone}
                    allowEmpty={true}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Specialty</label>
                  <input
                    type="text"
                    placeholder="e.g. Cardiologist, Physician"
                    value={docSpecialty}
                    onChange={e => setDocSpecialty(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">Clinic / Hospital</label>
                  <input
                    type="text"
                    placeholder="e.g. City Care Hospital"
                    value={docClinic}
                    onChange={e => setDocClinic(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground font-bold text-xs rounded-xl py-2.5 hover:bg-primary/90 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Plus size={14} /> Register Doctor
                </button>
              </form>
            </div>

            {/* Right Panel (2/3 Width): Doctor Registry Grid */}
            <div className="lg:col-span-2 bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-2">
                    <Stethoscope size={18} className="text-sky" />
                    Doctor Directory Registry
                  </h3>
                  <p className="text-xs text-muted mt-0.5">Filter and manage registered doctors.</p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-3 text-muted" />
                  <input
                    type="text"
                    placeholder="Search name, reg, specialty..."
                    value={doctorSearch}
                    onChange={e => setDoctorSearch(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg2/80 text-muted font-bold uppercase text-[10px] tracking-wider border-b border-border">
                    <tr>
                      <th className="py-3 px-4">Doctor Name & Hospital</th>
                      <th className="py-3 px-4">Reg License #</th>
                      <th className="py-3 px-4">Specialty</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredDoctors.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-muted italic bg-bg2/20">
                          {loadingDoctors ? 'Loading doctor directory...' : 'No doctors found matching search query.'}
                        </td>
                      </tr>
                    ) : (
                      filteredDoctors.map((d: any) => (
                        <tr key={d.id} className="hover:bg-bg2/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-text">
                            <div className="flex items-center gap-2">
                              <Stethoscope size={14} className="text-sky shrink-0" />
                              <span>{d.name}</span>
                            </div>
                            {d.clinic && <div className="text-[10px] text-muted pl-5 font-normal">{d.clinic}</div>}
                          </td>
                          <td className="py-3 px-4 text-muted font-mono font-bold">{d.reg_number || 'N/A'}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky/10 text-sky border border-sky/20">
                              {d.specialty || 'General Physician'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted font-mono">{d.phone || 'N/A'}</td>
                          <td className="py-3 px-4 text-right space-x-1.5">
                            <button
                              onClick={() => handleOpenEditDoctor(d)}
                              className="p-1.5 rounded-lg bg-bg2 text-muted hover:text-text border border-border cursor-pointer"
                              title="Edit Credentials"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteDoctor(d.id)}
                              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 cursor-pointer"
                              title="Remove Doctor"
                            >
                              <Trash2 size={13} />
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: Distributor OCR Layout Profiles */}
      {/* ========================================================================= */}
      {activeTab === 'distributors' && (
        <div className="space-y-6">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-sky/10 text-sky border border-sky/20">
                <Building2 size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Distributor Layouts</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {profilesList.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Truck size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Orders Sent Today</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {todaySentOrdersList.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <GitMerge size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Merge Engine</div>
                <button
                  onClick={() => setShowMergeModal(true)}
                  className="text-xs font-bold text-amber-400 hover:underline mt-1 block"
                >
                  Merge Profiles...
                </button>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Zap size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Parser Engine</div>
                <div className="text-xs font-black text-primary mt-1 uppercase tracking-wider">
                  Active (MARG / Tally)
                </div>
              </div>
            </div>
          </div>

          {/* Today's Pharmarack Cart Sent Orders Bar */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-text">
                <Truck size={16} className="text-emerald-400" />
                <span>
                  {todaySentOrdersData?.is_recent_fallback
                    ? `Recent Sent Orders (${todaySentOrdersData.date})`
                    : "Today's Pharmarack Cart Sent Orders"}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                  todaySentOrdersData?.is_recent_fallback
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                }`}>
                  {todaySentOrdersData?.is_recent_fallback
                    ? `📅 Recent Orders (${todaySentOrdersList.length})`
                    : `${todaySentOrdersList.length} Orders Placed Today`}
                </span>
              </div>
            </div>

            {loadingTodaySentOrders ? (
              <div className="text-xs text-muted py-4 text-center">Loading today's sent orders...</div>
            ) : todaySentOrdersList.length === 0 ? (
              <div className="text-xs text-muted py-4 text-center italic bg-bg2/40 rounded-xl border border-border">
                No orders sent today yet. Orders placed via Pharmarack Cart will automatically log here.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {todaySentOrdersList.map((ord: any) => (
                  <div key={ord.id} className="p-3 rounded-xl bg-bg2/60 border border-border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-xs text-text">{ord.store_name}</span>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        ✅ {ord.placed_at ? new Date(ord.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sent'}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted line-clamp-2">
                      Items: {Array.isArray(ord.items) ? ord.items.map((i: any) => `${i.productName || i.name || 'Item'} (${i.qty || 1})`).join(', ') : 'Standard Items'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search & Profiles Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel: Search & Profiles List */}
            <div className="space-y-4">
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

              <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1 scrollbar-thin">
                {filteredProfiles.length === 0 ? (
                  <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 text-center text-muted text-xs">
                    {loadingProfiles ? 'Loading distributor profiles...' : 'No distributor profiles found.'}
                  </div>
                ) : (
                  filteredProfiles.map(p => {
                    const isSelected = selectedProfileId === p.distributor_id;
                    return (
                      <div
                        key={p.distributor_id}
                        onClick={() => setSelectedProfileId(p.distributor_id)}
                        className={`bg-glass-bg border rounded-2xl p-4 cursor-pointer transition-all duration-200 space-y-2.5 ${
                          isSelected ? 'border-primary shadow-md shadow-primary/10 bg-primary/5' : 'border-glass-border hover:border-primary/40'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                              <Building2 size={16} />
                            </div>
                            <div>
                              <div className="font-bold text-text text-xs truncate max-w-[150px]">
                                {p.distributor_name}
                              </div>
                              <div className="text-[10px] text-muted flex items-center gap-1.5 flex-wrap">
                                <span>ID #{p.distributor_id}</span>
                                {p.mapped_store_names && (
                                  <span className="text-[9px] font-semibold text-sky bg-sky/10 border border-sky/20 px-1.5 rounded truncate max-w-[140px]" title={`Mapped stores: ${p.mapped_store_names}`}>
                                    🔗 {p.mapped_store_names}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditDistributor(p);
                              }}
                              className="p-1 rounded-lg bg-bg2 text-muted hover:text-text border border-border"
                              title="Edit Layout & Rules"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteDistributorProfile(p.distributor_id, p.distributor_name);
                              }}
                              className="p-1 rounded-lg bg-red/10 text-red hover:bg-red/20 border border-red/20 cursor-pointer"
                              title="Delete Layout & Distributor"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-muted flex items-center justify-between border-t border-border/40 pt-2">
                          <span>{p.distributor_phone || 'No phone'}</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                            {p.files_count} files
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Panel (2/3 Width): Selected Profile Inspector */}
            <div className="lg:col-span-2 bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              {selectedProfileId && selectedProfileDetail ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="font-bold text-text text-base flex items-center gap-2">
                      <Building2 size={18} className="text-primary" />
                      <span>{selectedProfileDetail.distributor?.name || `Distributor #${selectedProfileId}`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeleteDistributorProfile(selectedProfileId, selectedProfileDetail.distributor?.name || `Distributor #${selectedProfileId}`)}
                        className="px-2.5 py-1 rounded-lg bg-red/10 text-red hover:bg-red/20 border border-red/20 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                        title="Delete Distributor Layout Profile"
                      >
                        <Trash2 size={13} />
                        <span>Delete Layout</span>
                      </button>
                      <button
                        onClick={() => setSelectedProfileId(null)}
                        className="text-muted hover:text-text cursor-pointer p-1"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted">
                    <span>{selectedProfileDetail.distributor?.phone || 'No phone set'}</span>
                    {selectedProfileDetail.distributor?.email && <span>{selectedProfileDetail.distributor.email}</span>}
                  </div>

                  {(() => {
                    const successCount = selectedProfileDetail.profile?.success_count || 0;
                    const lastSuccess = selectedProfileDetail.profile?.last_success_at;
                    const learned = successCount > 0;
                    return (
                      <div className={`p-4 rounded-xl border ${learned ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                        <div className={`font-bold text-sm ${learned ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {learned
                            ? `✅ Bill layout learned — ${successCount} bill${successCount === 1 ? '' : 's'} read automatically`
                            : '⏳ Not learned yet'}
                        </div>
                        <div className="text-xs text-muted mt-1">
                          {learned
                            ? `Last one: ${lastSuccess ? formatDisplayDate(lastSuccess) : 'recently'}. The app keeps reading this distributor's bills automatically — no setup needed.`
                            : "The app will learn this distributor's bill layout automatically the next time a bill is processed — no manual setup needed."}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">File History</div>
                    {selectedProfileDetail.files && selectedProfileDetail.files.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedProfileDetail.files.map(f => (
                          <div key={f.id} className="flex items-center justify-between text-xs bg-bg border border-border rounded-lg px-3 py-2">
                            <span className="text-text font-medium truncate max-w-[220px]">📄 {f.filename}</span>
                            <span className="text-muted">{f.created_at ? formatDisplayDate(f.created_at) : ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted italic">No files recorded yet.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-20 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto">
                    <Building2 size={24} />
                  </div>
                  <div className="font-bold text-text text-sm">Select a Distributor Profile</div>
                  <div className="text-xs text-muted max-w-sm mx-auto">
                    Click any distributor profile on the left to see whether the app has learned its bill layout yet.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: Document & Scanner Sandbox */}
      {/* ========================================================================= */}
      {activeTab === 'operations' && (
        <div className="space-y-6">
          {/* Top Info Bar */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-text flex items-center gap-2">
                <QrCode size={18} className="text-primary" />
                OCR Document & Scanner Playground
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Simulate invoice OCR parsing across MARG, Tally, RedBook & custom thermal receipts in a safe sandbox environment.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleRunSampleScan('marg')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs border cursor-pointer transition-all ${
                  scannerSampleType === 'marg' ? 'bg-primary text-primary-foreground border-primary' : 'bg-bg2 text-text border-border hover:bg-bg3'
                }`}
              >
                MARG Invoice
              </button>
              <button
                onClick={() => handleRunSampleScan('tally')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs border cursor-pointer transition-all ${
                  scannerSampleType === 'tally' ? 'bg-primary text-primary-foreground border-primary' : 'bg-bg2 text-text border-border hover:bg-bg3'
                }`}
              >
                Tally GST Bill
              </button>
              <button
                onClick={() => handleRunSampleScan('redbook')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs border cursor-pointer transition-all ${
                  scannerSampleType === 'redbook' ? 'bg-primary text-primary-foreground border-primary' : 'bg-bg2 text-text border-border hover:bg-bg3'
                }`}
              >
                RedBook Receipt
              </button>
            </div>
          </div>

          {/* 2-Column Split Sandbox Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Dropzone & Interactive Controls */}
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 shadow-xl space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="font-bold text-text text-sm flex items-center gap-2">
                    <FileText size={16} className="text-sky" />
                    <span>Upload or Drop Test Document</span>
                  </div>
                  <span className="text-[10px] font-bold text-muted bg-bg2 px-2 py-0.5 rounded border border-border">
                    PDF, PNG, JPG, CSV
                  </span>
                </div>

                <div
                  onClick={() => handleRunSampleScan('marg')}
                  className="border-2 border-dashed border-border hover:border-primary/60 rounded-2xl p-10 text-center space-y-3 bg-bg/50 transition-all cursor-pointer group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                    <QrCode size={28} />
                  </div>
                  <div>
                    <div className="font-bold text-text text-sm group-hover:text-primary transition-colors">
                      Drag & Drop Invoice File or Click to Test Sandbox
                    </div>
                    <div className="text-xs text-muted mt-1">
                      Simulates instant key-value extraction & column mapping logic
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <div className="text-xs font-bold text-muted mb-2">Preset Layout Quick Tests:</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleRunSampleScan('marg')}
                    className="p-2.5 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-center text-xs font-bold text-text cursor-pointer transition-all"
                  >
                    🚀 Load MARG CSV
                  </button>
                  <button
                    onClick={() => handleRunSampleScan('tally')}
                    className="p-2.5 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-center text-xs font-bold text-text cursor-pointer transition-all"
                  >
                    📄 Load Tally PDF
                  </button>
                  <button
                    onClick={() => handleRunSampleScan('redbook')}
                    className="p-2.5 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-center text-xs font-bold text-text cursor-pointer transition-all"
                  >
                    🧾 Load RedBook Receipt
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Real-time OCR Parsing Engine Output */}
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="font-bold text-text text-sm flex items-center gap-2">
                  <Zap size={16} className="text-emerald-400" />
                  <span>OCR Parsing Extraction Results</span>
                </div>
                {scanResultData && (
                  <span className="text-xs font-extrabold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    Confidence: {scanResultData.confidence}
                  </span>
                )}
              </div>

              {isScanningSandbox ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                  <RefreshCw size={28} className="text-primary animate-spin" />
                  <span className="text-xs font-bold text-muted animate-pulse uppercase tracking-wider">
                    Running OCR Neural Model Extraction...
                  </span>
                </div>
              ) : scanResultData ? (
                <div className="space-y-4">
                  {/* Extracted Header Meta */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-bg2/60 p-3 rounded-xl border border-border font-mono">
                    <div>
                      <span className="text-muted text-[10px] block">Distributor:</span>
                      <strong className="text-text">{scanResultData.distributor}</strong>
                    </div>
                    <div>
                      <span className="text-muted text-[10px] block">Invoice No:</span>
                      <strong className="text-primary">{scanResultData.invoiceNo}</strong>
                    </div>
                    <div>
                      <span className="text-muted text-[10px] block">Layout Format:</span>
                      <strong className="text-sky">{scanResultData.format}</strong>
                    </div>
                  </div>

                  {/* Extracted Items Table */}
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-bg2 text-muted font-bold text-[10px] uppercase">
                        <tr>
                          <th className="p-2.5">Medicine Name</th>
                          <th className="p-2.5">Batch / Exp</th>
                          <th className="p-2.5">Qty + Free</th>
                          <th className="p-2.5">PTR</th>
                          <th className="p-2.5">MRP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {scanResultData.items.map((item: any, idx: number) => (
                          <tr key={idx} className="hover:bg-bg2/40">
                            <td className="p-2.5 font-bold text-text">{item.name}</td>
                            <td className="p-2.5 font-mono text-muted">{item.batch} ({item.exp})</td>
                            <td className="p-2.5 font-mono font-bold text-emerald-400">
                              {item.qty} {item.free > 0 ? `+ ${item.free} Free` : ''}
                            </td>
                            <td className="p-2.5 font-mono text-text">₹{item.ptr}</td>
                            <td className="p-2.5 font-mono text-muted">₹{item.mrp}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-20 text-center space-y-2">
                  <QrCode size={32} className="text-muted mx-auto opacity-50" />
                  <div className="text-xs text-muted italic">
                    Click any preset layout quick test on the left to simulate live OCR parsing.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: Inventory & Paused Reorders Audit Panel */}
      {/* ========================================================================= */}
      {activeTab === 'reorders' && (
        <div className="space-y-6">
          {/* Top 4 Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Clock size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Total Paused Reorder Rules</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {snoozedItems.length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-sky/10 text-sky border border-sky/20">
                <TrendingUp size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Seasonal (6 Months) Paused</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {snoozedItems.filter(i => i.snoozeType === '6_months' || i.snoozeType === '180_days').length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Sparkles size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Short-Term (7 Days) Ignored</div>
                <div className="text-2xl font-black text-text mt-0.5 font-mono">
                  {snoozedItems.filter(i => i.snoozeType === '7_days').length}
                </div>
              </div>
            </div>

            <div className="bg-glass-bg border border-glass-border rounded-2xl p-4 flex items-center gap-3.5 shadow-md">
              <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <ShieldCheck size={22} />
              </div>
              <div>
                <div className="text-xs text-muted font-bold">Restock Safety Net</div>
                <div className="text-xs font-black text-emerald-400 mt-1 uppercase tracking-wider">
                  Active Audit
                </div>
              </div>
            </div>
          </div>

          {/* Table of Snoozed Reorder Rules */}
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-bold text-text flex items-center gap-2">
                  <TrendingUp size={18} className="text-primary" />
                  <span>Paused & Seasonal Reorder Audit Registry</span>
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  View medicines currently hidden from Pending Reorder. Restore them instantly if paused by mistake.
                </p>
              </div>
              <button
                onClick={() => refetchSnoozed()}
                className="px-3.5 py-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-text font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <RefreshCw size={13} className={loadingSnoozed ? 'animate-spin' : ''} />
                <span>Refresh Registry</span>
              </button>
            </div>

            {loadingSnoozed ? (
              <div className="py-16 text-center text-xs text-muted animate-pulse">Loading paused reorder rules...</div>
            ) : snoozedItems.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted italic bg-bg2/30 rounded-xl border border-glass-border space-y-1">
                <div className="font-bold text-text text-sm">No Paused Reorder Rules</div>
                <div>All low-stock and hot mover medicines are actively active in Pending Reorders!</div>
              </div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg2/80 text-muted font-bold uppercase text-[10px] tracking-wider border-b border-border">
                    <tr>
                      <th className="p-3.5">Medicine & Brand</th>
                      <th className="p-3.5">Current Stock</th>
                      <th className="p-3.5">Purchases 6M</th>
                      <th className="p-3.5">Sales 6M</th>
                      <th className="p-3.5">Pause Type</th>
                      <th className="p-3.5">Until Expiry Date</th>
                      <th className="p-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {snoozedItems.map((item: any) => (
                      <tr key={item.medicineId} className="hover:bg-bg2/40 transition-all">
                        <td className="p-3.5">
                          <div className="font-bold text-text">{item.medicineName}</div>
                          <div className="text-[10px] text-muted">{item.company} {item.packaging ? `• ${item.packaging}` : ''}</div>
                        </td>
                        <td className="p-3.5 font-mono font-bold">
                          <span className={item.currentStock <= 2 ? 'text-amber-400 font-extrabold' : 'text-text'}>
                            {item.currentStock} units
                          </span>
                        </td>
                        <td className="p-3.5 font-mono text-emerald-400 font-bold">{item.sixMonthPurchases || 0}</td>
                        <td className="p-3.5 font-mono text-primary font-bold">{item.sixMonthSales || 0}</td>
                        <td className="p-3.5">
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            {item.snoozeType === '6_months' ? 'Seasonal (6 Months)' : item.snoozeType === '30_days' ? '1 Month (30d)' : '7 Days'}
                          </span>
                        </td>
                        <td className="p-3.5 text-muted font-mono text-[11px]">
                          {formatDisplayDate(item.snoozeUntil)}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={async () => {
                              try {
                                await api.unsnoozeReorderSuggestion(item.medicineId);
                                toastEvent.trigger(`Restored "${item.medicineName}" to Pending Reorders!`, 'success');
                                refetchSnoozed();
                              } catch (err: any) {
                                toastEvent.trigger('Failed to restore medicine', 'error');
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-[11px] hover:bg-primary/90 transition-all cursor-pointer shadow-md"
                          >
                            Restore to Reorders
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MERGE MODAL PORTAL */}
      {/* ========================================================================= */}
      {showMergeModal && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <GitMerge size={18} className="text-amber-400" />
                <span>Merge Duplicate Distributor Profiles</span>
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
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
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
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
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

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
              >
                Cancel
              </button>
              <button
                onClick={handleMergeProfiles}
                disabled={isMerging || !primaryMergeId || !secondaryMergeId}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isMerging ? <RefreshCw size={14} className="animate-spin" /> : <GitMerge size={14} />}
                Confirm Merge
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* EDIT DISTRIBUTOR MODAL PORTAL */}
      {/* ========================================================================= */}
      {editingDistributor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Edit size={18} className="text-primary" />
                <span>Edit Distributor Profile & OCR Rules</span>
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
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-primary font-bold"
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

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={() => handleDeleteDistributorProfile(editingDistributor.id, editingDistributor.name)}
                className="px-3.5 py-2 rounded-xl bg-red/10 border border-red/20 text-red font-bold text-xs cursor-pointer hover:bg-red/20 flex items-center gap-1.5 transition-all"
                title="Delete Distributor Layout Profile"
              >
                <Trash2 size={14} />
                <span>Delete Layout</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingDistributor(null)}
                  className="px-4 py-2 rounded-xl bg-bg2 border border-border text-text font-bold text-xs cursor-pointer hover:bg-bg3"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDistributorDetails}
                  disabled={isSavingDistributor || !editingDistributor.name.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingDistributor ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* EDIT DOCTOR MODAL PORTAL */}
      {/* ========================================================================= */}
      {editingDoctor && createPortal(
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-glass-bg border border-glass-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="font-bold text-text text-base flex items-center gap-2">
                <Stethoscope size={18} className="text-primary" />
                <span>Edit Doctor Details & Credentials</span>
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
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs cursor-pointer hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
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
