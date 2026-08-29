import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {} from '../../utils/phone';
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
  Database,
  Trash2,
  Save,
  RefreshCw,
  Zap,
  Clock,
  RotateCcw,
  Shield,
  AlertTriangle,
  X,
  FileText,
  Send,
  MapPin,
  Plus,
  CheckCircle2,
  MessageCircle,
  Mail,
  Stethoscope,
  Truck,
  Smartphone
} from 'lucide-react';
import { toastEvent } from '../../services/events';
import { BackupCenterContent } from '../../components/BackupCenterModal';

// ==========================================
// TYPES & INTERFACES
// ==========================================

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

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

// Map legacy tab search params to the 4 store infrastructure tabs
function normalizeSettingsTab(tabParam: string | null): string {
  if (!tabParam) return 'profile';
  const lower = tabParam.toLowerCase();
  if (lower === 'profile' || lower === 'store') return 'profile';
  if (lower === 'staff' || lower === 'security') return 'staff';
  if (lower === 'integrations' || lower === 'credentials') return 'integrations';
  if (lower === 'triggers' || lower === 'schedules' || lower === 'cron' || lower === 'automation') return 'triggers';
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
    { id: 'triggers', label: 'Trigger Schedules', icon: Clock, desc: 'Manage automated trigger times, intervals & cron frequencies' },
    { id: 'backups', label: 'Data & Backups', icon: Database, desc: 'Database backups, fetch control & reset' }
  ];

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  return (
    <div className="flex flex-col h-full text-text p-4 space-y-4 overflow-y-auto">
      {/* Compact Unified Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-bg border border-border rounded-2xl p-3 px-4 shadow-sm">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <SettingsIcon size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text leading-none">Settings & Configuration</h1>
            <p className="text-xs text-muted mt-0.5">Control center for store rules, security & integrations</p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-bg3/40 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-sm rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Workspace Panel — paints cached settings instantly; the
          spinner shows only when NO cached snapshot exists (true cold load). */}
      <div className="flex-1 bg-bg border border-border rounded-2xl p-5 shadow-sm">
        {loadingSettings && (!rawSettings || Object.keys(rawSettings).length === 0) ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw size={24} className="animate-spin text-primary mr-2" />
            <span className="text-sm font-semibold text-muted">Hydrating pharmacy configuration settings...</span>
          </div>
        ) : (
          <>
            {activeTab === 'profile' && <StoreProfileTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'staff' && <StaffSecurityTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
            {activeTab === 'integrations' && <IntegrationsCredentialsTab rawSettings={rawSettings} refetchSettings={refetchSettings} isVisible={isPageVisible} />}
            {activeTab === 'triggers' && <TriggerSchedulesTab rawSettings={rawSettings} refetchSettings={refetchSettings} />}
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
  const storageLocQuery = useApiQuery<StorageLocation[]>(
    ['storage-locations'],
    () => apiClient.get('/settings/storage-locations').then(res => res.data || []),
  );
  const storageLocations = storageLocQuery.data || [];
  const fetchStorageLocations = () => storageLocQuery.refetch();
  const [storageLocForm, setStorageLocForm] = useState({ name: '', code: '', type: 'rack', description: '', is_default: false, is_active: true });
  const [editingLocId, setEditingLocId] = useState<number | null>(null);

  const handleResetStoreProfile = () => {
    setFormData({
      pharmacyName: rawSettings.pharmacy_name || rawSettings.shop_name || rawSettings.store_name || '',
      address: rawSettings.address || '',
      phone: rawSettings.phone || rawSettings.shop_phone || '',
      gstin: rawSettings.gstin || '',
      drugLicense: rawSettings.drug_license || rawSettings.license_number || '',
      email: rawSettings.email || '',
      ownerWhatsappNumber: rawSettings.owner_whatsapp_number || '',
      defaultTaxRate: rawSettings.default_tax_rate || '18',
      invoicePrefix: rawSettings.invoice_prefix || 'INV-',
      autoPrint: rawSettings.auto_print === 'true',
      defaultPaymentMode: rawSettings.default_payment_mode || 'Cash',
      lowStockThreshold: rawSettings.low_stock_threshold || '10',
      expiryAlertDays: rawSettings.expiry_alert_days || '90',
    });
    toastEvent.trigger('Store profile form reset to saved parameters', 'info');
  };

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
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save store profile: ' + (e.message || 'Unknown error'), 'error');
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
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e.response?.data?.error || 'Failed to save storage location', 'error');
    }
  };

  const handleDeleteStorageLoc = async (id: number) => {
    try {
      await apiClient.delete(`/settings/storage-locations/${id}`);
      toastEvent.trigger('Storage location deleted', 'success');
      fetchStorageLocations();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e.response?.data?.error || 'Failed to delete storage location', 'error');
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

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleResetStoreProfile}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Reset Form</span>
          </button>
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

  const handleResetSecurity = () => {
    setAdminUsername(rawSettings.admin_username || 'admin');
    setNewAdminPassword('');
    setAdminRemoteMode(rawSettings.admin_remote_mode !== 'false');
    toastEvent.trigger('Security form reset to saved parameters', 'info');
  };

  const handleResetDeviceAuthorization = async () => {
    if (!window.confirm('Are you sure you want to reset remote admin device authorization? This will require re-authorization for remote admin sessions.')) return;
    try {
      await apiClient.post('/security/admin/reset-device');
      toastEvent.trigger('Admin device authorization reset successfully', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to reset device authorization: ' + (e.message || 'Unknown error'), 'error');
    }
  };

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
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save security settings: ' + e.message, 'error');
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

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleResetSecurity}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Reset Form</span>
          </button>
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Smartphone size={16} /> Authorized Registered Mobile & Desktop Terminals
          </h2>
          <button
            type="button"
            onClick={handleResetDeviceAuthorization}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-500 border border-red-500/30 font-bold text-xs rounded-xl hover:bg-red-500/20 transition-all cursor-pointer shrink-0"
          >
            <RotateCcw size={13} />
            <span>Reset Device Authorization</span>
          </button>
        </div>

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
  const [emailInvoiceRecipient, setEmailInvoiceRecipient] = useState<string>(() => {
    if (rawSettings.notify_owner_on_email_whatsapp === '0') return 'none';
    return rawSettings.email_invoice_whatsapp_recipient || 'both';
  });
  
  const [telegramEnabled, setTelegramEnabled] = useState(rawSettings.telegram_enabled === 'true');
  const [telegramToken, setTelegramToken] = useState(rawSettings.telegram_token || '');
  const [telegramChatId, setTelegramChatId] = useState(rawSettings.telegram_chat_id || '');

  const [gmailUser, setGmailUser] = useState(rawSettings.gmail_user || '');
  const [gmailPass, setGmailPass] = useState(rawSettings.gmail_pass || '');

  const [pharmarackUser, setPharmarackUser] = useState(rawSettings.pharmarack_username || '');
  const [pharmarackPass, setPharmarackPass] = useState(rawSettings.pharmarack_password || '');
  const [pharmarackRefreshing, setPharmarackRefreshing] = useState(false);
  const [reorderWindowMonths, setReorderWindowMonths] = useState(rawSettings.pharmarack_reorder_window_months || '2');
  const [waIdleSleepMin, setWaIdleSleepMin] = useState(rawSettings.whatsapp_idle_sleep_min || '15');

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // WhatsApp Web QR & Status — P1 "events, not timers": poll rapidly ONLY while
  // connecting (QR scan in progress). Once ready, refresh via SSE push / focus.
  const [waStatus, setWaStatus] = useState<{ status: string; qr?: string; message?: string }>({ status: 'UNKNOWN' });
  const fetchWaStatus = useCallback(async () => {
    if (!isVisible) return;
    try {
      const res = await apiClient.get('/whatsapp/status');
      setWaStatus(res.data || { status: 'UNKNOWN' });
    } catch (_) {}
  }, [isVisible]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSE/focus-driven WA status subscription
    fetchWaStatus();
    const handleSse = () => fetchWaStatus();
    window.addEventListener('sse-wa-status-changed', handleSse);
    window.addEventListener('focus', handleSse);
    return () => {
      window.removeEventListener('sse-wa-status-changed', handleSse);
      window.removeEventListener('focus', handleSse);
    };
  }, [fetchWaStatus]);

  useEffect(() => {
    const connecting = waStatus.status !== 'READY' && waStatus.status !== 'CONNECTED';
    if (!connecting || !isVisible) return;
    const interval = setInterval(fetchWaStatus, 3000);
    return () => clearInterval(interval);
  }, [waStatus.status, isVisible, fetchWaStatus]);

  // Telegram status poll
  const { data: telegramStatus } = useApiQuery<{ isReady: boolean }>(
    'telegram-status',
    () => apiClient.get('/settings/telegram-status').then(res => res.data),
    { enabled: isVisible && telegramEnabled, refetchInterval: 10000 }
  );

  const handleResetIntegrations = () => {
    setWaPreferredSystem(rawSettings.whatsapp_preferred_system || 'web');
    setWaBusinessToken(rawSettings.wa_business_access_token || '');
    setWaBusinessPhoneId(rawSettings.wa_business_phone_number_id || '');
    setEmailInvoiceRecipient(rawSettings.notify_owner_on_email_whatsapp === '0' ? 'none' : (rawSettings.email_invoice_whatsapp_recipient || 'both'));
    setTelegramEnabled(rawSettings.telegram_enabled === 'true');
    setTelegramToken(rawSettings.telegram_token || '');
    setTelegramChatId(rawSettings.telegram_chat_id || '');
    setGmailUser(rawSettings.gmail_user || '');
    setGmailPass(rawSettings.gmail_pass || '');
    setPharmarackUser(rawSettings.pharmarack_username || '');
    setPharmarackPass(rawSettings.pharmarack_password || '');
    setReorderWindowMonths(rawSettings.pharmarack_reorder_window_months || '2');
    setWaIdleSleepMin(rawSettings.whatsapp_idle_sleep_min || '15');
    toastEvent.trigger('Integration credentials reset to saved parameters', 'info');
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        whatsapp_preferred_system: waPreferredSystem,
        wa_business_access_token: waBusinessToken,
        wa_business_phone_number_id: waBusinessPhoneId,
        email_invoice_whatsapp_recipient: emailInvoiceRecipient,
        notify_owner_on_email_whatsapp: emailInvoiceRecipient === 'none' ? '0' : '1',
        telegram_enabled: telegramEnabled ? 'true' : 'false',
        telegram_token: telegramToken,
        telegram_chat_id: telegramChatId,
        gmail_user: gmailUser,
        gmail_pass: gmailPass,
        pharmarack_username: pharmarackUser,
        pharmarack_password: pharmarackPass,
        pharmarack_mode: 'Live',
        pharmarack_reorder_window_months: reorderWindowMonths,
        whatsapp_idle_sleep_min: waIdleSleepMin
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Integrations & API credentials saved successfully', 'success');
      updateSettingsCache(queryClient, payload);
      broadcastContactDataChanged(queryClient);
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save integration settings: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerPharmarackRefresh = async () => {
    setPharmarackRefreshing(true);
    try {
      const res = await apiClient.post('/pharmarack/trigger-reauth');
      if (res.data?.success) {
        toastEvent.trigger('Pharmarack live B2B session refreshed successfully', 'success');
        refetchSettings();
      } else {
        toastEvent.trigger(res.data?.message || 'Session expired. Click "Open Login Window" to complete authentication.', 'info');
      }
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Pharmarack session refresh error: ' + e.message, 'error');
    } finally {
      setPharmarackRefreshing(false);
    }
  };

  const handleLaunchPharmarackLogin = async () => {
    try {
      toastEvent.trigger('Opening Pharmarack Login window in Chrome...', 'info');
      await api.launchPharmarackLoginWindow();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger(e?.response?.data?.error || 'Failed to launch login window', 'error');
    }
  };

  const handleReorderWindowChange = async (months: string) => {
    setReorderWindowMonths(months);
    try {
      await apiClient.post('/settings', { key: 'pharmarack_reorder_window_months', value: months });
      toastEvent.trigger(`Reorder lookback window set to ${months} months`, 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to save reorder window: ' + e.message, 'error');
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
                    waStatus.status === 'READY'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : waStatus.status === 'SLEEPING'
                        ? 'bg-sky-500/20 text-sky-400'
                        : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {waStatus.status}
                  </span>
                </div>
                {waStatus.status === 'SLEEPING' && (
                  <p className="text-[11px] text-muted">
                    Browser closed to save memory. It wakes automatically when you send a message.
                  </p>
                )}
                <div>
                  <label className="block text-xs font-semibold text-text mb-1" htmlFor="wa-idle-sleep-min">
                    Sleep browser after idle (minutes)
                  </label>
                  <input
                    id="wa-idle-sleep-min"
                    type="number"
                    min={0}
                    max={480}
                    value={waIdleSleepMin}
                    onChange={(e) => setWaIdleSleepMin(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
                    placeholder="15"
                  />
                  <p className="text-[10px] text-muted mt-1">
                    Frees ~250–400 MB RAM while idle. Queued messages wake it automatically. 0 = never sleep.
                  </p>
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

          {/* Email Invoice WhatsApp Alert Recipient Management */}
          <div className="md:col-span-2 bg-bg3/30 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-text uppercase flex items-center gap-2">
                  <Mail size={14} className="text-primary" /> Invoice Email WhatsApp Notifications
                </h3>
                <p className="text-[11px] text-muted mt-0.5">
                  Choose which phone number(s) receive automatic WhatsApp alerts when distributor invoice emails are received.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
              {[
                {
                  id: 'both',
                  label: 'Both Numbers',
                  desc: 'Store & Owner',
                  phone: [rawSettings.shop_phone || rawSettings.phone, rawSettings.owner_whatsapp_number].filter(Boolean).join(' + ') || 'Both configured'
                },
                {
                  id: 'pharmacy',
                  label: 'Pharmacy / Counter',
                  desc: 'Store Phone',
                  phone: rawSettings.shop_phone || rawSettings.phone || 'Not configured'
                },
                {
                  id: 'owner',
                  label: 'Owner WhatsApp',
                  desc: 'Owner Mobile',
                  phone: rawSettings.owner_whatsapp_number || 'Not configured'
                },
                {
                  id: 'none',
                  label: 'Disabled',
                  desc: 'No Alerts',
                  phone: 'Turned off'
                }
              ].map((opt) => {
                const isSelected = emailInvoiceRecipient === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setEmailInvoiceRecipient(opt.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-primary/10 border-primary shadow-sm text-text'
                        : 'bg-bg2/60 border-border text-muted hover:text-text hover:bg-bg2'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{opt.label}</span>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white"></span>}
                      </span>
                    </div>
                    <div className="mt-2 text-[10px] text-muted truncate">
                      <span className="font-mono">{opt.phone}</span>
                    </div>
                  </button>
                );
              })}
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Username / Phone</label>
            <input
              type="text"
              value={pharmarackUser}
              onChange={(e) => setPharmarackUser(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="Mobile / Username"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text mb-1">Pharmarack Login Password</label>
            <input
              type="password"
              value={pharmarackPass}
              onChange={(e) => setPharmarackPass(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              placeholder="Account Password"
            />
          </div>
          <div>
            <button
              type="button"
              onClick={handleTriggerPharmarackRefresh}
              disabled={pharmarackRefreshing}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
              title="Attempt silent token refresh from saved Chrome session profile"
            >
              <RefreshCw size={14} className={pharmarackRefreshing ? 'animate-spin' : ''} />
              <span>Refresh Session</span>
            </button>
          </div>
          <div>
            <button
              type="button"
              onClick={handleLaunchPharmarackLogin}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/80 transition-all cursor-pointer shadow-sm"
              title="Open Chrome window with auto-filled credentials to enter OTP"
            >
              <Smartphone size={14} />
              <span>Open Login (OTP)</span>
            </button>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-xs font-semibold text-text mb-1">Reorder Suggestions Lookback Window</label>
          <select
            value={reorderWindowMonths}
            onChange={(e) => handleReorderWindowChange(e.target.value)}
            className="w-full md:w-1/3 px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
          >
            <option value="2">2 months</option>
            <option value="4">4 months</option>
            <option value="6">6 months</option>
            <option value="8">8 months</option>
          </select>
          <p className="text-[11px] text-muted mt-1">
            How far back sales/purchase history is weighed for restock suggestions and the &quot;Ordered Recently&quot; list in the Reorder Hub. Changing this recomputes suggestions in the background.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={handleResetIntegrations}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-bg3 border border-border text-muted hover:text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
        >
          <RotateCcw size={14} />
          <span>Reset Form</span>
        </button>
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
  const [showSystemResetModal, setShowSystemResetModal] = useState(false);
  const [resetModalInitialMode, setResetModalInitialMode] = useState<'data' | 'factory'>('data');
  const queryClient = useQueryClient();

  const handleSaveBackupSchedule = async () => {
    setSavingFreq(true);
    try {
      await apiClient.post('/settings/save', { backup_frequency: backupFrequency });
      toastEvent.trigger('Backup schedule updated', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to update backup schedule: ' + e.message, 'error');
    } finally {
      setSavingFreq(false);
    }
  };

  const handleClearCache = async () => {
    try {
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      toastEvent.trigger('Local inventory & search cache cleared successfully', 'success');
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to clear cache: ' + e.message, 'error');
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

      {/* Maintenance, Cache & Reset */}
      <div className="space-y-4 pt-2 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Trash2 size={16} /> System Maintenance, Data Reset & Factory Wipe
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Search Cache */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RefreshCw size={14} className="text-amber-400" /> Clear Search Cache
              </h3>
              <p className="text-[11px] text-muted mt-1">Forces instant re-hydration of SQLite compact indexes without touching sales data.</p>
            </div>
            <div>
              <button
                onClick={handleClearCache}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer"
              >
                Clear Search Cache
              </button>
            </div>
          </div>

          {/* Card 2: System Data Reset */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RotateCcw size={14} className="text-amber-400" /> System Data Reset
              </h3>
              <p className="text-[11px] text-muted mt-1">Wipes sales, inventory & transactions. Keeps store profile & API keys intact.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('data'); }}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} />
                <span>Reset Sales & Inventory</span>
              </button>
            </div>
          </div>

          {/* Card 3: Full Factory Reset */}
          <div className="flex flex-col justify-between gap-4 bg-red-500/5 border border-red-500/30 rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-red-400 flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" /> Full Factory Reset (Complete Wipe)
              </h3>
              <p className="text-[11px] text-muted mt-1">Completely wipes ALL saved data, WhatsApp/Gmail tokens, Pharmarack logins, doctors, distributors & settings to fresh factory state.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('factory'); }}
                className="w-full py-2 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Full Factory Reset</span>
              </button>
            </div>
          </div>
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

      {/* System Data Reset Modal */}
      {showSystemResetModal && (
        <ResetDataModal
          initialMode={resetModalInitialMode}
          onClose={() => setShowSystemResetModal(false)}
          refetchSettings={refetchSettings}
        />
      )}
    </div>
  );
}

// ==========================================
// SYSTEM DATA & FACTORY RESET MODAL
// ==========================================

interface ResetDataModalProps {
  initialMode?: 'data' | 'factory';
  onClose: () => void;
  refetchSettings: () => void;
}

function ResetDataModal({ initialMode = 'data', onClose, refetchSettings }: ResetDataModalProps) {
  const [resetType, setResetType] = useState<'data' | 'factory'>(initialMode);
  const [dataCounts, setDataCounts] = useState<{ medicines: number; inventory: number; bills: number; purchases: number; customers: number } | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [confirmInput, setConfirmInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    apiClient.get('/utilities/data-counts')
      .then(res => setDataCounts(res.data))
      .catch(err => console.warn('Failed to fetch data counts:', err))
      .finally(() => setLoadingCounts(false));
  }, []);

  const requiredWord = resetType === 'factory' ? 'FACTORY RESET' : 'RESET';
  const isConfirmed = confirmInput.trim().toUpperCase() === requiredWord;

  const handleExecuteReset = async () => {
    if (!isConfirmed) return;
    setResetting(true);
    try {
      const res = await apiClient.post('/utilities/reset-data', { wipeAll: resetType === 'factory' });
      
      // 1. Purge all localStorage sent order history keys & cached state
      try {
        localStorage.removeItem('pharmacart_sent_wa_history');
        localStorage.removeItem('pharmarack_last_sent_wa_time_map');
        localStorage.removeItem('pharmarack_last_batch_sent_time');
        localStorage.removeItem('pharmarack_sent_history');
        localStorage.removeItem('pharmarack_latest_sent_map');
        localStorage.removeItem('custom_distributor_phones');
        localStorage.removeItem('pos_active_tabs');
        localStorage.removeItem('sells-date-range');
        if (resetType === 'factory') {
          localStorage.clear();
          sessionStorage.clear();
        }
      } catch (_) {}

      // 2. Clear QueryClient and invalidate queries
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      refetchSettings();

      // 3. Dispatch events to notify all active pages
      window.dispatchEvent(new CustomEvent('clear-app-cache'));
      window.dispatchEvent(new CustomEvent('clear-sent-history'));
      window.dispatchEvent(new CustomEvent('settings-updated'));

      toastEvent.trigger(res.data?.message || 'Database reset successfully', 'success');
      onClose();

      // 4. Force browser page reload after short delay to flush all module-level memory variables across SPA
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('System reset failed: ' + (e.response?.data?.error || e.message || 'Unknown error'), 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl p-6 w-full max-w-xl relative shadow-2xl space-y-5">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/30">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">System Data Reset & Factory Initialization</h2>
            <p className="text-xs text-muted">Re-initialize database tables, self-heal schemas, or execute full factory reset.</p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setResetType('data'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'data'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <RotateCcw size={14} /> System Data Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Wipes sales, inventory & transactions. Keeps store profile & API keys intact.</p>
          </button>

          <button
            type="button"
            onClick={() => { setResetType('factory'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'factory'
                ? 'bg-red-500/10 border-red-500/40 text-red-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <Trash2 size={14} /> Full Factory Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Complete wipe of all data, store profile, cashier accounts & integration tokens.</p>
          </button>
        </div>

        {/* Impact Summary */}
        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold text-text uppercase tracking-wider">Live Database Snapshot</h3>
          {loadingCounts ? (
            <div className="flex items-center text-xs text-muted py-2">
              <RefreshCw size={14} className="animate-spin mr-2" /> Counting active records...
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.medicines ?? 0}</div>
                <div className="text-[10px] text-muted">Medicines</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.inventory ?? 0}</div>
                <div className="text-[10px] text-muted">Batches</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.bills ?? 0}</div>
                <div className="text-[10px] text-muted">Sales Bills</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.purchases ?? 0}</div>
                <div className="text-[10px] text-muted">Purchases</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.customers ?? 0}</div>
                <div className="text-[10px] text-muted">Customers</div>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Input */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-text">
            Type <span className="font-mono font-bold text-red-400">{requiredWord}</span> to confirm execution:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={`Type ${requiredWord} here`}
            className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-red-500 focus:outline-none"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteReset}
            disabled={!isConfirmed || resetting}
            className={`flex items-center gap-2 px-5 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm ${
              isConfirmed && !resetting
                ? resetType === 'factory' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-muted/20 text-muted cursor-not-allowed border border-border'
            }`}
          >
            {resetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            <span>Execute {resetType === 'factory' ? 'Factory Reset' : 'System Reset'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 5: TRIGGER SCHEDULES & AUTOMATION
// ==========================================

function TriggerSchedulesTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [formData, setFormData] = useState({
    automationEnabled: rawSettings.automation_enabled !== 'false',

    // 1. Daily Operational Check
    triggerDailyCheckEnabled: rawSettings.trigger_daily_check_enabled !== 'false',
    triggerDailyCheckTime: rawSettings.trigger_daily_check_time || '09:00',

    // 2. Near-Expiry Stock Scan
    triggerExpiryScanEnabled: rawSettings.trigger_expiry_scan_enabled !== 'false',
    triggerExpiryScanTime: rawSettings.trigger_expiry_scan_time || '09:00',
    triggerExpiryScanDays: rawSettings.trigger_expiry_scan_days || '1,16',
    triggerExpiryLookaheadDays: rawSettings.trigger_expiry_lookahead_days || '90',

    // 3. Distributor Dispatch Reminder
    triggerDispatchReminderEnabled: rawSettings.trigger_dispatch_reminder_enabled === 'true',
    triggerDispatchReminderTimeStart: rawSettings.trigger_dispatch_reminder_time_start || '12:30',
    triggerDispatchReminderTimeEnd: rawSettings.trigger_dispatch_reminder_time_end || '13:00',
    triggerAfternoonDispatchReminderEnabled: rawSettings.trigger_afternoon_dispatch_reminder_enabled === 'true',
    triggerAfternoonDispatchReminderTime: rawSettings.trigger_afternoon_dispatch_reminder_time || '14:00',

    // 4. Nightly Database Backup
    triggerBackupEnabled: rawSettings.trigger_backup_enabled !== 'false',
    triggerBackupTime: rawSettings.trigger_backup_time || '21:59',

    // 5. Auto Expiry Return Memos
    triggerExpiryReturnEnabled: rawSettings.trigger_expiry_return_enabled !== 'false',
    triggerExpiryReturnIntervalDays: rawSettings.trigger_expiry_return_interval_days || '15',

    // 6. Pharmarack Token Refresher
    triggerPharmarackRefreshEnabled: rawSettings.trigger_pharmarack_refresh_enabled !== 'false',
    triggerPharmarackRefreshIntervalMin: rawSettings.trigger_pharmarack_refresh_interval_min || '20',

    // 7. WhatsApp Message Queue
    triggerWhatsappQueueEnabled: rawSettings.trigger_whatsapp_queue_enabled !== 'false',
    triggerWhatsappQueueIntervalSec: rawSettings.trigger_whatsapp_queue_interval_sec || '30',

    // 8. Email PDF Invoice Poller
    triggerEmailPollerEnabled: rawSettings.trigger_email_poller_enabled !== 'false',
    triggerEmailPollerIntervalMin: rawSettings.trigger_email_poller_interval_min || '15',

    // 9. Doctor Daily Reports
    triggerDoctorReportEnabled: rawSettings.trigger_doctor_report_enabled !== 'false',
    triggerDoctorReportTime: rawSettings.trigger_doctor_report_time || '20:00',

    // 10. Patient Chronic Refill Evaluator
    triggerRefillsEnabled: rawSettings.trigger_refills_enabled !== 'false',
    triggerRefillsCheckTime: rawSettings.trigger_refills_check_time || '09:00',
  });

  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSaveTriggers = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        automation_enabled: formData.automationEnabled ? 'true' : 'false',
        trigger_daily_check_enabled: formData.triggerDailyCheckEnabled ? 'true' : 'false',
        trigger_daily_check_time: formData.triggerDailyCheckTime,
        trigger_expiry_scan_enabled: formData.triggerExpiryScanEnabled ? 'true' : 'false',
        trigger_expiry_scan_time: formData.triggerExpiryScanTime,
        trigger_expiry_scan_days: formData.triggerExpiryScanDays,
        trigger_expiry_lookahead_days: formData.triggerExpiryLookaheadDays,
        trigger_dispatch_reminder_enabled: formData.triggerDispatchReminderEnabled ? 'true' : 'false',
        trigger_dispatch_reminder_time_start: formData.triggerDispatchReminderTimeStart,
        trigger_dispatch_reminder_time_end: formData.triggerDispatchReminderTimeEnd,
        trigger_afternoon_dispatch_reminder_enabled: formData.triggerAfternoonDispatchReminderEnabled ? 'true' : 'false',
        trigger_afternoon_dispatch_reminder_time: formData.triggerAfternoonDispatchReminderTime,
        trigger_backup_enabled: formData.triggerBackupEnabled ? 'true' : 'false',
        trigger_backup_time: formData.triggerBackupTime,
        trigger_expiry_return_enabled: formData.triggerExpiryReturnEnabled ? 'true' : 'false',
        trigger_expiry_return_interval_days: formData.triggerExpiryReturnIntervalDays,
        trigger_pharmarack_refresh_enabled: formData.triggerPharmarackRefreshEnabled ? 'true' : 'false',
        trigger_pharmarack_refresh_interval_min: formData.triggerPharmarackRefreshIntervalMin,
        trigger_whatsapp_queue_enabled: formData.triggerWhatsappQueueEnabled ? 'true' : 'false',
        trigger_whatsapp_queue_interval_sec: formData.triggerWhatsappQueueIntervalSec,
        trigger_email_poller_enabled: formData.triggerEmailPollerEnabled ? 'true' : 'false',
        trigger_email_poller_interval_min: formData.triggerEmailPollerIntervalMin,
        trigger_doctor_report_enabled: formData.triggerDoctorReportEnabled ? 'true' : 'false',
        trigger_doctor_report_time: formData.triggerDoctorReportTime,
        trigger_refills_enabled: formData.triggerRefillsEnabled ? 'true' : 'false',
        trigger_refills_check_time: formData.triggerRefillsCheckTime,
      };

      await api.saveSettings(payload);
      refetchSettings();
      updateSettingsCache(queryClient, payload);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toastEvent.trigger('Automated trigger schedules saved & applied successfully!', 'success');
    } catch (err) {
      console.error('Failed to save trigger schedules:', err);
      toastEvent.trigger('Failed to save trigger schedules', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner & Save Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-bg3/40 border border-border">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 mt-0.5">
            <Clock size={22} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text">Automated Trigger Schedule Engine</h2>
            <p className="text-xs text-muted mt-0.5">Configure execution times, frequency intervals & auto-triggers for every background worker in AI PHARMACY OS.</p>
          </div>
        </div>

        <button
          onClick={handleSaveTriggers}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? 'Applying Schedules...' : 'Save & Apply Schedules'}</span>
        </button>
      </div>

      {/* Global Master Toggle */}
      <div className="p-4 rounded-2xl bg-bg3/20 border border-border flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-text">Master Background Automation Switch</div>
          <div className="text-[11px] text-muted">Master override to enable or pause all background automated workers across the system.</div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={formData.automationEnabled}
            onChange={(e) => setFormData({ ...formData, automationEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-bg3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      {/* Grid of 10 Trigger Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Trigger 1: Daily Operational Check */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Daily Operational Check</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDailyCheckEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDailyCheckEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Evaluates patient refills, checks overdue Khata credit notes, and triggers bounced product alerts daily.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Execution Time:</label>
            <input
              type="time"
              value={formData.triggerDailyCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerDailyCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 2: Near-Expiry Stock Scan */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-xs font-bold text-text">Near-Expiry Stock Scan & Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryScanEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans inventory for batches nearing expiration and sends alerts to store owner.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Time:</label>
              <input
                type="time"
                value={formData.triggerExpiryScanTime}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanTime: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Days:</label>
              <input
                type="text"
                placeholder="1,16"
                value={formData.triggerExpiryScanDays}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanDays: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3: Distributor Dispatch Reminder */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-blue-500" />
              <span className="text-xs font-bold text-text">Distributor Dispatch Reminders</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends automated daily dispatches and stock reminders to suppliers during active window.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Start:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeStart}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeStart: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">End:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeEnd}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeEnd: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3B: Afternoon Delivery Boy Dispatch */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Afternoon Delivery Boy Dispatch</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerAfternoonDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends a consolidated WhatsApp collection summary with repeat order counts (e.g. 2x) to active Delivery Staff.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Dispatch Time:</label>
            <input
              type="time"
              value={formData.triggerAfternoonDispatchReminderTime}
              onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 4: Nightly Database Backup */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-purple-500" />
              <span className="text-xs font-bold text-text">Nightly Database Backup</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerBackupEnabled}
                onChange={(e) => setFormData({ ...formData, triggerBackupEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Automatically compiles compressed database backups every night.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Backup Time:</label>
            <input
              type="time"
              value={formData.triggerBackupTime}
              onChange={(e) => setFormData({ ...formData, triggerBackupTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 5: Auto Expiry Return Review Scans */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-indigo-500" />
              <span className="text-xs font-bold text-text">Auto Expiry Return Review Scans</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryReturnEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryReturnEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans in-stock inventory only (never sold or already-returned batches) for expired batches and creates pending items for pharmacist review. Requires manual approval before stock deduction.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (days):</label>
            <input
              type="number"
              min="1"
              max="365"
              placeholder="15"
              value={formData.triggerExpiryReturnIntervalDays}
              onChange={(e) => setFormData({ ...formData, triggerExpiryReturnIntervalDays: e.target.value })}
              className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 6: Pharmarack Token Refresher */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-teal-500" />
              <span className="text-xs font-bold text-text">Pharmarack Token Refresher</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerPharmarackRefreshEnabled}
                onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Keeps Pharmarack session rolling and refreshes OAuth tokens headlessly.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerPharmarackRefreshIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 7: WhatsApp Message Queue */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-green-500" />
              <span className="text-xs font-bold text-text">WhatsApp Message Queue</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerWhatsappQueueEnabled}
                onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Processes pending outbound WhatsApp messages with rate-limiting and anti-ban protection.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Seconds):</label>
            <input
              type="number"
              min="5"
              max="300"
              value={formData.triggerWhatsappQueueIntervalSec}
              onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueIntervalSec: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 8: Email PDF Invoice Poller */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-cyan-500" />
              <span className="text-xs font-bold text-text">Email PDF Invoice Poller</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerEmailPollerEnabled}
                onChange={(e) => setFormData({ ...formData, triggerEmailPollerEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans linked store email inbox for incoming distributor invoices and queues OCR parsing.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Polling (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerEmailPollerIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerEmailPollerIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 9: Doctor Daily Reports */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stethoscope size={16} className="text-rose-500" />
              <span className="text-xs font-bold text-text">Doctor Daily Summary Reports</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDoctorReportEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDoctorReportEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Compiles daily prescription statistics and emails/whatsapps reports to partner doctors.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Report Time:</label>
            <input
              type="time"
              value={formData.triggerDoctorReportTime}
              onChange={(e) => setFormData({ ...formData, triggerDoctorReportTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 10: Chronic Refill Evaluator */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-sky-500" />
              <span className="text-xs font-bold text-text">Chronic Medication Refill Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerRefillsEnabled}
                onChange={(e) => setFormData({ ...formData, triggerRefillsEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans chronic dosage schedules and queues 3-day refill alerts for patients.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Check Time:</label>
            <input
              type="time"
              value={formData.triggerRefillsCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerRefillsCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
