import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sanitizePhoneInput, isValid10DigitPhone } from '../../utils/phone';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { apiClient, api } from '../../services/api';
import { useSettingsQuery } from '../../hooks/useSettingsQuery';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import {
  Settings as SettingsIcon,
  Building2,
  Bell,
  Database,
  Trash2,
  HardDrive,
  Save,
  RefreshCw,
  Zap,
  Clock,
  Download,
  RotateCcw,
  Shield,
  AlertTriangle,
  X,
  QrCode,
  History,
  BarChart3,
  FileText,
  Send,
  Eye,
  MapPin,
  Plus,
  Pencil,
  CheckCircle2,
  ArrowRight,
  Brain,
  MessageCircle,
  Mail,
  Stethoscope,
  Search,
  Truck,
  Check,
  Edit,
  Building,
  Key,
  Users,
  Smartphone,
  ExternalLink,
  Copy
} from 'lucide-react';
import { toastEvent } from '../../services/events';
import { BackupCenterContent } from '../../components/BackupCenterModal';

// ==========================================
// TYPES & INTERFACES
// ==========================================

interface StorageLocation {
  id: number;
  name: string;
  code: string;
  type: string;
  description: string;
  is_default: number;
  is_active: number;
}

interface RegisteredDevice {
  token: string;
  device_name: string;
  os: string;
  last_seen: string;
  is_online: number;
}

interface Doctor {
  id: number;
  name: string;
  reg_number: string;
  phone: string;
  address: string;
}

interface OcrCorrection {
  id: number;
  raw_text: string;
  corrected_name: string;
  confidence: number;
  created_at: string;
}

interface MedicineAlias {
  id: number;
  alias_name: string;
  medicine_id: number;
  medicine_name: string;
}

// Map legacy tab search params to the 4 store infrastructure tabs
function normalizeSettingsTab(tabParam: string | null): string {
  if (!tabParam) return 'profile';
  const lower = tabParam.toLowerCase();
  if (lower === 'profile' || lower === 'store') return 'profile';
  if (lower === 'staff' || lower === 'security') return 'staff';
  if (lower === 'integrations' || lower === 'credentials') return 'integrations';
  if (lower === 'backups' || lower === 'data' || lower === 'maintenance') return 'backups';
  return 'profile';
}

// ==========================================
// MAIN SETTINGS COMPONENT
// ==========================================

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeSettingsTab(searchParams.get('tab'));
  const isPageVisible = usePageActive();

  const { data: rawSettings = {}, isLoading: loadingSettings, refetch: refetchSettings } = useSettingsQuery();

  const tabs = [
    { id: 'profile', label: 'Store Profile', icon: Building2, desc: 'Pharmacy details, license & store layout' },
    { id: 'staff', label: 'Staff & Security', icon: Shield, desc: 'Cashier accounts, admin access & devices' },
    { id: 'integrations', label: 'Integrations & Credentials', icon: Zap, desc: 'WhatsApp, Telegram, Gmail & Pharmarack' },
    { id: 'backups', label: 'Data & Backups', icon: Database, desc: 'Database backups, fetch control & reset' }
  ];

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  return (
    <div className="flex flex-col h-full bg-bg text-text p-4 space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-bg2 border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <SettingsIcon size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text">Pharmacy Configuration & Control Hub</h1>
            <p className="text-xs text-muted">Unified control center for store parameters, security, API credentials, and AI self-learning.</p>
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-border gap-2 overflow-x-auto scrollbar-none pb-0.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2.5 py-3 px-4 font-semibold text-xs rounded-t-xl transition-all whitespace-nowrap border-t border-x cursor-pointer ${
                isActive
                  ? 'bg-bg2 border-border border-b-bg2 text-primary font-bold shadow-sm'
                  : 'bg-bg3/40 border-transparent text-muted hover:text-text hover:bg-bg3/80'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Tab Workspace Panel */}
      <div className="flex-1 bg-bg2 border border-border rounded-2xl p-5 shadow-sm">
        {loadingSettings ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={24} className="animate-spin text-primary mr-2" />
            <span className="text-xs font-semibold text-muted">Hydrating pharmacy configuration settings...</span>
          </div>
        ) : (
          <>
            {activeTab === 'profile' && <StoreProfileTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'staff' && <StaffSecurityTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'integrations' && <IntegrationsCredentialsTab rawSettings={rawSettings} refetchSettings={refetchSettings} isVisible={isPageVisible} />}
            {activeTab === 'backups' && <DataBackupsTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 1: STORE PROFILE
// ==========================================

function StoreProfileTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [formData, setFormData] = useState({
    pharmacyName: rawSettings.pharmacy_name || rawSettings.shop_name || rawSettings.store_name || '',
    address: rawSettings.address || '',
    phone: rawSettings.phone || rawSettings.shop_phone || '',
    gstin: rawSettings.gstin || '',
    drugLicense: rawSettings.drug_license || rawSettings.license_number || '',
    email: rawSettings.email || '',
    dineshWhatsappNumber: rawSettings.dinesh_whatsapp_number || '',
    ownerWhatsappNumber: rawSettings.owner_whatsapp_number || '',
    defaultTaxRate: rawSettings.default_tax_rate || '18',
    invoicePrefix: rawSettings.invoice_prefix || 'INV-',
    autoPrint: rawSettings.auto_print === 'true',
    defaultPaymentMode: rawSettings.default_payment_mode || 'Cash',
    lowStockThreshold: rawSettings.low_stock_threshold || '10',
    expiryAlertDays: rawSettings.expiry_alert_days || '90',
  });

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // Storage Locations state
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [storageLocForm, setStorageLocForm] = useState({ name: '', code: '', type: 'rack', description: '', is_default: false, is_active: true });
  const [editingLocId, setEditingLocId] = useState<number | null>(null);

  const fetchStorageLocations = useCallback(async () => {
    try {
      const res = await apiClient.get('/settings/storage-locations');
      setStorageLocations(res.data || []);
    } catch (err) {
      console.warn('Failed to fetch storage locations:', err);
    }
  }, []);

  useEffect(() => {
    fetchStorageLocations();
  }, [fetchStorageLocations]);

  const handleSaveStoreProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        pharmacy_name: formData.pharmacyName,
        shop_name: formData.pharmacyName,
        store_name: formData.pharmacyName,
        address: formData.address,
        phone: formData.phone,
        shop_phone: formData.phone,
        gstin: formData.gstin,
        drug_license: formData.drugLicense,
        email: formData.email,
        dinesh_whatsapp_number: formData.dineshWhatsappNumber,
        owner_whatsapp_number: formData.ownerWhatsappNumber,
        default_tax_rate: formData.defaultTaxRate,
        invoice_prefix: formData.invoicePrefix,
        auto_print: formData.autoPrint ? 'true' : 'false',
        default_payment_mode: formData.defaultPaymentMode,
        low_stock_threshold: formData.lowStockThreshold,
        expiry_alert_days: formData.expiryAlertDays,
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Store profile updated successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save store profile: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStorageLoc = async () => {
    if (!storageLocForm.name.trim()) {
      toastEvent.trigger('Location name is required', 'error');
      return;
    }
    try {
      if (editingLocId) {
        await apiClient.put(`/settings/storage-locations/${editingLocId}`, storageLocForm);
        toastEvent.trigger('Storage location updated', 'success');
      } else {
        await apiClient.post('/settings/storage-locations', storageLocForm);
        toastEvent.trigger('Storage location created', 'success');
      }
      setStorageLocForm({ name: '', code: '', type: 'rack', description: '', is_default: false, is_active: true });
      setEditingLocId(null);
      fetchStorageLocations();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to save storage location', 'error');
    }
  };

  const handleDeleteStorageLoc = async (id: number) => {
    try {
      await apiClient.delete(`/settings/storage-locations/${id}`);
      toastEvent.trigger('Storage location deleted', 'success');
      fetchStorageLocations();
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to delete storage location', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveStoreProfile} className="space-y-6">
        {/* Core Pharmacy Details */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <Building2 size={16} /> Core Store Identity & Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Pharmacy / Shop Name *</label>
              <input
                type="text"
                required
                value={formData.pharmacyName}
                onChange={(e) => setFormData({ ...formData, pharmacyName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="e.g. LifeCare Pharmacy"
              />
            </div>

            <div>
              <PhoneInputWithBadge
                label="Primary Store Phone / Mobile"
                value={formData.phone}
                onChange={val => setFormData({ ...formData, phone: val })}
                allowEmpty={true}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Store GSTIN Number</label>
              <input
                type="text"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="27AAAAA0000A1Z5"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Drug License Number(s)</label>
              <input
                type="text"
                value={formData.drugLicense}
                onChange={(e) => setFormData({ ...formData, drugLicense: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Form 20/21 License No."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Store Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="pharmacy@example.com"
              />
            </div>

            <div>
              <PhoneInputWithBadge
                label="Owner WhatsApp Contact"
                value={formData.ownerWhatsappNumber}
                onChange={val => setFormData({ ...formData, ownerWhatsappNumber: val })}
                allowEmpty={true}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-text mb-1">Complete Store Address</label>
              <textarea
                rows={2}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Street address, City, Pin code"
              />
            </div>
          </div>
        </div>

        {/* Operating Defaults */}
        <div className="space-y-4 pt-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <FileText size={16} /> POS & Invoice Operating Defaults
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Invoice Number Prefix</label>
              <input
                type="text"
                value={formData.invoicePrefix}
                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Default GST Tax Rate (%)</label>
              <input
                type="number"
                value={formData.defaultTaxRate}
                onChange={(e) => setFormData({ ...formData, defaultTaxRate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Default Payment Method</label>
              <select
                value={formData.defaultPaymentMode}
                onChange={(e) => setFormData({ ...formData, defaultPaymentMode: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI / QR Code</option>
                <option value="Card">Credit / Debit Card</option>
                <option value="Credit">Credit Bill (Khata)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Low Stock Warning Threshold (Qty)</label>
              <input
                type="number"
                value={formData.lowStockThreshold}
                onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Expiry Alert Period (Days)</label>
              <input
                type="number"
                value={formData.expiryAlertDays}
                onChange={(e) => setFormData({ ...formData, expiryAlertDays: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <input
                type="checkbox"
                id="autoPrint"
                checked={formData.autoPrint}
                onChange={(e) => setFormData({ ...formData, autoPrint: e.target.checked })}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="autoPrint" className="text-xs font-semibold text-text cursor-pointer">
                Auto-print receipt immediately on sale completion
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Save Store Profile</span>
          </button>
        </div>
      </form>

      {/* Storage Racks & Locations */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <MapPin size={16} /> Physical Storage Racks & Shelves Directory
        </h2>

        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Rack Name (e.g. Rack A-1)"
              value={storageLocForm.name}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, name: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
            <input
              type="text"
              placeholder="Short Code (e.g. R-A1)"
              value={storageLocForm.code}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, code: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
            <select
              value={storageLocForm.type}
              onChange={(e) => setStorageLocForm({ ...storageLocForm, type: e.target.value })}
              className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            >
              <option value="rack">Main Rack</option>
              <option value="fridge">Cold Storage / Fridge</option>
              <option value="drawer">Narcotics Drawer</option>
              <option value="counter">Front Counter Display</option>
            </select>
            <button
              onClick={handleSaveStorageLoc}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
            >
              <Plus size={14} /> {editingLocId ? 'Update Location' : 'Add Storage Location'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 px-3">Location Name</th>
                  <th className="py-2 px-3">Code</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {storageLocations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted italic">No custom storage locations registered yet.</td>
                  </tr>
                ) : (
                  storageLocations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-bg3/50">
                      <td className="py-2 px-3 font-semibold text-text">{loc.name}</td>
                      <td className="py-2 px-3 text-muted font-mono">{loc.code}</td>
                      <td className="py-2 px-3 uppercase text-[10px] font-bold text-primary">{loc.type}</td>
                      <td className="py-2 px-3 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingLocId(loc.id);
                            setStorageLocForm({ name: loc.name, code: loc.code, type: loc.type, description: loc.description || '', is_default: !!loc.is_default, is_active: !!loc.is_active });
                          }}
                          className="text-primary hover:underline font-semibold cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteStorageLoc(loc.id)}
                          className="text-red-500 hover:underline font-semibold cursor-pointer"
                        >
                          Delete
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
  );
}

// ==========================================
// SUB-TAB 2: STAFF & SECURITY
// ==========================================

function StaffSecurityTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [adminUsername, setAdminUsername] = useState(rawSettings.admin_username || 'admin');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminRemoteMode, setAdminRemoteMode] = useState(rawSettings.admin_remote_mode !== 'false');
  const [saving, setSaving] = useState(false);

  const { data: devicesList = [] } = useApiQuery<RegisteredDevice[]>(
    'registered-devices',
    () => apiClient.get('/settings/registered-devices').then((res) => res.data.devices || []),
    { staleTime: 15000 }
  );

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        admin_username: adminUsername,
        admin_remote_mode: adminRemoteMode ? 'true' : 'false',
      };
      if (newAdminPassword.trim()) {
        payload.admin_password = newAdminPassword.trim();
      }

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Security parameters updated successfully', 'success');
      setNewAdminPassword('');
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save security settings: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSaveSecurity} className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
            <Shield size={16} /> Store Administration & Credentials
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Admin Account Username</label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text mb-1">Change Admin Password (leave blank to keep existing)</label>
              <input
                type="password"
                placeholder="Enter new strong password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="adminRemote"
              checked={adminRemoteMode}
              onChange={(e) => setAdminRemoteMode(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="adminRemote" className="text-xs font-semibold text-text cursor-pointer">
              Enable Remote Administrative Master Control Access
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Update Security Credentials</span>
          </button>
        </div>
      </form>

      {/* Registered Mobile & Desktop Devices */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Smartphone size={16} /> Authorized Registered Mobile & Desktop Terminals
        </h2>

        <div className="overflow-x-auto bg-bg3/20 border border-border rounded-xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2.5 px-3">Device Name</th>
                <th className="py-2.5 px-3">OS Platform</th>
                <th className="py-2.5 px-3">Push Token</th>
                <th className="py-2.5 px-3">Last Active</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {devicesList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted italic">No registered mobile device terminals found.</td>
                </tr>
              ) : (
                devicesList.map((dev) => (
                  <tr key={dev.token} className="hover:bg-bg3/50">
                    <td className="py-2.5 px-3 font-semibold text-text">{dev.device_name || 'Unnamed Terminal'}</td>
                    <td className="py-2.5 px-3 text-muted">{dev.os}</td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-muted truncate max-w-[150px]">{dev.token}</td>
                    <td className="py-2.5 px-3 text-muted">{new Date(dev.last_seen).toLocaleTimeString()}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        dev.is_online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-muted/20 text-muted'
                      }`}>
                        {dev.is_online ? 'CONNECTED' : 'OFFLINE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 3: INTEGRATIONS & CREDENTIALS
// ==========================================

function IntegrationsCredentialsTab({ rawSettings, refetchSettings, isVisible }: { rawSettings: Record<string, string>; refetchSettings: () => void; isVisible: boolean }) {
  const [waPreferredSystem, setWaPreferredSystem] = useState(rawSettings.whatsapp_preferred_system || 'web');
  const [waBusinessToken, setWaBusinessToken] = useState(rawSettings.wa_business_access_token || '');
  const [waBusinessPhoneId, setWaBusinessPhoneId] = useState(rawSettings.wa_business_phone_number_id || '');
  
  const [telegramEnabled, setTelegramEnabled] = useState(rawSettings.telegram_enabled === 'true');
  const [telegramToken, setTelegramToken] = useState(rawSettings.telegram_token || '');
  const [telegramChatId, setTelegramChatId] = useState(rawSettings.telegram_chat_id || '');

  const [gmailUser, setGmailUser] = useState(rawSettings.gmail_user || '');
  const [gmailPass, setGmailPass] = useState(rawSettings.gmail_pass || '');

  const [pharmarackUser, setPharmarackUser] = useState(rawSettings.pharmarack_username || '');
  const [pharmarackPass, setPharmarackPass] = useState(rawSettings.pharmarack_password || '');
  const [pharmarackRefreshing, setPharmarackRefreshing] = useState(false);

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // WhatsApp Web QR & Status polling
  const [waStatus, setWaStatus] = useState<{ status: string; qr?: string }>({ status: 'UNKNOWN' });
  const fetchWaStatus = useCallback(async () => {
    if (!isVisible) return;
    try {
      const res = await apiClient.get('/whatsapp/status');
      setWaStatus(res.data || { status: 'UNKNOWN' });
    } catch (_) {}
  }, [isVisible]);

  useEffect(() => {
    fetchWaStatus();
    const interval = setInterval(fetchWaStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchWaStatus]);

  // Telegram status poll
  const { data: telegramStatus } = useApiQuery<{ isReady: boolean }>(
    'telegram-status',
    () => apiClient.get('/settings/telegram-status').then(res => res.data),
    { enabled: isVisible && telegramEnabled, refetchInterval: 10000 }
  );

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId,
        gmail_user: gmailUser,
        gmail_pass: gmailPass,
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live'
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Integrations & API credentials saved successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save integration settings: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerPharmarackRefresh = async () => {
    setPharmarackRefreshing(true);
    try {
      const res = await apiClient.post('/pharmarack/login');
      if (res.data?.success) {
        toastEvent.trigger('Pharmarack live B2B session refreshed successfully', 'success');
      } else {
        toastEvent.trigger('Pharmarack refresh completed: ' + (res.data?.message || 'Check logs'), 'info');
      }
    } catch (err: any) {
      toastEvent.trigger('Pharmarack session refresh error: ' + err.message, 'error');
    } finally {
      setPharmarackRefreshing(false);
    }
  };

  return (
    <form onSubmit={handleSaveIntegrations} className="space-y-6">
      {/* WhatsApp Section */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <MessageCircle size={16} /> WhatsApp Messaging Infrastructure
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-text uppercase">WhatsApp Automated System</h3>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Preferred Integration System</label>
              <select
                value={waPreferredSystem}
                onChange={(e) => setWaPreferredSystem(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="web">Automated WhatsApp Web (Headless Chrome QR)</option>
                <option value="business">Official WhatsApp Business Cloud API</option>
              </select>
            </div>

            {waPreferredSystem === 'web' && (
              <div className="p-3 bg-bg rounded-xl border border-border space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text">Web Status:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    waStatus.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {waStatus.status}
                  </span>
                </div>
                {waStatus.qr && (
                  <div className="flex flex-col items-center py-2 bg-white rounded-lg">
                    <img src={waStatus.qr} alt="WhatsApp Web QR Code" className="w-32 h-32" />
                    <span className="text-[10px] text-gray-700 font-semibold mt-1">Scan with WhatsApp on phone</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-text uppercase">Meta WhatsApp Business API Keys</h3>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Phone Number ID</label>
              <input
                type="text"
                value={waBusinessPhoneId}
                onChange={(e) => setWaBusinessPhoneId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Meta Phone Number ID"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">System User Access Token</label>
              <input
                type="password"
                value={waBusinessToken}
                onChange={(e) => setWaBusinessToken(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                placeholder="Permanent Bearer Token"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Telegram Bot */}
      <div className="space-y-4 pt-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Send size={16} /> Telegram Alert Bot & Prescription Receiver
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 md:col-span-3">
            <input
              type="checkbox"
              id="tgEnabled"
              checked={telegramEnabled}
              onChange={(e) => setTelegramEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="tgEnabled" className="text-xs font-bold text-text cursor-pointer">
              Enable Automated Telegram Bot Notifications & Photo Ingestion
            </label>
            {telegramEnabled && (
              <span className={`ml-auto px-2.5 py-1 rounded text-[10px] font-bold ${
                telegramStatus?.isReady ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400'
              }`}>
                {telegramStatus?.isReady ? 'BOT ONLINE & LISTENING' : 'BOT DISCONNECTED'}
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1">Telegram Bot Token</label>
            <input
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1">Target Chat / Channel ID</label>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="-100123456789"
            />
          </div>
        </div>
      </div>

      {/* Gmail / Email */}
      <div className="space-y-4 pt-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Mail size={16} /> Gmail / IMAP Mail Order Scanner Credentials
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">IMAP Gmail Account Address</label>
            <input
              type="email"
              value={gmailUser}
              onChange={(e) => setGmailUser(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="store.distributor.invoices@gmail.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">Google App Password (16-character secret)</label>
            <input
              type="password"
              value={gmailPass}
              onChange={(e) => setGmailPass(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="abcd efgh ijkl mnop"
            />
          </div>
        </div>
      </div>

      {/* Pharmarack B2B */}
      <div className="space-y-4 pt-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Zap size={16} /> Pharmarack B2B Live Ordering Credentials
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Username / Phone</label>
            <input
              type="text"
              value={pharmarackUser}
              onChange={(e) => setPharmarackUser(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Password</label>
            <input
              type="password"
              value={pharmarackPass}
              onChange={(e) => setPharmarackPass(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={handleTriggerPharmarackRefresh}
              disabled={pharmarackRefreshing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
            >
              <RefreshCw size={14} className={pharmarackRefreshing ? 'animate-spin' : ''} />
              <span>Refresh B2B Session</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>Save Integrations & Credentials</span>
        </button>
      </div>
    </form>
  );
}



// ==========================================
// SUB-TAB 5: DATA & BACKUPS
// ==========================================

function DataBackupsTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [backupFrequency, setBackupFrequency] = useState(rawSettings.backup_frequency || 'off');
  const [savingFreq, setSavingFreq] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const queryClient = useQueryClient();

  const handleSaveBackupSchedule = async () => {
    setSavingFreq(true);
    try {
      await apiClient.post('/settings/save', { backup_frequency: backupFrequency });
      toastEvent.trigger('Backup schedule updated', 'success');
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to update backup schedule: ' + err.message, 'error');
    } finally {
      setSavingFreq(false);
    }
  };

  const handleClearCache = async () => {
    try {
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      toastEvent.trigger('Local inventory & search cache cleared successfully', 'success');
    } catch (err: any) {
      toastEvent.trigger('Failed to clear cache: ' + err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Database Backup Center */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Database size={16} /> Automated Database Backup & Snapshot Center
        </h2>

        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Automated Schedule Frequency</label>
              <select
                value={backupFrequency}
                onChange={(e) => setBackupFrequency(e.target.value)}
                className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="off">Off (Manual Backups Only)</option>
                <option value="daily">Daily Automatic Backup</option>
                <option value="weekly">Weekly Automatic Backup</option>
                <option value="monthly">Monthly Automatic Backup</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveBackupSchedule}
                disabled={savingFreq}
                className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
              >
                Save Schedule
              </button>
              <button
                onClick={() => setShowBackupModal(true)}
                className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
              >
                Open Full Backup & Restore Vault
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance & Cache */}
      <div className="space-y-4 pt-2 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Trash2 size={16} /> System Maintenance & Diagnostics
        </h2>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
          <div>
            <h3 className="text-xs font-bold text-text">Clear Local Inventory & Search Cache</h3>
            <p className="text-[11px] text-muted">Forces instant re-hydration of SQLite compact indexes without touching underlying sales history.</p>
          </div>
          <button
            onClick={handleClearCache}
            className="px-4 py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer shrink-0"
          >
            Clear Search Cache
          </button>
        </div>
      </div>

      {/* Full Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-border rounded-2xl p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto relative shadow-2xl">
            <button
              onClick={() => setShowBackupModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
            <BackupCenterContent onClose={() => setShowBackupModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
