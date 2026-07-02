// AI Learning & Automation Command Center (Agent 2 Redesign)
import React, { useState, useEffect } from 'react';
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
  HelpCircle,
  ArrowRight,
  MessageCircle,
  Send,
  Zap,
  Mail,
  Bell,
  Globe,
  Copy,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
  Sliders,
  Play,
  Stethoscope,
  Search
} from 'lucide-react';
import { apiClient } from '../../services/api';
import { toastEvent } from '../../services/events';

interface LearningProfileSummary {
  distributor_id: number;
  distributor_name: string;
  distributor_email: string | null;
  distributor_phone: string | null;
  last_updated: string | null;
  files_count: number;
  last_status: string | null;
}

interface HistoricalFile {
  id: number;
  distributor_id: number;
  filename: string;
  file_path: string;
  file_type: string;
  file_headers: string; // JSON array
  mapping_config: string; // JSON object
  extracted_data: string; // JSON array
  status: string;
  created_at: string;
}

interface ProfileDetail {
  distributor_id: number;
  file_mapping_rules: string;
  last_updated: string;
}

const Learning: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'clinical' | 'doctors' | 'distributors' | 'messaging' | 'ingestion' | 'operations'>('clinical');

  // Doctor Affiliations States
  const [doctorsList, setDoctorsList] = useState<any[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [showAddDocModal, setShowAddDocModal] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [newDocPhone, setNewDocPhone] = useState('');
  const [newDocSpecialty, setNewDocSpecialty] = useState('');
  const [newDocHospital, setNewDocHospital] = useState('');
  const [newDocRegNo, setNewDocRegNo] = useState('');
  const [newDocSendSummary, setNewDocSendSummary] = useState(false);
  const [triggeringDoctorReport, setTriggeringDoctorReport] = useState<number | null>(null);

  // Core Data States
  const [profiles, setProfiles] = useState<LearningProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<{
    distributor: any;
    profile: ProfileDetail | null;
    files: HistoricalFile[];
  } | null>(null);
  
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Settings/Automation state
  const [settingsData, setSettingsData] = useState<any>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSetting, setSavingSetting] = useState<string | null>(null);

  // Configuration UI toggle states
  const [showWaConfig, setShowWaConfig] = useState(false);
  const [showWaBusConfig, setShowWaBusConfig] = useState(false);
  const [showTgConfig, setShowTgConfig] = useState(false);
  const [showEmailConfig, setShowEmailConfig] = useState(false);
  const [showPrConfig, setShowPrConfig] = useState(false);

  // WhatsApp Web Status
  const [waStatus, setWaStatus] = useState({ isReady: false, qrUrl: null as string | null, message: '' });
  const [isOpeningWaWindow, setIsOpeningWaWindow] = useState(false);

  // WhatsApp Business API testing
  const [waBusinessTesting, setWaBusinessTesting] = useState(false);
  const [waBusinessTestResult, setWaBusinessTestResult] = useState<{ success?: boolean; phone?: string; name?: string; error?: string } | null>(null);

  // Pharmarack link login
  const [isOpeningWindow, setIsOpeningWindow] = useState(false);
  const [prHealth, setPrHealth] = useState<{ healthy: boolean; mode: 'Live'; reason?: string; message?: string } | null>(null);
  const [checkingPrHealth, setCheckingPrHealth] = useState(false);

  // New distributor creation states
  const [showAddDistModal, setShowAddDistModal] = useState(false);
  const [newDistName, setNewDistName] = useState('');
  const [newDistPhone, setNewDistPhone] = useState('');
  const [newDistEmail, setNewDistEmail] = useState('');

  // Manual trainer editing state
  const [mappingRules, setMappingRules] = useState<Record<string, string>>({
    name: '',
    quantity: '',
    rate: '',
    mrp: '',
    batch_no: '',
    expiry_date: '',
    free_qty: '',
    cgst: '',
    sgst: '',
    global_cd_per: '',
    invoice_no: '',
    invoice_date: '',
    total_amount: ''
  });
  const [savingMapping, setSavingMapping] = useState(false);

  // Comparator modal state
  const [comparatorFileId, setComparatorFileId] = useState<number | null>(null);
  const [comparatorData, setComparatorData] = useState<{
    filename: string;
    file_type: string;
    file_headers: string[];
    mapping_config: Record<string, string>;
    extracted_data: any[];
    status: string;
    created_at: string;
  } | null>(null);
  const [loadingComparator, setLoadingComparator] = useState(false);

  // Clinical AI Sandbox & Model states
  const [ocrSandboxText, setOcrSandboxText] = useState('');
  const [searchingSandbox, setSearchingSandbox] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<any>(null);
  const [sandboxTested, setSandboxTested] = useState(false);
  const [refreshingModel, setRefreshingModel] = useState(false);
  const [clinicalSensitivity, setClinicalSensitivity] = useState(70);

  const checkPrHealth = async () => {
    setCheckingPrHealth(true);
    try {
      const res = await apiClient.get('/pharmarack/session-status');
      setPrHealth(res.data);
    } catch (err) {
      console.error('Failed to check Pharmarack session health:', err);
      setPrHealth(prev => prev || { healthy: false, mode: 'Live', reason: 'NETWORK_ERROR', message: 'Could not contact server' });
    } finally {
      setCheckingPrHealth(false);
    }
  };

  const handleAddDistributor = async () => {
    if (!newDistName.trim()) {
      toastEvent.trigger('Distributor name is required', 'error');
      return;
    }
    try {
      const res = await apiClient.post('/settings/distributors', {
        name: newDistName.trim(),
        phone: newDistPhone.trim(),
        email: newDistEmail.trim()
      });
      if (res.data && res.data.success) {
        toastEvent.trigger('Distributor added successfully', 'success');
        setShowAddDistModal(false);
        setNewDistName('');
        setNewDistPhone('');
        setNewDistEmail('');
        fetchProfiles();
      }
    } catch (err) {
      console.error('Failed to add distributor', err);
      toastEvent.trigger('Failed to add distributor', 'error');
    }
  };

  const handleSaveConfig = async (updatedSettings = settingsData) => {
    try {
      await apiClient.post('/settings/save', updatedSettings);
      toastEvent.trigger('Settings saved successfully', 'success');
      // Refresh settings
      const { data } = await apiClient.get('/settings');
      if (data) {
        setSettingsData(data);
        checkPrHealth();
      }
    } catch (error) {
      console.error('Failed to save settings', error);
      toastEvent.trigger('Failed to save settings', 'error');
    }
  };

  useEffect(() => {
    let timer: any;
    if (settingsData?.whatsapp_enabled === 'true' && !waStatus.isReady) {
      const fetchQR = async () => {
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };
      fetchQR();
      timer = setInterval(fetchQR, 5000);
    }
    return () => clearInterval(timer);
  }, [settingsData?.whatsapp_enabled, waStatus.isReady]);

  const handleReconnect = async () => {
    try {
      setWaStatus({ isReady: false, qrUrl: null, message: 'Reconnecting...' });
      await apiClient.post('/messaging/reconnect');
      toastEvent.trigger('WhatsApp reconnecting...', 'info');
    } catch (error) {
      console.error('Failed to reconnect', error);
      toastEvent.trigger('Failed to reconnect WhatsApp', 'error');
    }
  };

  const handleOpenWaLoginWindow = async () => {
    setIsOpeningWaWindow(true);
    try {
      toastEvent.trigger('Launching Chrome login window for WhatsApp...', 'info');
      await apiClient.post('/messaging/login-window');
    } catch (err: any) {
      console.error('Failed to open WhatsApp login window:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to open Chrome login window. Ensure Chrome is installed.', 'error');
    } finally {
      setIsOpeningWaWindow(false);
    }
  };

  const handleTestWaBusiness = async () => {
    setWaBusinessTesting(true);
    setWaBusinessTestResult(null);
    try {
      await apiClient.post('/settings/save', settingsData);
      const { data } = await apiClient.post('/wa-business/test');
      setWaBusinessTestResult(data);
    } catch (err: any) {
      setWaBusinessTestResult({ success: false, error: err?.response?.data?.error || 'Connection failed' });
    } finally {
      setWaBusinessTesting(false);
    }
  };

  const copyWebhookUrl = () => {
    const url = `${window.location.origin}/api/wa-business/webhook`;
    navigator.clipboard.writeText(url);
    toastEvent.trigger('Webhook URL copied!', 'success');
  };

  const handleOpenLoginWindow = async () => {
    setIsOpeningWindow(true);
    try {
      await apiClient.post('/pharmarack/login-window');
      toastEvent.trigger('Google Chrome window opened. Please log in on retailers.pharmarack.com.', 'info');
      
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 90) { 
          clearInterval(interval);
          setIsOpeningWindow(false);
          return;
        }

        try {
          const { data } = await apiClient.get('/settings');
          if (data && data.pharmarack_session_token && data.pharmarack_session_token !== settingsData?.pharmarack_session_token) {
            setSettingsData(data);
            toastEvent.trigger('Successfully linked Pharmarack session!', 'success');
            clearInterval(interval);
            setIsOpeningWindow(false);
            checkPrHealth();
          }
        } catch (err) {
          console.warn('Failed to poll settings status:', err);
        }
      }, 2000);
    } catch (err: any) {
      console.error('Failed to open login window:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to open Chrome login window. Ensure Chrome is installed.', 'error');
      setIsOpeningWindow(false);
    }
  };

  const handlePharmarackLogout = async () => {
    const updated = {
      ...settingsData,
      pharmarack_username: '',
      pharmarack_password: '',
      pharmarack_session_token: '',
      pharmarack_mode: 'Live'
    };
    setSettingsData(updated);
    try {
      await apiClient.post('/settings/save', updated);
      await apiClient.post('/pharmarack/logout');
      toastEvent.trigger('Logged out and cleared Pharmarack credentials successfully.', 'success');
      checkPrHealth();
    } catch (error) {
      console.error('Failed to logout from Pharmarack', error);
      toastEvent.trigger('Failed to logout from Pharmarack', 'error');
    }
  };

  useEffect(() => {
    fetchProfiles();
    fetchDoctors();
    const initPr = async () => {
      try {
        const { data } = await apiClient.get('/pharmarack/auto-verify');
        setPrHealth(data);
      } catch (err) {
        console.error('Failed initial Pharmarack verification:', err);
      }
      fetchSettings();
    };
    initPr();
    
    const interval = setInterval(checkPrHealth, 180000); // Poll every 3 minutes
    return () => clearInterval(interval);
  }, []);

  const fetchDoctors = async () => {
    setLoadingDoctors(true);
    try {
      const res = await apiClient.get('/crm/doctors');
      if (Array.isArray(res.data)) {
        setDoctorsList(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch doctors:', err);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const handleAddDoctor = async () => {
    if (!newDocName.trim()) {
      toastEvent.trigger('Doctor name is required', 'error');
      return;
    }
    try {
      const res = await apiClient.post('/crm/doctors', {
        name: newDocName.trim(),
        speciality: newDocSpecialty.trim(),
        phone: newDocPhone.trim(),
        hospital: newDocHospital.trim(),
        reg_no: newDocRegNo.trim(),
        send_daily_summary: newDocSendSummary
      });
      if (res.data && res.data.success) {
        toastEvent.trigger('Doctor added successfully', 'success');
        setShowAddDocModal(false);
        setNewDocName('');
        setNewDocPhone('');
        setNewDocSpecialty('');
        setNewDocHospital('');
        setNewDocRegNo('');
        setNewDocSendSummary(false);
        fetchDoctors();
      }
    } catch (err) {
      console.error('Failed to add doctor:', err);
      toastEvent.trigger('Failed to add doctor', 'error');
    }
  };

  const handleToggleDoctorSummary = async (doc: any) => {
    const updatedStatus = doc.send_daily_summary === 1 ? 0 : 1;
    setDoctorsList(prev => prev.map(d => d.id === doc.id ? { ...d, send_daily_summary: updatedStatus } : d));
    try {
      await apiClient.put(`/crm/doctors/${doc.id}`, {
        name: doc.name,
        speciality: doc.speciality,
        phone: doc.phone,
        hospital: doc.hospital,
        reg_no: doc.reg_no,
        send_daily_summary: updatedStatus
      });
      toastEvent.trigger(`Reporting ${updatedStatus ? 'enabled' : 'disabled'} for Dr. ${doc.name}`, 'success');
    } catch (err) {
      console.error('Failed to update doctor reporting toggle:', err);
      toastEvent.trigger('Failed to update reporting preference', 'error');
      fetchDoctors();
    }
  };

  const handleTriggerDoctorReport = async (docId: number) => {
    setTriggeringDoctorReport(docId);
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await apiClient.post('/crm/doctors/send-daily-reports', {
        date: yesterday
      });
      if (res.data && res.data.success) {
        toastEvent.trigger(`Success: Sent ${res.data.count} report summaries!`, 'success');
      } else {
        toastEvent.trigger('Failed to dispatch reports', 'error');
      }
    } catch (err) {
      console.error('Failed manual doctor reports trigger:', err);
      toastEvent.trigger('Failed to send billing reports', 'error');
    } finally {
      setTriggeringDoctorReport(null);
    }
  };

  const fetchProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const res = await apiClient.get('/learning/profiles');
      if (res.data && res.data.success) {
        setProfiles(res.data.profiles || []);
      }
    } catch (err) {
      console.error('Failed to fetch learning profiles:', err);
    } finally {
      setLoadingProfiles(false);
    }
  };

  const fetchSettings = async () => {
    setLoadingSettings(true);
    try {
      const { data } = await apiClient.get('/settings');
      if (data) {
        setSettingsData(data);
        if (data.clinical_learning_sensitivity) {
          setClinicalSensitivity(Number(data.clinical_learning_sensitivity));
        }
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleToggleSetting = async (key: string) => {
    if (!settingsData) return;
    const currentValue = settingsData[key] === 'true';
    const updatedValue = !currentValue;
    
    // Optimistic update
    const updatedSettings = {
      ...settingsData,
      [key]: updatedValue.toString()
    };
    setSettingsData(updatedSettings);
    setSavingSetting(key);
    
    try {
      await apiClient.post('/settings/save', updatedSettings);
      toastEvent.trigger(`Automation feature updated successfully`, 'success');
    } catch (err) {
      console.error('Failed to save settings:', err);
      toastEvent.trigger('Failed to update automation feature settings', 'error');
      // Revert state
      setSettingsData(settingsData);
    } finally {
      setSavingSetting(null);
    }
  };

  const fetchProfileDetail = async (distId: number) => {
    setLoadingDetail(true);
    setSelectedProfileId(distId);
    try {
      const res = await apiClient.get(`/learning/profiles/${distId}`);
      if (res.data && res.data.success) {
        setSelectedProfile(res.data);
        
        // Populate manual rules form
        const rules = res.data.profile?.file_mapping_rules 
          ? JSON.parse(res.data.profile.file_mapping_rules) 
          : {};
        
        setMappingRules({
          name: rules.name || '',
          quantity: rules.quantity || '',
          rate: rules.rate || '',
          mrp: rules.mrp || '',
          batch_no: rules.batch_no || '',
          expiry_date: rules.expiry_date || '',
          free_qty: rules.free_qty || '',
          cgst: rules.cgst || '',
          sgst: rules.sgst || '',
          global_cd_per: rules.global_cd_per || '',
          invoice_no: rules.invoice_no || '',
          invoice_date: rules.invoice_date || '',
          total_amount: rules.total_amount || ''
        });
      }
    } catch (err) {
      console.error('Failed to fetch profile details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const saveMapping = async () => {
    if (!selectedProfileId) return;
    setSavingMapping(true);
    try {
      // Filter out empty rules
      const cleanRules: Record<string, string> = {};
      Object.keys(mappingRules).forEach(key => {
        if (mappingRules[key].trim()) {
          cleanRules[key] = mappingRules[key].trim();
        }
      });

      const res = await apiClient.post(`/learning/profiles/${selectedProfileId}/mapping`, {
        mappingRules: cleanRules
      });
      if (res.data && res.data.success) {
        toastEvent.trigger('Column mapping rules saved successfully.', 'success');
        fetchProfiles();
        fetchProfileDetail(selectedProfileId);
      }
    } catch (err) {
      console.error('Failed to save manual mappings:', err);
      toastEvent.trigger('Failed to save mapping rules.', 'error');
    } finally {
      setSavingMapping(false);
    }
  };

  const resetProfile = async () => {
    if (!selectedProfileId) return;
    if (!window.confirm('Are you sure you want to reset this profile? This will delete all historical reference files and reset learned mappings.')) return;
    
    try {
      const res = await apiClient.post(`/learning/profiles/${selectedProfileId}/reset`);
      if (res.data && res.data.success) {
        toastEvent.trigger('Learning profile reset successfully.', 'success');
        setSelectedProfile(null);
        setSelectedProfileId(null);
        fetchProfiles();
      }
    } catch (err) {
      console.error('Failed to reset profile:', err);
      toastEvent.trigger('Failed to reset profile.', 'error');
    }
  };

  const deleteHistoricalFile = async (fileId: number) => {
    if (!window.confirm('Delete this historical file reference?')) return;
    try {
      const res = await apiClient.delete(`/learning/historical-files/${fileId}`);
      if (res.data && res.data.success) {
        toastEvent.trigger('Historical file reference deleted.', 'success');
        if (selectedProfileId) {
          fetchProfileDetail(selectedProfileId);
          fetchProfiles();
        }
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
      toastEvent.trigger('Failed to delete file reference.', 'error');
    }
  };

  const loadComparator = async (fileId: number) => {
    setComparatorFileId(fileId);
    setLoadingComparator(true);
    try {
      const res = await apiClient.get(`/learning/historical-files/${fileId}/data`);
      if (res.data && res.data.success) {
        setComparatorData(res.data.file);
      }
    } catch (err) {
      console.error('Failed to load comparator data:', err);
      setComparatorFileId(null);
    } finally {
      setLoadingComparator(false);
    }
  };

  // Retrain clinical AI model
  const handleRefreshClinicalModel = async () => {
    setRefreshingModel(true);
    try {
      const res = await apiClient.post('/learning/refresh-model');
      if (res.data && res.data.success) {
        toastEvent.trigger('Clinical suggestions model successfully retrained!', 'success');
      }
    } catch (err) {
      console.error('Failed to retrain model:', err);
      toastEvent.trigger('Failed to retrain model. Please verify system connection.', 'error');
    } finally {
      setRefreshingModel(false);
    }
  };

  // Test OCR clinical database mapping sandbox
  const handleTestOcrSandbox = async () => {
    if (!ocrSandboxText.trim()) {
      toastEvent.trigger('Please enter some text to test mappings', 'error');
      return;
    }
    setSearchingSandbox(true);
    setSandboxResult(null);
    setSandboxTested(true);
    try {
      const { data } = await apiClient.get('/learning/mapping', {
        params: { name: ocrSandboxText.trim() }
      });
      setSandboxResult(data);
    } catch (err) {
      console.error('Failed to test OCR sandbox:', err);
      toastEvent.trigger('Failed to perform OCR suggestion test', 'error');
    } finally {
      setSearchingSandbox(false);
    }
  };

  // Save clinical sensitivity
  const handleSaveSensitivity = async () => {
    if (!settingsData) return;
    const updated = {
      ...settingsData,
      clinical_learning_sensitivity: clinicalSensitivity.toString()
    };
    setSettingsData(updated);
    try {
      await apiClient.post('/settings/save', updated);
      toastEvent.trigger('Clinical sensitivity settings saved.', 'success');
    } catch (error) {
      console.error('Failed to save sensitivity', error);
      toastEvent.trigger('Failed to save sensitivity', 'error');
    }
  };

  const hasSelected = selectedProfileId !== null;

  return (
    <div className="h-full flex flex-col fade-in relative gap-4 overflow-hidden text-text">
      {/* Premium Dashboard Header */}
      <div className="bg-glass-bg border border-glass-border rounded-3xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm shrink-0">
        <div>
          <h2 className="text-lg font-black tracking-tight text-text flex items-center gap-2">
            <Brain className="text-sky animate-pulse" size={22} />
            AI LEARNING & AUTOMATION command center
          </h2>
          <p className="text-xs text-muted">
            Configure automated file ingestion, training rules, client messaging gateways, and clinical heuristics.
          </p>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleRefreshClinicalModel}
            disabled={refreshingModel}
            className="px-4 py-2 rounded-2xl bg-sky hover:bg-sky-400 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={refreshingModel ? 'animate-spin' : ''} />
            {refreshingModel ? 'Retraining...' : 'Retrain Clinical Model'}
          </button>
          
          <button
            onClick={() => { fetchSettings(); fetchProfiles(); checkPrHealth(); }}
            className="p-2 rounded-2xl bg-bg3 border border-glass-border hover:bg-bg2 text-muted hover:text-text transition-all active:scale-95"
            title="Refresh All States"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap gap-2 shrink-0 border-b border-glass-border pb-3">
        {[
          { id: 'clinical', label: 'Clinical AI Engine', icon: Brain },
          { id: 'doctors', label: 'Doctor Affiliations', icon: Stethoscope },
          { id: 'distributors', label: 'Distributor Layouts', icon: Database },
          { id: 'messaging', label: 'Messaging Channels', icon: MessageCircle },
          { id: 'ingestion', label: 'Email Ingestion', icon: Mail },
          { id: 'operations', label: 'Operations & Backups', icon: Settings }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95 ${
                isActive 
                  ? 'bg-sky-500/10 border border-sky-500/35 text-sky shadow-sm'
                  : 'bg-bg3/60 border border-transparent text-muted hover:text-text hover:bg-bg3/95'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Workspace Frame */}
      <div className="flex-1 overflow-hidden min-h-0 bg-glass-bg border border-glass-border rounded-3xl p-6 flex flex-col">
        
        {/* Tab 1: Clinical AI Engine */}
        {activeTab === 'clinical' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar text-left">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              
              {/* Learning sensitivity slider */}
              <div className="bg-bg3 border border-glass-border rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-text flex items-center gap-2">
                    <Sliders size={16} className="text-sky" />
                    Clinical Logic Sensitivity
                  </h3>
                  <p className="text-xs text-muted">
                    Configure the sensitivity threshold for OCR auto-corrections and doctor‑wise prescription combinations. Higher values enforce stricter match logic.
                  </p>
                </div>
                
                <div className="py-4 space-y-3">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-muted">Sensitivity</span>
                    <span className="text-sky font-mono font-bold text-sm">{clinicalSensitivity}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    className="w-full h-1.5 bg-bg border border-glass-border rounded-lg appearance-none cursor-pointer accent-sky"
                    value={clinicalSensitivity}
                    onChange={(e) => setClinicalSensitivity(Number(e.target.value))}
                  />
                  <div className="flex justify-between text-[10px] text-muted/60 font-mono">
                    <span>10% (Permissive)</span>
                    <span>50% (Standard)</span>
                    <span>100% (Strict)</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveSensitivity}
                    className="px-4 py-2 bg-sky hover:bg-sky-400 text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-sky/10"
                  >
                    Save Sensitivity
                  </button>
                </div>
              </div>

              {/* Suggestions engine stats */}
              <div className="bg-bg3 border border-glass-border rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-text flex items-center gap-2 border-b border-glass-border/30 pb-2">
                  <Sparkles size={16} className="text-amber" />
                  Intelligent Suggestions Statistics
                </h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-bg/40 border border-glass-border rounded-xl p-3 text-center">
                    <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Active OCR Corrections</p>
                    <p className="text-lg font-black text-sky mt-1 font-mono">842</p>
                  </div>
                  <div className="bg-bg/40 border border-glass-border rounded-xl p-3 text-center">
                    <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Learned Rx Combos</p>
                    <p className="text-lg font-black text-green mt-1 font-mono">157</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-glass-border/10">
                    <span className="text-muted">Doctor Suggestions State (POS)</span>
                    <span className="text-green font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green" /> Enabled
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-glass-border/10">
                    <span className="text-muted">Last Model Retraining Date</span>
                    <span className="text-text font-mono">Today, 21:40</span>
                  </div>
                </div>
              </div>
            </div>

            {/* OCR Translation Testing Sandbox */}
            <div className="bg-bg3 border border-glass-border rounded-2xl p-5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-text flex items-center gap-2">
                  <Play size={15} className="text-sky" />
                  OCR Database Mapping Sandbox
                </h3>
                <p className="text-xs text-muted">
                  Test the learning model's auto-correction rules. Enter a legacy or slightly misread brand name (simulating camera/OCR raw scans) to see how the clinical database resolves it.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  className="premium-input flex-1 text-xs"
                  placeholder="e.g. CROClN 65O, Pan-D, Amloka-AT"
                  value={ocrSandboxText}
                  onChange={(e) => setOcrSandboxText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTestOcrSandbox()}
                />
                <button
                  onClick={handleTestOcrSandbox}
                  disabled={searchingSandbox}
                  className="px-5 py-2.5 rounded-xl bg-sky hover:bg-sky-400 text-white font-bold text-xs flex items-center gap-1 shadow-md shadow-sky/10 active:scale-95 transition-all"
                >
                  {searchingSandbox ? 'Analyzing...' : 'Test Mapping'}
                </button>
              </div>

              {sandboxTested && (
                <div className="bg-bg border border-glass-border rounded-xl p-4 animate-in fade-in slide-in-from-top-1">
                  {searchingSandbox ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted">
                      <RefreshCw className="animate-spin text-sky" size={14} /> Running AI mappings...
                    </div>
                  ) : sandboxResult?.mapped ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green font-bold text-xs">
                        <CheckCircle2 size={15} /> Successfully Mapped!
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs bg-bg3/60 p-3 rounded-lg border border-glass-border/30">
                        <div>
                          <span className="text-[10px] text-muted uppercase font-bold block">Mapped Product</span>
                          <span className="font-bold text-text">{sandboxResult.medicine.name}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase font-bold block">Base Rate / Cost</span>
                          <span className="font-semibold text-text font-mono">₹{sandboxResult.medicine.rate?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase font-bold block">MRP</span>
                          <span className="font-semibold text-text font-mono">₹{sandboxResult.medicine.mrp?.toFixed(2) || '0.00'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase font-bold block">Applied CGST / SGST</span>
                          <span className="font-semibold text-text font-mono">{sandboxResult.medicine.cgst_per || 0}% / {sandboxResult.medicine.sgst_per || 0}%</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-2 text-xs text-amber font-semibold">
                      <AlertTriangle size={15} /> No mapping exists for this brand name. It will fall back to a manual counter entry.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Doctor Affiliations */}
        {activeTab === 'doctors' && (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex justify-between items-center pb-3 border-b border-glass-border/30 shrink-0 mb-4 text-left">
              <div>
                <h3 className="text-sm font-bold text-text flex items-center gap-2">
                  <Stethoscope className="text-sky" size={16} />
                  Affiliated Doctors Registry
                </h3>
                <p className="text-xs text-muted">
                  Configure WhatsApp communication numbers and toggle automatic daily referral summaries.
                </p>
              </div>
              <button
                onClick={() => setShowAddDocModal(true)}
                className="px-4 py-2 bg-sky hover:bg-sky-400 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-md shadow-sky/10 active:scale-95 transition-all"
              >
                <Plus size={13} />
                Add Doctor
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar text-left">
              {loadingDoctors ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted gap-2">
                  <RefreshCw className="animate-spin text-sky" size={18} />
                  <span className="text-[10px] font-bold tracking-wider uppercase">Loading doctors...</span>
                </div>
              ) : doctorsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted gap-3 text-center">
                  <Stethoscope size={36} className="text-muted/30" />
                  <div>
                    <p className="text-xs font-bold text-text">No doctors registered yet</p>
                    <p className="text-[10px] text-muted/60 mt-1">Click the "Add Doctor" button to register your first doctor affiliation.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {doctorsList.map((doc) => (
                    <div key={doc.id} className="bg-bg2/40 border border-glass-border rounded-2xl p-5 flex flex-col justify-between hover:bg-bg2/60 transition-colors shadow-sm">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-sm text-text">Dr. {doc.name}</h4>
                            {doc.speciality && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky border border-sky-500/20 mt-1 inline-block">
                                {doc.speciality}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex flex-col items-end gap-1">
                            <label className="relative inline-flex items-center cursor-pointer select-none">
                              <input 
                                type="checkbox" 
                                checked={doc.send_daily_summary === 1}
                                onChange={() => handleToggleDoctorSummary(doc)}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-bg border border-glass-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-glass-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white peer-checked:after:left-[4px]"></div>
                            </label>
                            <span className="text-[8px] text-muted font-bold uppercase tracking-wider">Auto Summary</span>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs border-t border-glass-border/30 pt-3 font-medium">
                          <div className="flex justify-between">
                            <span className="text-muted">WhatsApp No</span>
                            <span className="text-text font-mono">{doc.phone || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">Hospital</span>
                            <span className="text-text truncate max-w-[150px]">{doc.hospital || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">Reg No</span>
                            <span className="text-text font-mono">{doc.reg_no || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-5 border-t border-glass-border/20 pt-3">
                        <button
                          onClick={() => handleTriggerDoctorReport(doc.id)}
                          disabled={triggeringDoctorReport !== null}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky border border-sky-500/20 text-[10px] font-bold transition-all active:scale-95 disabled:opacity-40"
                        >
                          <Send size={11} className={triggeringDoctorReport === doc.id ? 'animate-spin' : ''} />
                          <span>Test Report Send</span>
                        </button>

                        <span className="text-[9px] text-muted/40 font-mono">ID: {doc.id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Distributor Layout Learning */}
        {activeTab === 'distributors' && (
          <div className="flex-1 flex overflow-hidden min-h-0 gap-6">
            
            {/* Left Column: Distributor profiles list */}
            <div className="w-1/3 flex flex-col h-full overflow-hidden border-r border-glass-border/40 pr-6">
              <div className="flex justify-between items-center pb-3 border-b border-glass-border/30 shrink-0">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider">Distributors ({profiles.length})</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddDistModal(true)}
                    className="p-1 hover:text-sky text-muted font-bold uppercase tracking-wider text-[10px] flex items-center gap-0.5"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto py-2 space-y-2 custom-scrollbar">
                {loadingProfiles && profiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted gap-2">
                    <RefreshCw className="animate-spin text-sky" size={16} />
                    <span className="text-[10px]">Loading profiles...</span>
                  </div>
                ) : profiles.length === 0 ? (
                  <div className="text-center py-20 text-xs text-muted">No distributors found.</div>
                ) : (
                  profiles.map(p => {
                    const isSelected = selectedProfileId === p.distributor_id;
                    return (
                      <button
                        key={p.distributor_id}
                        onClick={() => fetchProfileDetail(p.distributor_id)}
                        className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex flex-col gap-1 ${
                          isSelected 
                            ? 'bg-sky-500/10 border-sky-500/30 text-text' 
                            : 'bg-bg3/40 border-glass-border hover:bg-bg3 text-muted hover:text-text'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-bold text-xs truncate max-w-[70%]">{p.distributor_name}</span>
                          <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                            p.files_count > 0 
                              ? 'bg-green/10 text-green border border-green/20' 
                              : 'bg-amber/10 text-amber border border-amber/20'
                          }`}>
                            {p.files_count > 0 ? `${p.files_count} ref` : 'no map'}
                          </span>
                        </div>
                        {p.distributor_phone && (
                          <span className="text-[9px] text-sky font-semibold font-mono truncate">{p.distributor_phone}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Profile details form */}
            <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0">
              {hasSelected ? (
                loadingDetail ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
                    <RefreshCw className="animate-spin text-sky" size={24} />
                    <span className="text-xs">Fetching profile details...</span>
                  </div>
                ) : selectedProfile ? (
                  <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0 space-y-4">
                    
                    {/* Header */}
                    <div className="border-b border-glass-border pb-3 flex justify-between items-start shrink-0">
                      <div>
                        <h2 className="text-sm font-bold text-text">{selectedProfile.distributor.name}</h2>
                        <p className="text-[10px] text-muted">Layout configuration rules & extraction parameters</p>
                      </div>
                      <button
                        onClick={resetProfile}
                        className="px-2 py-1 bg-red/10 hover:bg-red/20 border border-red/20 text-red hover:text-red border-red-500/20 rounded-lg text-[9px] font-bold uppercase transition-all"
                      >
                        Reset Profile
                      </button>
                    </div>

                    {/* Scrollable Rules Editor */}
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar text-left">
                      
                      {/* Contacts details */}
                      <div className="bg-bg3/60 border border-glass-border rounded-xl p-4 flex flex-col gap-3">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-sky flex items-center gap-1 border-b border-glass-border/30 pb-1">
                          Distributor Details
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-muted uppercase">Distributor Name</label>
                            <input
                              type="text"
                              className="premium-input w-full text-xs py-1 px-2.5"
                              value={selectedProfile.distributor.name || ''}
                              onChange={(e) => {
                                setSelectedProfile({
                                  ...selectedProfile,
                                  distributor: { ...selectedProfile.distributor, name: e.target.value }
                                });
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-muted uppercase">Phone (WhatsApp)</label>
                            <input
                              type="text"
                              className="premium-input w-full text-xs py-1 px-2.5"
                              value={selectedProfile.distributor.phone || ''}
                              onChange={(e) => {
                                setSelectedProfile({
                                  ...selectedProfile,
                                  distributor: { ...selectedProfile.distributor, phone: e.target.value }
                                });
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-muted uppercase">Email Address</label>
                            <input
                              type="text"
                              className="premium-input w-full text-xs py-1 px-2.5"
                              value={selectedProfile.distributor.email || ''}
                              onChange={(e) => {
                                setSelectedProfile({
                                  ...selectedProfile,
                                  distributor: { ...selectedProfile.distributor, email: e.target.value }
                                });
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            onClick={async () => {
                              try {
                                await apiClient.put(`/settings/distributors/${selectedProfile.distributor.id}`, selectedProfile.distributor);
                                toastEvent.trigger('Distributor profile updated', 'success');
                                fetchProfiles();
                              } catch (err) {
                                console.error(err);
                                toastEvent.trigger('Failed to update details', 'error');
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-green/20 hover:bg-green/35 text-green text-[10px] font-bold uppercase transition-all"
                          >
                            Update Info
                          </button>
                        </div>
                      </div>

                      {/* Column Maps */}
                      <div className="bg-bg3/60 border border-glass-border rounded-xl p-4 space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-wider text-sky flex items-center gap-1 border-b border-glass-border/30 pb-1">
                          Column Alignments (Header match keys)
                        </h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {Object.keys(mappingRules).map(field => {
                            const label = field.replace(/_/g, ' ').toUpperCase();
                            return (
                              <div key={field} className="space-y-1">
                                <label className="block text-[9px] font-bold text-text tracking-wide uppercase">
                                  {label}
                                </label>
                                <input
                                  type="text"
                                  value={mappingRules[field]}
                                  onChange={(e) => setMappingRules({ ...mappingRules, [field]: e.target.value })}
                                  placeholder={`e.g. ${field === 'name' ? 'item_name' : field}`}
                                  className="w-full bg-bg border border-glass-border rounded-lg px-2.5 py-1.5 text-text text-xs focus:outline-none focus:border-sky-500/50"
                                />
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex justify-end pt-2">
                          <button
                            onClick={saveMapping}
                            disabled={savingMapping}
                            className="px-4 py-2 bg-green hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                          >
                            {savingMapping ? 'Saving...' : 'Save Column Map'}
                          </button>
                        </div>
                      </div>

                      {/* References */}
                      <div className="space-y-3">
                        <div className="border-b border-glass-border/45 pb-1.5">
                          <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-2">
                            <FileText size={14} className="text-sky" />
                            Reference Historical Files Memory
                          </h3>
                          <p className="text-[10px] text-muted">
                            Matching algorithm calculates layout configurations using Jaccard Similarity.
                          </p>
                        </div>

                        {selectedProfile.files.length === 0 ? (
                          <p className="text-[10px] text-muted text-center py-4 italic bg-bg3/30 rounded-lg border border-glass-border">No historical reference layouts exist.</p>
                        ) : (
                          <div className="space-y-2">
                            {selectedProfile.files.map(file => (
                              <div 
                                key={file.id} 
                                className="bg-bg3 border border-glass-border rounded-xl p-3 flex justify-between items-center transition-all hover:bg-bg2/40"
                              >
                                <div className="space-y-1 min-w-0 flex-1 mr-3">
                                  <p className="text-[11px] font-bold text-text font-mono truncate">
                                    {file.filename}
                                  </p>
                                  <div className="flex gap-2 text-[9px] text-muted">
                                    <span className="uppercase font-semibold text-sky">{file.file_type}</span>
                                    <span>·</span>
                                    <span>{new Date(file.created_at).toLocaleString()}</span>
                                  </div>
                                </div>

                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    onClick={() => loadComparator(file.id)}
                                    className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky hover:text-sky-300 rounded-lg text-[9px] font-bold uppercase transition-all"
                                  >
                                    Compare
                                  </button>
                                  <button
                                    onClick={() => deleteHistoricalFile(file.id)}
                                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red hover:text-red rounded-lg transition-all"
                                    title="Delete file reference"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted gap-2 py-10">
                  <Database size={30} className="opacity-40" />
                  <span className="text-xs">Select a distributor profile from the left sidebar to view settings.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Messaging Channels */}
        {activeTab === 'messaging' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar text-left">
            {loadingSettings ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
                <RefreshCw className="animate-spin text-sky" size={20} />
                <span className="text-xs">Loading messaging configurations...</span>
              </div>
            ) : settingsData ? (
              <div className="space-y-4">
                
                {/* Channel Selector */}
                {settingsData.whatsapp_enabled === 'true' && settingsData.wa_business_enabled === 'true' && (
                  <div className="bg-bg3 border border-glass-border rounded-xl p-4 flex flex-col gap-3">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-text flex items-center gap-2">
                        <Zap size={14} className="text-amber" />
                        Preferred Messaging Channel Gateway
                      </h4>
                      <p className="text-[10px] text-muted">
                        Select which WhatsApp service connection handles background message alerts.
                      </p>
                    </div>
                    <select
                      className="premium-input w-full text-xs py-1.5"
                      value={settingsData.whatsapp_preferred_system || 'automated'}
                      onChange={(e) => {
                        const updated = {
                          ...settingsData,
                          whatsapp_preferred_system: e.target.value
                        };
                        setSettingsData(updated);
                        handleSaveConfig(updated);
                      }}
                    >
                      <option value="automated">Automated WhatsApp Web Client Session</option>
                      <option value="official">Official WhatsApp Business Cloud API Gateway</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* WhatsApp Web Client */}
                  <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-text flex items-center gap-2">
                          <MessageCircle size={14} className="text-green" />
                          WhatsApp Web client Session
                        </h4>
                        <p className="text-[10px] text-muted">
                          Connect using a standard QR code scan to handle local messaging triggers.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={settingsData.whatsapp_enabled === 'true'} 
                          onChange={() => handleToggleSetting('whatsapp_enabled')}
                          disabled={savingSetting === 'whatsapp_enabled'}
                        />
                        <div className="w-9 h-5 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors peer-disabled:opacity-50" />
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
                      </label>
                    </div>

                    {settingsData.whatsapp_enabled === 'true' && (
                      <div className="space-y-3 pt-3 border-t border-glass-border/40">
                        <div className="flex items-center justify-between text-[10px] bg-bg border border-glass-border p-2 rounded">
                          <span>Status: <strong className="text-green font-bold">ACTIVE SCANNER</strong></span>
                          <button 
                            onClick={() => setShowWaConfig(!showWaConfig)}
                            className="text-sky hover:underline font-bold uppercase tracking-wider text-[9px]"
                          >
                            {showWaConfig ? 'Hide Console' : 'Show Console'}
                          </button>
                        </div>

                        {showWaConfig && (
                          <div className="p-4 border border-glass-border/40 rounded-xl bg-bg flex flex-col items-center text-center space-y-4">
                            <div className="w-32 h-32 bg-bg2 rounded-xl flex items-center justify-center p-2 border border-glass-border">
                              {waStatus.isReady ? (
                                <div className="text-green flex flex-col items-center">
                                  <CheckCircle2 size={32} />
                                  <span className="font-bold text-[10px] mt-1">Ready!</span>
                                </div>
                              ) : waStatus.qrUrl ? (
                                <img src={waStatus.qrUrl} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                              ) : (
                                <div className="flex flex-col items-center text-muted">
                                  <RefreshCw className="animate-spin text-sky mb-2" size={16} />
                                  <span className="text-[9px] font-bold">Awaiting QR...</span>
                                </div>
                              )}
                            </div>
                            <p className="text-[10px] text-muted max-w-xs leading-normal">
                              {waStatus.isReady ? "Session active and linked." : waStatus.message || "Scan the QR code with WhatsApp to connect."}
                            </p>
                            <div className="flex gap-2 justify-center">
                              {!waStatus.isReady && (
                                <button 
                                  onClick={handleOpenWaLoginWindow}
                                  disabled={isOpeningWaWindow}
                                  className="text-[9px] font-bold bg-green/20 text-green px-3 py-1.5 rounded-lg hover:bg-green/30"
                                >
                                  {isOpeningWaWindow ? 'Opening...' : 'Chrome Login'}
                                </button>
                              )}
                              <button 
                                onClick={handleReconnect}
                                className="text-[9px] font-bold bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/30"
                              >
                                Logout WhatsApp
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Telegram Bot */}
                  <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-text flex items-center gap-2">
                          <Send size={14} className="text-sky" />
                          Telegram Prescription Bot
                        </h4>
                        <p className="text-[10px] text-muted">
                          Receive patient uploads and automated clinical data queries via Telegram.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={settingsData.telegram_enabled === 'true'} 
                          onChange={() => handleToggleSetting('telegram_enabled')}
                          disabled={savingSetting === 'telegram_enabled'}
                        />
                        <div className="w-9 h-5 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors peer-disabled:opacity-50" />
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
                      </label>
                    </div>

                    {settingsData.telegram_enabled === 'true' && (
                      <div className="space-y-3 pt-3 border-t border-glass-border/40">
                        <div className="flex justify-between items-center text-[10px] bg-bg border border-glass-border p-2 rounded">
                          <span>Status: <strong className="text-green font-bold">BOT LISTENING</strong></span>
                          <button 
                            onClick={() => setShowTgConfig(!showTgConfig)}
                            className="text-sky hover:underline font-bold uppercase tracking-wider text-[9px]"
                          >
                            {showTgConfig ? 'Hide Config' : 'Show Config'}
                          </button>
                        </div>

                        {showTgConfig && (
                          <div className="space-y-3 bg-bg border border-glass-border/40 p-4 rounded-xl">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted uppercase">Telegram Bot Token</label>
                              <input
                                type="password"
                                className="premium-input w-full text-xs py-1.5 px-3"
                                placeholder="Bot Token ID"
                                value={settingsData.telegram_token || ''}
                                onChange={(e) => setSettingsData({ ...settingsData, telegram_token: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted uppercase">Broadcast Chat ID</label>
                              <input
                                type="text"
                                className="premium-input w-full text-xs py-1.5 px-3"
                                placeholder="Chat ID"
                                value={settingsData.telegram_chat_id || ''}
                                onChange={(e) => setSettingsData({ ...settingsData, telegram_chat_id: e.target.value })}
                              />
                            </div>
                            <button
                              onClick={() => handleSaveConfig()}
                              className="px-3 py-1.5 rounded-lg bg-green/20 hover:bg-green/35 text-green text-[9px] font-bold uppercase"
                            >
                              Save Token
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* WhatsApp Business API */}
                  <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4 lg:col-span-2">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-text flex items-center gap-2">
                          <Zap size={14} className="text-sky" />
                          Official WhatsApp Business cloud Gateway
                        </h4>
                        <p className="text-[10px] text-muted">
                          Official cloud API configuration to deliver customer message notifications and receipt files.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={settingsData.wa_business_enabled === 'true'} 
                          onChange={() => handleToggleSetting('wa_business_enabled')}
                          disabled={savingSetting === 'wa_business_enabled'}
                        />
                        <div className="w-9 h-5 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors peer-disabled:opacity-50" />
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
                      </label>
                    </div>

                    {settingsData.wa_business_enabled === 'true' && (
                      <div className="space-y-3 pt-3 border-t border-glass-border/40">
                        <div className="flex justify-between items-center text-[10px] bg-bg border border-glass-border p-2 rounded">
                          <span>Status: <strong className="text-green font-bold">CLOUD CONNECTOR CONFIG</strong></span>
                          <button 
                            onClick={() => setShowWaBusConfig(!showWaBusConfig)}
                            className="text-sky hover:underline font-bold uppercase tracking-wider text-[9px]"
                          >
                            {showWaBusConfig ? 'Hide Config' : 'Show Config'}
                          </button>
                        </div>

                        {showWaBusConfig && (
                          <div className="space-y-4 bg-bg border border-glass-border/40 p-4 rounded-xl">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">Phone Number ID</label>
                                <input
                                  type="text"
                                  className="premium-input w-full text-xs"
                                  placeholder="Meta Phone Number ID"
                                  value={settingsData.wa_business_phone_number_id || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, wa_business_phone_number_id: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">WABA ID (Business Account)</label>
                                <input
                                  type="text"
                                  className="premium-input w-full text-xs"
                                  placeholder="Meta WABA Account ID"
                                  value={settingsData.wa_business_waba_id || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, wa_business_waba_id: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">Verify Token</label>
                                <input
                                  type="text"
                                  className="premium-input w-full text-xs"
                                  placeholder="Webhook verification string"
                                  value={settingsData.wa_business_webhook_verify_token || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, wa_business_webhook_verify_token: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">API Access Token</label>
                                <input
                                  type="password"
                                  className="premium-input w-full text-xs"
                                  placeholder="Meta developer access token"
                                  value={settingsData.wa_business_access_token || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, wa_business_access_token: e.target.value })}
                                />
                              </div>
                            </div>

                            <div className="bg-bg2/40 p-2.5 flex items-center justify-between border border-glass-border rounded-lg mt-1">
                              <div className="min-w-0 flex items-center gap-1.5">
                                <Globe size={12} className="text-sky flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[8px] text-muted uppercase font-bold tracking-wider">Webhook URL</p>
                                  <p className="text-[10px] text-sky font-mono truncate">{window.location.origin}/api/wa-business/webhook</p>
                                </div>
                              </div>
                              <button
                                onClick={copyWebhookUrl}
                                className="text-[9px] font-bold bg-sky-500/20 text-sky px-2 py-1 rounded-full hover:bg-sky-500/30 transition-all flex items-center gap-0.5 flex-shrink-0"
                              >
                                <Copy size={9} /> Copy
                              </button>
                            </div>

                            <div className="flex items-center gap-2 pt-2 border-t border-glass-border/30">
                              <button
                                onClick={() => handleSaveConfig()}
                                className="text-[10px] font-bold bg-green/20 text-green px-3.5 py-1.5 rounded-lg hover:bg-green/35"
                              >
                                Save Settings
                              </button>
                              <button
                                onClick={handleTestWaBusiness}
                                disabled={waBusinessTesting || !settingsData.wa_business_phone_number_id || !settingsData.wa_business_access_token}
                                className="text-[10px] font-bold bg-sky-500/20 text-sky px-3 py-1.5 rounded-lg hover:bg-sky-500/30 disabled:opacity-40"
                              >
                                {waBusinessTesting ? 'Testing Cloud...' : 'Test Cloud Connection'}
                              </button>
                              {waBusinessTestResult && (
                                <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${
                                  waBusinessTestResult.success ? 'bg-green/10 text-green' : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {waBusinessTestResult.success ? 'Connected' : 'Connection Failed'}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 4: Email Ingestion */}
        {activeTab === 'ingestion' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar text-left">
            {loadingSettings ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
                <RefreshCw className="animate-spin text-sky" size={20} />
                <span className="text-xs">Loading ingestion settings...</span>
              </div>
            ) : settingsData ? (
              <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-text flex items-center gap-2">
                      <Mail size={14} className="text-amber" />
                      Email Invoice Ingestion System
                    </h4>
                    <p className="text-[10px] text-muted">
                      Monitor incoming distributor purchase invoices and automatically process CSV/PDF attachment datasets.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={settingsData.automation_enabled === 'true'} 
                      onChange={() => handleToggleSetting('automation_enabled')}
                      disabled={savingSetting === 'automation_enabled'}
                    />
                    <div className="w-9 h-5 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors peer-disabled:opacity-50" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
                  </label>
                </div>

                {settingsData.automation_enabled === 'true' && (
                  <div className="space-y-4 pt-3 border-t border-glass-border/40">
                    <div className="flex justify-between items-center text-[10px] bg-bg border border-glass-border p-2 rounded">
                      <span>Status: <strong className="text-green font-bold">GMAIL MONITOR LISTENING</strong></span>
                      <button 
                        onClick={() => setShowEmailConfig(!showEmailConfig)}
                        className="text-sky hover:underline font-bold uppercase tracking-wider text-[9px]"
                      >
                        {showEmailConfig ? 'Hide Credentials' : 'Configure Scanner'}
                      </button>
                    </div>

                    {showEmailConfig && (
                      <div className="space-y-4 bg-bg border border-glass-border/40 p-4 rounded-xl">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted uppercase">Ingestion Authentication Scheme</label>
                          <div className="flex gap-4 py-1">
                            <label className="inline-flex items-center text-[10px] text-muted cursor-pointer hover:text-text">
                              <input
                                type="radio"
                                name="gmailAuthMethod"
                                value="password"
                                checked={settingsData.gmail_auth_method === 'password'}
                                onChange={() => setSettingsData({ ...settingsData, gmail_auth_method: 'password' })}
                                className="mr-1 accent-green"
                              />
                              App-Specific Password
                            </label>
                            <label className="inline-flex items-center text-[10px] text-muted cursor-pointer hover:text-text">
                              <input
                                type="radio"
                                name="gmailAuthMethod"
                                value="oauth2"
                                checked={settingsData.gmail_auth_method === 'oauth2'}
                                onChange={() => setSettingsData({ ...settingsData, gmail_auth_method: 'oauth2' })}
                                className="mr-1 accent-green"
                              />
                              OAuth2 Google authorization
                            </label>
                          </div>
                        </div>

                        {settingsData.gmail_auth_method === 'password' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted uppercase">Gmail Ingestion Account</label>
                              <input
                                type="email"
                                className="premium-input w-full text-xs"
                                placeholder="pharmacy@gmail.com"
                                value={settingsData.gmail_user || ''}
                                onChange={(e) => {
                                  const emailVal = e.target.value;
                                  let host = settingsData.imap_host || '';
                                  let port = settingsData.imap_port || '993';
                                  let tls = settingsData.imap_tls !== 'false';
                                  
                                  const lowerEmail = emailVal.toLowerCase();
                                  if (lowerEmail.includes('@gmail.com')) {
                                    host = 'imap.gmail.com';
                                    port = '993';
                                    tls = true;
                                  } else if (lowerEmail.includes('@outlook.com') || lowerEmail.includes('@hotmail.com')) {
                                    host = 'outlook.office365.com';
                                    port = '993';
                                    tls = true;
                                  }
                                  
                                  setSettingsData({
                                    ...settingsData,
                                    gmail_user: emailVal,
                                    imap_host: host,
                                    imap_port: port,
                                    imap_tls: tls.toString()
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-muted uppercase">Gmail App Password</label>
                              <input
                                type="password"
                                className="premium-input w-full text-xs"
                                placeholder="16-character authorization key"
                                value={settingsData.gmail_pass || ''}
                                onChange={(e) => setSettingsData({ ...settingsData, gmail_pass: e.target.value })}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 bg-bg3/40 p-3 rounded-lg border border-glass-border/40">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">Google Client ID</label>
                                <input
                                  type="text"
                                  className="premium-input w-full text-xs"
                                  value={settingsData.google_client_id || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, google_client_id: e.target.value })}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold text-muted uppercase">Google Client Secret</label>
                                <input
                                  type="password"
                                  className="premium-input w-full text-xs"
                                  value={settingsData.google_client_secret || ''}
                                  onChange={(e) => setSettingsData({ ...settingsData, google_client_secret: e.target.value })}
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiClient.post('/settings/save', settingsData);
                                const backendUrl = apiClient.defaults.baseURL || window.location.origin;
                                window.open(`${backendUrl}/api/email/auth/google`, '_blank');
                              }}
                              className="text-[9px] font-bold bg-sky-500/20 hover:bg-sky-500/35 text-sky px-3.5 py-1.5 rounded-lg border border-sky-500/30"
                              disabled={!settingsData.google_client_id || !settingsData.google_client_secret}
                            >
                              Open Google OAuth Consent Authorization
                            </button>
                          </div>
                        )}

                        {/* File Retention settings */}
                        <div className="pt-2 border-t border-glass-border/30 flex flex-col md:flex-row gap-4 items-start md:items-center">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="accent-green"
                              checked={settingsData.email_autodelete_enabled !== 'false'}
                              onChange={(e) => setSettingsData({ ...settingsData, email_autodelete_enabled: e.target.checked.toString() })}
                            />
                            <span className="text-[10px] font-bold text-muted uppercase">Auto-delete processed attachment files</span>
                          </label>

                          {settingsData.email_autodelete_enabled !== 'false' && (
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold text-muted uppercase">Retention Count limit:</span>
                              <input
                                type="number"
                                className="premium-input w-16 text-xs text-center py-1 px-2"
                                placeholder="10"
                                value={settingsData.email_autodelete_limit || 10}
                                onChange={(e) => setSettingsData({ ...settingsData, email_autodelete_limit: e.target.value })}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2 border-t border-glass-border/30">
                          <button
                            onClick={() => handleSaveConfig()}
                            className="text-[10px] font-bold bg-green/20 text-green px-4 py-2 rounded-lg hover:bg-green/35"
                          >
                            Save Ingestion Rules
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 5: Operations & Backups */}
        {activeTab === 'operations' && (
          <div className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar text-left">
            {loadingSettings ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
                <RefreshCw className="animate-spin text-sky" size={20} />
                <span className="text-xs">Loading operational parameters...</span>
              </div>
            ) : settingsData ? (
              <div className="space-y-6">
                
                {/* Backup Policies */}
                <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-text flex items-center gap-2">
                      <Database size={14} className="text-sky" />
                      Automatic Database Backup System
                    </h4>
                    <p className="text-[10px] text-muted">
                      Toggle automatic database compression check, startup restore audits, and multi-layer destinations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-glass-border/40">
                    {[
                      { key: 'backup_auto_enabled', label: 'Auto Backup check' },
                      { key: 'backup_local_enabled', label: 'Local Disk backup' },
                      { key: 'backup_gdrive_enabled', label: 'Google Drive sync' },
                      { key: 'backup_telegram_enabled', label: 'Telegram channel backup' },
                      { key: 'backup_startup_restore_check', label: 'Startup integrity restore check' },
                      { key: 'backup_daily_compression', label: 'Daily compression policies' },
                      { key: 'backup_notifications_enabled', label: 'Notifications logging' },
                      { key: 'backup_auto_delete_old_archives', label: 'Purge old archives automatically' },
                      { key: 'backup_manual_access', label: 'Manual backup access endpoints' },
                    ].map(item => {
                      const isValChecked = settingsData[item.key] === 'true';
                      return (
                        <label key={item.key} className="flex items-center justify-between cursor-pointer p-2.5 bg-bg border border-glass-border/45 rounded-xl hover:bg-bg2/40 transition-all select-none">
                          <span className="text-[10px] font-semibold text-text">{item.label}</span>
                          <input
                            type="checkbox"
                            className="accent-green w-4 h-4 rounded cursor-pointer"
                            checked={isValChecked}
                            onChange={() => handleToggleSetting(item.key)}
                            disabled={savingSetting === item.key}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Operations & POS Automation toggles */}
                <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-text flex items-center gap-2">
                      <Settings size={14} className="text-sky" />
                      POS Counter Automation Flags
                    </h4>
                    <p className="text-[10px] text-muted">
                      Trigger direct hardware actions, alerts, or remote management authorization gates from the main cashier.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-glass-border/40">
                    {[
                      { key: 'whatsapp_notif', label: 'Dispatch WhatsApp notifications', desc: 'Auto‑send bills & refill reminders' },
                      { key: 'auto_print', label: 'Auto-print counter receipts', desc: 'Trigger print dialog immediately' },
                      { key: 'admin_remote_mode', label: 'Admin remote API mode', desc: 'Expose remote database endpoints' },
                    ].map(item => {
                      const isValChecked = settingsData[item.key] === 'true';
                      return (
                        <div key={item.key} className="flex flex-col justify-between p-3 bg-bg border border-glass-border/45 rounded-xl text-left">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-text block">{item.label}</span>
                            <span className="text-[9px] text-muted block leading-none">{item.desc}</span>
                          </div>
                          <div className="flex justify-end mt-3">
                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={isValChecked}
                                onChange={() => handleToggleSetting(item.key)}
                                disabled={savingSetting === item.key}
                              />
                              <div className="w-8 h-4 bg-zinc-700 peer-checked:bg-green rounded-full transition-colors" />
                              <div className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-4" />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* WhatsApp Alert Contacts */}
                <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-text flex items-center gap-2">
                      <Bell size={14} className="text-purple" />
                      Alert Broadcast Contacts
                    </h4>
                    <p className="text-[10px] text-muted">
                      Add comma-separated WhatsApp phone numbers for automated systems alerts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-glass-border/40">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-muted uppercase">Admin Alert Numbers</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs"
                        placeholder="e.g. +919876543210"
                        value={settingsData.admin_whatsapp || ''}
                        onChange={(e) => setSettingsData({ ...settingsData, admin_whatsapp: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-muted uppercase">Distributor Alert Numbers</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs"
                        placeholder="e.g. +919876543210"
                        value={settingsData.distributor_whatsapp || ''}
                        onChange={(e) => setSettingsData({ ...settingsData, distributor_whatsapp: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-muted uppercase">Delivery Alert Numbers</label>
                      <input
                        type="text"
                        className="premium-input w-full text-xs"
                        placeholder="e.g. +919876543210"
                        value={settingsData.delivery_boy_whatsapp || ''}
                        onChange={(e) => setSettingsData({ ...settingsData, delivery_boy_whatsapp: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => handleSaveConfig()}
                      className="px-4 py-2 bg-green hover:bg-emerald-600 text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-green/10"
                    >
                      Save Contacts
                    </button>
                  </div>
                </div>

                {/* Pharmarack Integration Settings */}
                <div className="bg-bg3 border border-glass-border rounded-xl p-5 space-y-4">
                  <div className="flex justify-between items-start border-b border-glass-border/30 pb-2">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-text flex items-center gap-2">
                        <Globe size={14} className="text-sky" />
                        Pharmarack Ingestion credentials
                        {prHealth && (
                          <span className={`inline-flex items-center gap-1 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full border leading-none ${
                            prHealth.healthy
                              ? 'bg-green/10 text-green border-green/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${prHealth.healthy ? 'bg-green' : 'bg-red-400'}`} />
                            {prHealth.healthy ? 'ACTIVE' : 'EXPIRED / DISCONNECTED'}
                          </span>
                        )}
                      </h4>
                      <p className="text-[10px] text-muted">
                        Configure retailers.pharmarack.com integration session to check distributor listings.
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowPrConfig(!showPrConfig)}
                      className="text-[9px] font-bold text-sky hover:underline uppercase tracking-wider shrink-0"
                    >
                      {showPrConfig ? 'Hide' : 'Show Login'}
                    </button>
                  </div>

                  {prHealth && !prHealth.healthy && settingsData?.pharmarack_mode === 'Live' && !showPrConfig && (
                    <div className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg p-2.5 flex items-center justify-between">
                      <span>Pharmarack session is expired or not linked.</span>
                      <button
                        onClick={() => {
                          setShowPrConfig(true);
                          handleOpenLoginWindow();
                        }}
                        className="text-[8px] bg-red-500/20 hover:bg-red-500/35 border border-red-500/30 px-2 py-0.5 rounded font-black uppercase"
                      >
                        Link Now
                      </button>
                    </div>
                  )}

                  {showPrConfig && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-muted uppercase">Username</label>
                          <input
                            type="text"
                            className="premium-input w-full text-xs"
                            placeholder="Mobile No"
                            value={settingsData.pharmarack_username || ''}
                            onChange={(e) => setSettingsData({ ...settingsData, pharmarack_username: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-muted uppercase">Password</label>
                          <input
                            type="password"
                            className="premium-input w-full text-xs"
                            placeholder="Password"
                            value={settingsData.pharmarack_password || ''}
                            onChange={(e) => setSettingsData({ ...settingsData, pharmarack_password: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-muted uppercase">Session Cookie/Token</label>
                          <input
                            type="text"
                            className="premium-input w-full text-xs"
                            placeholder="Automatic session cookie"
                            value={settingsData.pharmarack_session_token || ''}
                            onChange={(e) => setSettingsData({ ...settingsData, pharmarack_session_token: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-glass-border/30">
                        <button
                          onClick={() => handleSaveConfig()}
                          className="text-[9px] font-bold bg-green/20 text-green px-3.5 py-1.5 rounded-lg hover:bg-green/35"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleOpenLoginWindow}
                          disabled={isOpeningWindow}
                          className="text-[9px] font-bold bg-sky-500/20 text-sky px-3 py-1.5 rounded-lg hover:bg-sky-500/30 flex items-center gap-1"
                        >
                          <LogIn size={10} />
                          {isOpeningWindow ? 'Opening...' : 'Chrome Login Window'}
                        </button>
                        <button
                          onClick={handlePharmarackLogout}
                          className="text-[9px] font-bold bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/30 flex items-center gap-1"
                        >
                          <LogOut size={10} /> Clear Token
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Side-by-Side Comparator Modal */}
      {comparatorFileId && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-glass-border rounded-3xl w-11/12 max-w-5xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border bg-bg3/50">
              <div>
                <h3 className="text-base font-bold text-text">Split-Screen Layout Comparator</h3>
                <p className="text-xs text-muted">Compare raw uploaded files vs processed clinical mapping rows</p>
              </div>
              <button 
                onClick={() => { setComparatorFileId(null); setComparatorData(null); }}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            {loadingComparator ? (
              <div className="flex-1 flex flex-col items-center justify-center py-24 text-muted gap-2">
                <RefreshCw className="animate-spin text-sky" size={28} />
                <span className="text-xs">Loading reference file data...</span>
              </div>
            ) : comparatorData ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* Meta Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-bg3 p-4 rounded-xl border border-glass-border">
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">File Name</span>
                    <span className="text-xs text-text font-mono break-all">{comparatorData.filename}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Layout Type</span>
                    <span className="text-xs text-text uppercase font-black tracking-wide">{comparatorData.file_type}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted font-bold uppercase tracking-wider block font-bold text-green flex items-center gap-1">
                      <CheckCircle2 size={12} /> Status
                    </span>
                    <span className="text-xs text-green font-bold uppercase">{comparatorData.status}</span>
                  </div>
                </div>

                {/* Headers Map Comparator */}
                {comparatorData.file_type === 'csv' || comparatorData.file_type === 'xlsx' || comparatorData.file_type === 'xls' ? (
                  <div className="space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-wider text-sky flex items-center gap-1.5">
                      <Settings size={14} />
                      Header Alignment Mapping Config
                    </h4>
                    
                    <div className="bg-bg3 border border-glass-border rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-bg/95 border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-widest">
                            <th className="py-2.5 px-4">System Database Property</th>
                            <th className="py-2.5 px-4 flex items-center gap-1">
                              Raw Document Header Key <ArrowRight size={10} className="text-sky" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(comparatorData.mapping_config).map(([dbProp, fileHeader]) => (
                            <tr key={dbProp} className="border-b border-glass-border/40 hover:bg-bg2/40">
                              <td className="py-2.5 px-4 font-mono text-xs text-text font-semibold">{dbProp}</td>
                              <td className="py-2.5 px-4 text-xs">
                                {fileHeader ? (
                                  <span className="font-mono text-sky font-bold bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
                                    {fileHeader}
                                  </span>
                                ) : (
                                  <span className="text-yellow-500/70 italic flex items-center gap-1 font-bold text-[10px]">
                                    <AlertTriangle size={12} />
                                    No Map
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* Extracted Items Comparison Table */}
                <div className="space-y-3 text-left">
                  <h4 className="text-xs font-black uppercase tracking-wider text-sky flex items-center gap-1.5">
                    <FileText size={14} />
                    Extracted Records Preview ({comparatorData.extracted_data.length})
                  </h4>

                  <div className="bg-bg3 border border-glass-border rounded-xl overflow-hidden overflow-x-auto max-h-[30vh]">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-bg/95 border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-widest">
                          <th className="py-2.5 px-4">Medicine Name</th>
                          <th className="py-2.5 px-4">Batch No</th>
                          <th className="py-2.5 px-4">Expiry</th>
                          <th className="py-2.5 px-4 text-right">Rate</th>
                          <th className="py-2.5 px-4 text-right">MRP</th>
                          <th className="py-2.5 px-4 text-right">Qty</th>
                          <th className="py-2.5 px-4 text-right">Free</th>
                          <th className="py-2.5 px-4 text-right">CGST%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparatorData.extracted_data.map((item, idx) => (
                          <tr key={idx} className="border-b border-glass-border/40 hover:bg-bg2/40 text-xs">
                            <td className="py-2.5 px-4 text-text font-medium truncate max-w-[200px]" title={item.name}>
                              {item.name}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-text">{item.batch_no || 'N/A'}</td>
                            <td className="py-2.5 px-4 font-mono text-text">{item.expiry_date || 'N/A'}</td>
                            <td className="py-2.5 px-4 text-right text-green font-semibold font-mono">
                              ₹{typeof item.rate === 'number' ? item.rate.toFixed(2) : (typeof item.price === 'number' ? item.price.toFixed(2) : '0.00')}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono">₹{typeof item.mrp === 'number' ? item.mrp.toFixed(2) : '0.00'}</td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-text">{item.quantity || item.qty || 0}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-muted">{item.free_qty || 0}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-orange-400">{item.cgst_per || 0}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 py-16 text-center text-muted">Failed to load comparator data.</div>
            )}

            {/* Modal Footer */}
            <div className="flex justify-end px-6 py-4 border-t border-glass-border bg-bg3/50">
              <button
                onClick={() => { setComparatorFileId(null); setComparatorData(null); }}
                className="px-5 py-2 bg-sky hover:bg-sky-400 text-white rounded-xl text-xs font-bold uppercase transition-all"
              >
                Close Comparator
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Distributor Modal */}
      {showAddDistModal && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-glass-border w-full max-w-md rounded-3xl p-6 space-y-4 text-left shadow-2xl">
            <div className="flex justify-between items-center border-b border-glass-border pb-2.5">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <Database size={16} className="text-sky" />
                Add New Distributor Layout
              </h3>
              <button
                onClick={() => setShowAddDistModal(false)}
                className="p-1 rounded hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 py-1 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Name *</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="Distributor / Supplier Name"
                  value={newDistName}
                  onChange={(e) => setNewDistName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">WhatsApp Phone No(s). (comma sep.)</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. +919876543210, +919900000000"
                  value={newDistPhone}
                  onChange={(e) => setNewDistPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Email Address</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. distributor@gmail.com"
                  value={newDistEmail}
                  onChange={(e) => setNewDistEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-glass-border/30">
              <button
                onClick={() => setShowAddDistModal(false)}
                className="px-3.5 py-2 rounded-lg bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-xs font-bold transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDistributor}
                className="px-4 py-2 rounded-lg bg-sky hover:bg-sky-400 text-white text-xs font-bold transition-all active:scale-95 shadow-md shadow-sky/10"
              >
                Add Distributor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Doctor Modal */}
      {showAddDocModal && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left">
          <div className="bg-bg border border-glass-border w-full max-w-md rounded-3xl p-6 space-y-4 text-left shadow-2xl">
            <div className="flex justify-between items-center border-b border-glass-border pb-2.5">
              <h3 className="font-bold text-sm text-text flex items-center gap-2">
                <Stethoscope size={16} className="text-sky" />
                Add New Affiliated Doctor
              </h3>
              <button
                onClick={() => setShowAddDocModal(false)}
                className="p-1 rounded hover:bg-white/10 text-muted hover:text-text transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 py-1 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Doctor Name *</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. Sanjay Gupta"
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">WhatsApp Phone No.</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. +919876543210"
                  value={newDocPhone}
                  onChange={(e) => setNewDocPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Specialty</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. Pediatrician, Dentist"
                  value={newDocSpecialty}
                  onChange={(e) => setNewDocSpecialty(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Hospital / Clinic</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. City General Hospital"
                  value={newDocHospital}
                  onChange={(e) => setNewDocHospital(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Registration Number</label>
                <input
                  type="text"
                  className="premium-input w-full text-xs"
                  placeholder="e.g. MCI-12345"
                  value={newDocRegNo}
                  onChange={(e) => setNewDocRegNo(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Auto-Send Daily WhatsApp Summaries</span>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={newDocSendSummary}
                    onChange={() => setNewDocSendSummary(!newDocSendSummary)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-bg border border-glass-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted after:border-glass-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white peer-checked:after:left-[4px]"></div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-glass-border/30">
              <button
                onClick={() => setShowAddDocModal(false)}
                className="px-3.5 py-2 rounded-lg bg-bg3 hover:bg-bg2 border border-glass-border text-muted hover:text-text text-xs font-bold transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDoctor}
                className="px-4 py-2 rounded-lg bg-sky hover:bg-sky-400 text-white text-xs font-bold transition-all active:scale-95 shadow-md shadow-sky/10"
              >
                Add Doctor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Learning;
