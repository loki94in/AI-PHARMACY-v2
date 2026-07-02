import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, api } from '../../services/api';
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
} from 'lucide-react';
import { toastEvent } from '../../services/events';
import { MobileConnectionModal } from '../../components/MobileConnectionModal';

interface DeliveryBoy {
  id: number;
  name: string;
  whatsapp_number?: string;
  telegram_chat_id?: string;
  is_active: number;
}

interface SettingsData {
  pharmacyName: string;
  address: string;
  phone: string;
  gstin: string;
  drugLicense: string;
  email: string;
  gmailUser: string;
  gmailPass: string;
  googleClientId: string;
  googleClientSecret: string;
  gmailAuthMethod: string;
  emailAutodeleteEnabled: boolean;
  emailAutodeleteLimit: number;
  automationEnabled: boolean;
  adminRemoteMode: boolean;
  adminUsername: string;
  adminPassword: string;
  adminUniqueKey: string;
  adminAuthorizedDeviceId: string;
  adminAuthorizedDeviceName: string;
  prUsername: string;
  prPassword: string;
  prToken: string;
  prMode: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  autoPrint: boolean;
  defaultPaymentMode: string;
  whatsappNotif: boolean;
  emailAlerts: boolean;
  lowStockThreshold: number;
  expiryAlertDays: number;
  dineshWhatsappNumber: string;
  telegramEnabled: boolean;
  telegramToken: string;
  telegramChatId: string;
  whatsappEnabled: boolean;
  waBusinessEnabled: boolean;
  waBusinessPhoneNumberId: string;
  waBusinessAccessToken: string;
  waBusinessWabaId: string;
  waBusinessWebhookVerifyToken: string;
  whatsappPreferredSystem: string;
  backupFrequency: string;
}

const Settings = () => {
  // Consolidated settings data state
  const [settings, setSettings] = useState<SettingsData>({
    pharmacyName: '',
    address: '',
    phone: '',
    gstin: '',
    drugLicense: '',
    email: '',
    gmailUser: '',
    gmailPass: '',
    googleClientId: '',
    googleClientSecret: '',
    gmailAuthMethod: 'password',
    emailAutodeleteEnabled: true,
    emailAutodeleteLimit: 10,
    automationEnabled: false,
    adminRemoteMode: true,
    adminUsername: 'admin',
    adminPassword: 'admin123',
    adminUniqueKey: 'KEY-ADM-837261',
    adminAuthorizedDeviceId: '',
    adminAuthorizedDeviceName: '',
    prUsername: '',
    prPassword: '',
    prToken: '',
    prMode: 'Live',
    defaultTaxRate: 18,
    invoicePrefix: 'INV-',
    autoPrint: false,
    defaultPaymentMode: 'Cash',
    whatsappNotif: false,
    emailAlerts: false,
    lowStockThreshold: 10,
    expiryAlertDays: 90,
    dineshWhatsappNumber: '',
    telegramEnabled: false,
    telegramToken: '',
    telegramChatId: '',
    whatsappEnabled: false,
    waBusinessEnabled: false,
    waBusinessPhoneNumberId: '',
    waBusinessAccessToken: '',
    waBusinessWabaId: '',
    waBusinessWebhookVerifyToken: '',
    whatsappPreferredSystem: 'automated',
    backupFrequency: 'off',
  });

  // Transient UI states
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [isOpeningWindow, setIsOpeningWindow] = useState(false);
  const [isOpeningWaWindow, setIsOpeningWaWindow] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [desktopNotifEnabled, setDesktopNotifEnabled] = useState(() => {
    return 'Notification' in window && Notification.permission === 'granted';
  });
  const [waStatus, setWaStatus] = useState({ isReady: false, qrUrl: null as string | null, message: '' });
  const [waBusinessTestResult, setWaBusinessTestResult] = useState<{ success?: boolean; phone?: string; name?: string; error?: string } | null>(null);
  const [waBusinessTesting, setWaBusinessTesting] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupList, setBackupList] = useState<{ filename: string; sizeBytes: number; createdAt: string }[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Generic helper to update settings fields
  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K] | ((prevVal: SettingsData[K]) => SettingsData[K])) => {
    setSettings(prev => ({
      ...prev,
      [key]: typeof value === 'function' ? (value as Function)(prev[key]) : value
    }));
  };

  // Mapped setters for backward compatibility with minimum code churn
  const setPharmacyName = (val: string | ((p: string) => string)) => updateSetting('pharmacyName', val);
  const setAddress = (val: string | ((p: string) => string)) => updateSetting('address', val);
  const setPhone = (val: string | ((p: string) => string)) => updateSetting('phone', val);
  const setGstin = (val: string | ((p: string) => string)) => updateSetting('gstin', val);
  const setDrugLicense = (val: string | ((p: string) => string)) => updateSetting('drugLicense', val);
  const setEmail = (val: string | ((p: string) => string)) => updateSetting('email', val);
  const setGmailUser = (val: string | ((p: string) => string)) => updateSetting('gmailUser', val);
  const setGmailPass = (val: string | ((p: string) => string)) => updateSetting('gmailPass', val);
  const setGoogleClientId = (val: string | ((p: string) => string)) => updateSetting('googleClientId', val);
  const setGoogleClientSecret = (val: string | ((p: string) => string)) => updateSetting('googleClientSecret', val);
  const setGmailAuthMethod = (val: string | ((p: string) => string)) => updateSetting('gmailAuthMethod', val);
  const setEmailAutodeleteEnabled = (val: boolean | ((p: boolean) => boolean)) => updateSetting('emailAutodeleteEnabled', val);
  const setEmailAutodeleteLimit = (val: number | ((p: number) => number)) => updateSetting('emailAutodeleteLimit', val);
  const setAutomationEnabled = (val: boolean | ((p: boolean) => boolean)) => updateSetting('automationEnabled', val);
  const setAdminRemoteMode = (val: boolean | ((p: boolean) => boolean)) => updateSetting('adminRemoteMode', val);
  const setAdminUsername = (val: string | ((p: string) => string)) => updateSetting('adminUsername', val);
  const setAdminPassword = (val: string | ((p: string) => string)) => updateSetting('adminPassword', val);
  const setAdminUniqueKey = (val: string | ((p: string) => string)) => updateSetting('adminUniqueKey', val);
  const setAdminAuthorizedDeviceId = (val: string | ((p: string) => string)) => updateSetting('adminAuthorizedDeviceId', val);
  const setAdminAuthorizedDeviceName = (val: string | ((p: string) => string)) => updateSetting('adminAuthorizedDeviceName', val);
  const setPrUsername = (val: string | ((p: string) => string)) => updateSetting('prUsername', val);
  const setPrPassword = (val: string | ((p: string) => string)) => updateSetting('prPassword', val);
  const setPrToken = (val: string | ((p: string) => string)) => updateSetting('prToken', val);
  const setPrMode = (val: string | ((p: string) => string)) => updateSetting('prMode', val);
  const setDefaultTaxRate = (val: number | ((p: number) => number)) => updateSetting('defaultTaxRate', val);
  const setInvoicePrefix = (val: string | ((p: string) => string)) => updateSetting('invoicePrefix', val);
  const setAutoPrint = (val: boolean | ((p: boolean) => boolean)) => updateSetting('autoPrint', val);
  const setDefaultPaymentMode = (val: string | ((p: string) => string)) => updateSetting('defaultPaymentMode', val);
  const setWhatsappNotif = (val: boolean | ((p: boolean) => boolean)) => updateSetting('whatsappNotif', val);
  const setEmailAlerts = (val: boolean | ((p: boolean) => boolean)) => updateSetting('emailAlerts', val);
  const setLowStockThreshold = (val: number | ((p: number) => number)) => updateSetting('lowStockThreshold', val);
  const setExpiryAlertDays = (val: number | ((p: number) => number)) => updateSetting('expiryAlertDays', val);
  const setDineshWhatsappNumber = (val: string | ((p: string) => string)) => updateSetting('dineshWhatsappNumber', val);
  const setTelegramEnabled = (val: boolean | ((p: boolean) => boolean)) => updateSetting('telegramEnabled', val);
  const setTelegramToken = (val: string | ((p: string) => string)) => updateSetting('telegramToken', val);
  const setTelegramChatId = (val: string | ((p: string) => string)) => updateSetting('telegramChatId', val);
  const setWhatsappEnabled = (val: boolean | ((p: boolean) => boolean)) => updateSetting('whatsappEnabled', val);
  const setWaBusinessEnabled = (val: boolean | ((p: boolean) => boolean)) => updateSetting('waBusinessEnabled', val);
  const setWaBusinessPhoneNumberId = (val: string | ((p: string) => string)) => updateSetting('waBusinessPhoneNumberId', val);
  const setWaBusinessAccessToken = (val: string | ((p: string) => string)) => updateSetting('waBusinessAccessToken', val);
  const setWaBusinessWabaId = (val: string | ((p: string) => string)) => updateSetting('waBusinessWabaId', val);
  const setWaBusinessWebhookVerifyToken = (val: string | ((p: string) => string)) => updateSetting('waBusinessWebhookVerifyToken', val);
  const setWhatsappPreferredSystem = (val: string | ((p: string) => string)) => updateSetting('whatsappPreferredSystem', val);
  const setBackupFrequency = (val: string | ((p: string) => string)) => updateSetting('backupFrequency', val);

  // Destructure settings for transparent use in JSX and helper functions
  const {
    pharmacyName,
    address,
    phone,
    gstin,
    drugLicense,
    email,
    gmailUser,
    gmailPass,
    googleClientId,
    googleClientSecret,
    gmailAuthMethod,
    emailAutodeleteEnabled,
    emailAutodeleteLimit,
    automationEnabled,
    adminRemoteMode,
    adminUsername,
    adminPassword,
    adminUniqueKey,
    adminAuthorizedDeviceId,
    adminAuthorizedDeviceName,
    prUsername,
    prPassword,
    prToken,
    prMode,
    defaultTaxRate,
    invoicePrefix,
    autoPrint,
    defaultPaymentMode,
    whatsappNotif,
    emailAlerts,
    lowStockThreshold,
    expiryAlertDays,
    dineshWhatsappNumber,
    telegramEnabled,
    telegramToken,
    telegramChatId,
    whatsappEnabled,
    waBusinessEnabled,
    waBusinessPhoneNumberId,
    waBusinessAccessToken,
    waBusinessWabaId,
    waBusinessWebhookVerifyToken,
    whatsappPreferredSystem,
    backupFrequency,
  } = settings;

  const handleToggleDesktopNotifications = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (checked) {
      if (!('Notification' in window)) {
        toastEvent.trigger('Desktop notifications are not supported by this browser.', 'error');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setDesktopNotifEnabled(true);
        toastEvent.trigger('Desktop notifications enabled!', 'success');
      } else {
        setDesktopNotifEnabled(false);
        toastEvent.trigger('Permission denied for desktop notifications.', 'error');
      }
    } else {
      setDesktopNotifEnabled(false);
      toastEvent.trigger('Desktop notifications can be disabled in your browser settings.', 'info');
    }
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await apiClient.get('/settings');
        if (data) {
          setPharmacyName(data.shop_name || '');
          setAddress(data.shop_address || '');
          setPhone(data.shop_phone || '');
          setGstin(data.gstin || '');
          setDrugLicense(data.shop_licence || '');
          setEmail(data.email || '');
          
          setGmailUser(data.gmail_user || '');
          setGmailPass(data.gmail_pass || '');
          setGoogleClientId(data.google_client_id || '');
          setGoogleClientSecret(data.google_client_secret || '');
          setGmailAuthMethod(data.gmail_auth_method || 'password');
          setEmailAutodeleteEnabled(data.email_autodelete_enabled !== 'false');
          setEmailAutodeleteLimit(Number(data.email_autodelete_limit) || 10);
          setAutomationEnabled(data.automation_enabled === 'true');

          setAdminRemoteMode(data.admin_remote_mode !== 'false');
          setAdminUsername(data.admin_username || 'admin');
          setAdminPassword(data.admin_password || 'admin123');
          setAdminUniqueKey(data.admin_unique_key || 'KEY-ADM-837261');
          setAdminAuthorizedDeviceId(data.admin_authorized_device_id || '');
          setAdminAuthorizedDeviceName(data.admin_authorized_device_name || '');

          setDefaultTaxRate(Number(data.default_tax_rate) || 18);
          setInvoicePrefix(data.invoice_prefix || 'INV-');
          setAutoPrint(data.auto_print === 'true');
          setDefaultPaymentMode(data.default_payment_mode || 'Cash');

          setWhatsappNotif(data.whatsapp_notif === 'true');
          setEmailAlerts(data.email_alerts === 'true');
          setLowStockThreshold(Number(data.low_stock_threshold) || 10);
          setExpiryAlertDays(Number(data.expiry_alert_days) || 90);
          setDineshWhatsappNumber(data.dinesh_whatsapp_number || '');

          setTelegramEnabled(data.telegram_enabled === 'true');
          setTelegramToken(data.telegram_token || '');
          setTelegramChatId(data.telegram_chat_id || '');
          
          setWhatsappEnabled(data.whatsapp_enabled === 'true');

           // WhatsApp Business API
          setWaBusinessEnabled(data.wa_business_enabled === 'true');
          setWaBusinessPhoneNumberId(data.wa_business_phone_number_id || '');
          setWaBusinessAccessToken(data.wa_business_access_token || '');
          setWaBusinessWabaId(data.wa_business_waba_id || '');
          setWaBusinessWebhookVerifyToken(data.wa_business_webhook_verify_token || '');
          setWhatsappPreferredSystem(data.whatsapp_preferred_system || 'automated');

          // Pharmarack Settings
          setPrUsername(data.pharmarack_username || '');
          setPrPassword(data.pharmarack_password || '');
          setPrToken(data.pharmarack_session_token || '');
          setPrMode(data.pharmarack_mode || 'Live');
        }
      } catch (error) {
        console.error('Failed to load settings', error);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    let timer: any;
    if (whatsappEnabled && !waStatus.isReady) {
      const fetchQR = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const { data } = await apiClient.get('/messaging/qr');
          setWaStatus(data);
        } catch (error) {
          console.error("Failed to fetch WhatsApp QR", error);
        }
      };

      fetchQR(); // Initial fetch
      timer = setInterval(fetchQR, 15000); // Poll every 15s (optimized from 5s)

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchQR();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [whatsappEnabled, waStatus.isReady]);

  const handleSaveSettings = async () => {
    const payload = {
      shop_name: pharmacyName,
      shop_address: address,
      shop_phone: phone,
      gstin: gstin,
      shop_licence: drugLicense,
      email: email,
      
      gmail_user: gmailUser,
      gmail_pass: gmailPass,
      google_client_id: googleClientId,
      google_client_secret: googleClientSecret,
      gmail_auth_method: gmailAuthMethod,
      email_autodelete_enabled: emailAutodeleteEnabled.toString(),
      email_autodelete_limit: emailAutodeleteLimit.toString(),
      automation_enabled: automationEnabled.toString(),
      admin_remote_mode: adminRemoteMode.toString(),
      admin_username: adminUsername,
      admin_password: adminPassword,
      admin_unique_key: adminUniqueKey,
      admin_authorized_device_id: adminAuthorizedDeviceId,
      admin_authorized_device_name: adminAuthorizedDeviceName,


      default_tax_rate: defaultTaxRate.toString(),
      invoice_prefix: invoicePrefix,
      auto_print: autoPrint.toString(),
      default_payment_mode: defaultPaymentMode,

      whatsapp_notif: whatsappNotif.toString(),
      email_alerts: emailAlerts.toString(),
      low_stock_threshold: lowStockThreshold.toString(),
      expiry_alert_days: expiryAlertDays.toString(),
      dinesh_whatsapp_number: dineshWhatsappNumber,

      telegram_enabled: telegramEnabled.toString(),
      telegram_token: telegramToken,
      telegram_chat_id: telegramChatId,
      
      whatsapp_enabled: whatsappEnabled.toString(),

       // WhatsApp Business API
      wa_business_enabled: waBusinessEnabled.toString(),
      wa_business_phone_number_id: waBusinessPhoneNumberId,
      wa_business_access_token: waBusinessAccessToken,
      wa_business_waba_id: waBusinessWabaId,
      wa_business_webhook_verify_token: waBusinessWebhookVerifyToken,
      whatsapp_preferred_system: whatsappPreferredSystem,

      // Pharmarack Settings
      pharmarack_username: prUsername,
      pharmarack_password: prPassword,
      pharmarack_session_token: prToken,
      pharmarack_mode: prMode,
    };

    try {
      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Settings saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save settings', error);
      toastEvent.trigger('Failed to save settings', 'error');
    }
  };

  const handleOpenLoginWindow = async () => {
    setIsOpeningWindow(true);
    setPrToken('');
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
          if (data && data.pharmarack_session_token && data.pharmarack_session_token !== prToken) {
            setPrToken(data.pharmarack_session_token);
            setPrMode(data.pharmarack_mode || 'Live');
            toastEvent.trigger('Successfully linked Pharmarack session!', 'success');
            clearInterval(interval);
            setIsOpeningWindow(false);
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
    setPrUsername('');
    setPrPassword('');
    setPrToken('');
    setPrMode('Live');
    
    const payload = {
      shop_name: pharmacyName,
      shop_address: address,
      shop_phone: phone,
      gstin: gstin,
      shop_licence: drugLicense,
      email: email,
      
      gmail_user: gmailUser,
      gmail_pass: gmailPass,
      google_client_id: googleClientId,
      google_client_secret: googleClientSecret,
      gmail_auth_method: gmailAuthMethod,
      email_autodelete_enabled: emailAutodeleteEnabled.toString(),
      email_autodelete_limit: emailAutodeleteLimit.toString(),
      automation_enabled: automationEnabled.toString(),
      admin_remote_mode: adminRemoteMode.toString(),
      admin_username: adminUsername,
      admin_password: adminPassword,
      admin_unique_key: adminUniqueKey,
      admin_authorized_device_id: adminAuthorizedDeviceId,
      admin_authorized_device_name: adminAuthorizedDeviceName,

      default_tax_rate: defaultTaxRate.toString(),
      invoice_prefix: invoicePrefix,
      auto_print: autoPrint.toString(),
      default_payment_mode: defaultPaymentMode,

      whatsapp_notif: whatsappNotif.toString(),
      email_alerts: emailAlerts.toString(),
      low_stock_threshold: lowStockThreshold.toString(),
      expiry_alert_days: expiryAlertDays.toString(),

      telegram_enabled: telegramEnabled.toString(),
      telegram_token: telegramToken,
      telegram_chat_id: telegramChatId,
      
      whatsapp_enabled: whatsappEnabled.toString(),

      wa_business_enabled: waBusinessEnabled.toString(),
      wa_business_phone_number_id: waBusinessPhoneNumberId,
      wa_business_access_token: waBusinessAccessToken,
      wa_business_waba_id: waBusinessWabaId,
      wa_business_webhook_verify_token: waBusinessWebhookVerifyToken,
      whatsapp_preferred_system: whatsappPreferredSystem,

      pharmarack_username: '',
      pharmarack_password: '',
      pharmarack_session_token: '',
      pharmarack_mode: 'Live'
    };

    try {
      await apiClient.post('/settings/save', payload);
      await apiClient.post('/pharmarack/logout');
      toastEvent.trigger('Logged out and cleared Pharmarack credentials successfully.', 'success');
    } catch (error) {
      console.error('Failed to logout from Pharmarack', error);
      toastEvent.trigger('Failed to logout from Pharmarack', 'error');
    }
  };

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

  // Backup handlers
  const fetchBackupList = async () => {
    setBackupListLoading(true);
    try {
      const { data } = await apiClient.get('/utilities/backup/list');
      setBackupList(data.backups || []);
    } catch {
      console.error('Failed to fetch backup list');
    } finally {
      setBackupListLoading(false);
    }
  };

  const fetchBackupSchedule = async () => {
    try {
      const { data } = await apiClient.get('/utilities/backup/schedule');
      setBackupFrequency(data.frequency || 'off');
    } catch {
      console.error('Failed to fetch backup schedule');
    }
  };

  useEffect(() => {
    fetchBackupList();
    fetchBackupSchedule();
  }, []);

  const handleBackupNow = async () => {
    setBackupLoading(true);
    try {
      await apiClient.post('/utilities/backup');
      toastEvent.trigger('Backup created successfully!', 'success');
      fetchBackupList();
    } catch {
      toastEvent.trigger('Failed to create backup', 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleScheduleChange = async (freq: string) => {
    setBackupFrequency(freq);
    try {
      await apiClient.post('/utilities/backup/schedule', { frequency: freq });
      toastEvent.trigger(`Backup schedule set to: ${freq === 'off' ? 'Off' : `Every ${freq}`}`, 'success');
    } catch {
      toastEvent.trigger('Failed to update backup schedule', 'error');
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    setDeletingFile(filename);
    try {
      await apiClient.delete(`/utilities/backup/${encodeURIComponent(filename)}`);
      toastEvent.trigger('Backup deleted', 'success');
      setConfirmDelete(null);
      fetchBackupList();
    } catch {
      toastEvent.trigger('Failed to delete backup', 'error');
    } finally {
      setDeletingFile(null);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    setRestoringFile(filename);
    try {
      await apiClient.post('/utilities/backup/restore', { filename });
      toastEvent.trigger(`Restored from: ${filename}`, 'success');
      setConfirmRestore(null);
    } catch {
      toastEvent.trigger('Failed to restore backup', 'error');
    } finally {
      setRestoringFile(null);
    }
  };

  const handleResetAdminDevice = async () => {
    try {
      await apiClient.post('/security/admin/reset-device');
      setAdminAuthorizedDeviceId('');
      setAdminAuthorizedDeviceName('');
      toastEvent.trigger('Admin authorized device registration reset successfully.', 'success');
    } catch (err: any) {
      console.error('Failed to reset admin device:', err);
      toastEvent.trigger('Failed to reset authorized device.', 'error');
    }
  };

  const handleResetData = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setResetConfirmText('');
      return;
    }
    if (resetConfirmText.trim().toUpperCase() !== 'RESET') {
      toastEvent.trigger('Please type RESET to confirm.', 'error');
      return;
    }
    setResetLoading(true);
    try {
      await apiClient.post('/utilities/reset-data', { wipeAll: true });
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (storageErr) {
        console.warn('Failed to clear browser storage:', storageErr);
      }
      toastEvent.trigger('App reset to factory state. Reloading...', 'success');
      setResetConfirm(false);
      setResetConfirmText('');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error('Reset error:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to reset data.', 'error');
      setResetConfirm(false);
      setResetConfirmText('');
    } finally {
      setResetLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  };

  const handleTestWaBusiness = async () => {
    setWaBusinessTesting(true);
    setWaBusinessTestResult(null);
    try {
      // Save credentials first so the test endpoint can read them
      await handleSaveSettings();
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

  return (
    <div className="h-full flex flex-col fade-in space-y-6 overflow-y-auto pb-8">

      {/* ─── Pharmacy Details ─── */}
      <div className="glass-panel p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <Building2 size={18} className="text-sky" />
          Pharmacy Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="space-y-2">
            <label htmlFor="pharmacyName" className="text-xs font-bold text-muted uppercase tracking-wider">
              Pharmacy Name
            </label>
            <input
              id="pharmacyName"
              type="text"
              className="premium-input w-full"
              placeholder="e.g. MedPlus Pharmacy"
              value={pharmacyName}
              onChange={(e) => setPharmacyName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="address" className="text-xs font-bold text-muted uppercase tracking-wider">
              Address
            </label>
            <input
              id="address"
              type="text"
              className="premium-input w-full"
              placeholder="Street, City, State"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="phone" className="text-xs font-bold text-muted uppercase tracking-wider">
              Phone
            </label>
            <input
              id="phone"
              type="text"
              className="premium-input w-full"
              placeholder="10-digit number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="gstin" className="text-xs font-bold text-muted uppercase tracking-wider">
              GSTIN
            </label>
            <input
              id="gstin"
              type="text"
              className="premium-input w-full"
              placeholder="22AAAAA0000A1Z5"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="drugLicense" className="text-xs font-bold text-muted uppercase tracking-wider">
              Drug License No.
            </label>
            <input
              id="drugLicense"
              type="text"
              className="premium-input w-full"
              placeholder="DL-0000-000000"
              value={drugLicense}
              onChange={(e) => setDrugLicense(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-bold text-muted uppercase tracking-wider">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="premium-input w-full"
              placeholder="pharmacy@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button 
            onClick={handleSaveSettings}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 flex items-center gap-2"
          >
            <Save size={16} />
            Save Details
          </button>
        </div>
      </div>



      {/* ─── Notifications ─── */}
      <div className="glass-panel p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <Bell size={18} className="text-primary" />
          Notifications
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div className="space-y-2 flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={whatsappNotif}
                  onChange={(e) => setWhatsappNotif(e.target.checked)}
                  aria-label="Enable WhatsApp Notifications"
                />
                <div className="w-11 h-6 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm font-semibold group-hover:text-white transition-colors">
                Enable WhatsApp Notifications
              </span>
            </label>
          </div>

          <div className="space-y-2 flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  aria-label="Enable Email Alerts"
                />
                <div className="w-11 h-6 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm font-semibold group-hover:text-white transition-colors">
                Enable Email Alerts
              </span>
            </label>
          </div>

          <div className="space-y-2 flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={desktopNotifEnabled}
                  onChange={handleToggleDesktopNotifications}
                  aria-label="Enable Desktop Notifications"
                />
                <div className="w-11 h-6 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm font-semibold group-hover:text-white transition-colors">
                Enable Desktop Popup Notifications
              </span>
            </label>
          </div>



          <div className="space-y-2">
            <label htmlFor="lowStockThreshold" className="text-xs font-bold text-muted uppercase tracking-wider">
              Low Stock Threshold
            </label>
            <input
              id="lowStockThreshold"
              type="number"
              min={0}
              className="premium-input w-full"
              placeholder="10"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="expiryAlertDays" className="text-xs font-bold text-muted uppercase tracking-wider">
              Expiry Alert Days
            </label>
            <input
              id="expiryAlertDays"
              type="number"
              min={0}
              className="premium-input w-full"
              placeholder="90"
              value={expiryAlertDays}
              onChange={(e) => setExpiryAlertDays(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="dineshWhatsappNumber" className="text-xs font-bold text-muted uppercase tracking-wider">
              Bounced Alerts WhatsApp Number (Dinesh)
            </label>
            <input
              id="dineshWhatsappNumber"
              type="text"
              className="premium-input w-full bg-bg border border-border"
              placeholder="e.g. 9876543210 or 919876543210"
              value={dineshWhatsappNumber}
              onChange={(e) => setDineshWhatsappNumber(e.target.value)}
            />
            <p className="text-[10px] text-muted">Daily morning notification (at 9:00 AM) summarizing missing bills or bounced medicines will be sent to this number.</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button 
            onClick={handleSaveSettings}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 flex items-center gap-2"
          >
            <Save size={16} />
            Save Preferences
          </button>
        </div>
      </div>

      {/* ─── Admin Remote Operations Mode ─── */}
      <div className="glass-panel p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <Shield size={18} className="text-amber-500" />
          Admin Remote Operations Mode
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div className="space-y-2 flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={adminRemoteMode}
                  onChange={(e) => setAdminRemoteMode(e.target.checked)}
                  aria-label="Enable Admin Remote Operations Mode"
                />
                <div className="w-11 h-6 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm font-semibold group-hover:text-white transition-colors">
                Enable Admin Remote Operations Mode
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="adminUniqueKey" className="text-xs font-bold text-muted uppercase tracking-wider">
              Secure Admin Key (Mobile Scanner / Setup)
            </label>
            <input
              id="adminUniqueKey"
              type="text"
              readOnly
              className="premium-input w-full bg-zinc-800/40 text-muted font-mono cursor-not-allowed"
              value={adminUniqueKey}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="adminUsername" className="text-xs font-bold text-muted uppercase tracking-wider">
              Admin Remote Username
            </label>
            <input
              id="adminUsername"
              type="text"
              className="premium-input w-full"
              placeholder="admin"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="adminPassword" className="text-xs font-bold text-muted uppercase tracking-wider">
              Admin Remote Password
            </label>
            <input
              id="adminPassword"
              type="password"
              className="premium-input w-full"
              placeholder="••••••••"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>

          <div className="space-y-2 md:col-span-2 border border-glass-border/40 p-4 rounded-lg bg-zinc-900/20">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block">
                Registered Mobile Device
              </label>
            </div>
            {adminAuthorizedDeviceId ? (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold block text-zinc-100">
                    {adminAuthorizedDeviceName}
                  </span>
                  <span className="text-xs text-muted font-mono block mt-1">
                    ID: {adminAuthorizedDeviceId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetAdminDevice}
                  className="premium-btn bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  Reset Authorization
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold block text-zinc-100">
                    No device registered yet.
                  </span>
                  <span className="text-xs text-muted">
                    Scan connection QR code to establish link.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConnectModal(true)}
                  className="premium-btn bg-primary text-white text-xs px-4 py-2 flex items-center gap-2"
                >
                  <QrCode size={14} />
                  One-Click QR Connect
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button 
            onClick={handleSaveSettings}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 flex items-center gap-2"
          >
            <Save size={16} />
            Save Admin Settings
          </button>
        </div>
      </div>





      {/* ─── Background Automations ─── */}
      <div className="glass-panel p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <Zap size={18} className="text-amber" />
          Background Automations
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div className="space-y-2 flex items-end">
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={automationEnabled}
                  onChange={(e) => setAutomationEnabled(e.target.checked)}
                  aria-label="Enable Background Automations"
                />
                <div className="w-11 h-6 rounded-full bg-zinc-700 peer-checked:bg-green transition-colors" />
                <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm font-semibold group-hover:text-white transition-colors">
                Enable Background Automations
              </span>
            </label>
          </div>
        </div>

        <p className="text-xs text-muted mt-4 max-w-3xl leading-relaxed">
          Enabling this starts background services at startup including: WhatsApp client pre-initialization, the WhatsApp queue worker, the catalog upload process, daily checks for patient refills, and automatic near-expiry scans.
          <br />
          <span className="text-amber/85 font-semibold italic">Note: Changing this setting requires a server restart to take effect.</span>
        </p>

        <div className="mt-6 flex justify-end">
          <button 
            onClick={handleSaveSettings}
            className="premium-btn bg-green text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)] hover:bg-emerald-600 flex items-center gap-2"
          >
            <Save size={16} />
            Save Automations
          </button>
        </div>
      </div>

      {/* ─── Backup & Restore ─── */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-bold flex items-center gap-2">
            <Shield size={18} className="text-primary" />
            Backup & Restore
          </h3>
          <button
            onClick={() => {
              if (typeof (window as any).openBackupCenter === 'function') {
                (window as any).openBackupCenter();
              }
            }}
            className="premium-btn bg-primary text-white hover:bg-blue-600 flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase"
          >
            <SettingsIcon size={14} /> Open Backup Center
          </button>
        </div>

        {/* Top controls row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Backup Now */}
          <button
            id="backup-now-btn"
            onClick={handleBackupNow}
            disabled={backupLoading}
            className="premium-btn bg-primary text-white shadow-[0_4px_14px_rgba(59,130,246,0.4)] hover:bg-blue-600 flex items-center justify-center gap-2 w-full py-3 disabled:opacity-50"
          >
            {backupLoading ? (
              <><RefreshCw size={16} className="animate-spin" /> Creating Backup...</>
            ) : (
              <><Database size={16} /> Backup Now</>
            )}
          </button>

          {/* Auto-Backup Frequency */}
          <div className="space-y-1.5">
            <label htmlFor="backupFrequency" className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={12} /> Auto-Backup Frequency
            </label>
            <select
              id="backupFrequency"
              className="premium-input w-full"
              value={backupFrequency}
              onChange={(e) => handleScheduleChange(e.target.value)}
            >
              <option value="off">Off</option>
              <option value="3h">Every 3 Hours</option>
              <option value="6h">Every 6 Hours</option>
            </select>
          </div>

          {/* Restore latest */}
          <div className="space-y-1.5">
            <label htmlFor="dbRestore" className="text-xs font-bold text-muted uppercase tracking-wider">
              Restore from File
            </label>
            <div className="flex gap-2">
              <input
                id="dbRestore"
                type="file"
                className="premium-input w-full text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-700 file:text-zinc-300 hover:file:bg-zinc-600 file:cursor-pointer"
                accept=".db,.sqlite"
                aria-label="Choose database backup file"
              />
            </div>
          </div>
        </div>

        {/* Status badges row */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-green/10 text-green border border-green/20">
            <Clock size={12} /> Nightly Backup: 9:30 PM
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-sky/10 text-sky border border-sky/20">
            <Download size={12} /> Shutdown Backup: Active
          </div>
          {backupFrequency !== 'off' && (
            <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber/10 text-amber border border-amber/20">
              <RefreshCw size={12} /> Scheduled: Every {backupFrequency}
            </div>
          )}
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            <HardDrive size={12} /> Max 20 Backups (Auto-cleanup)
          </div>
        </div>

        {/* Backup History Table */}
        <div className="border border-glass-border/40 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-bg2/50 border-b border-glass-border/30">
            <h4 className="font-bold text-sm flex items-center gap-2">
              <History size={14} className="text-sky" /> Backup History
              <span className="text-xs text-muted font-normal">({backupList.length} backups)</span>
            </h4>
            <button
              onClick={fetchBackupList}
              disabled={backupListLoading}
              className="text-xs font-bold text-sky hover:text-sky/80 flex items-center gap-1 transition-colors"
            >
              <RefreshCw size={12} className={backupListLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {backupListLoading && backupList.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">
              <RefreshCw size={20} className="animate-spin mx-auto mb-2 opacity-50" />
              Loading backups...
            </div>
          ) : backupList.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">
              <Database size={24} className="mx-auto mb-2 opacity-30" />
              No backups found. Click "Backup Now" to create your first backup.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg2/90 backdrop-blur-sm">
                  <tr className="text-xs text-muted uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5 font-bold">Filename</th>
                    <th className="text-right px-4 py-2.5 font-bold">Size</th>
                    <th className="text-right px-4 py-2.5 font-bold">Date & Time</th>
                    <th className="text-right px-4 py-2.5 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backupList.map((b, i) => (
                    <tr key={b.filename} className={`border-t border-glass-border/20 hover:bg-bg3/30 transition-colors ${i === 0 ? 'bg-green/5' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[260px]" title={b.filename}>
                        {i === 0 && <span className="inline-block mr-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-green/20 text-green rounded">LATEST</span>}
                        {b.filename}
                      </td>
                      <td className="px-4 py-3 text-right text-muted whitespace-nowrap">{formatFileSize(b.sizeBytes)}</td>
                      <td className="px-4 py-3 text-right text-muted whitespace-nowrap">{formatDate(b.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Restore */}
                          {confirmRestore === b.filename ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-amber font-bold mr-1">Confirm?</span>
                              <button
                                onClick={() => handleRestoreBackup(b.filename)}
                                disabled={restoringFile === b.filename}
                                className="text-[10px] font-bold bg-amber/20 text-amber px-2 py-1 rounded hover:bg-amber/30 transition-all disabled:opacity-50"
                              >
                                {restoringFile === b.filename ? 'Restoring...' : 'Yes'}
                              </button>
                              <button
                                onClick={() => setConfirmRestore(null)}
                                className="text-[10px] font-bold bg-bg3/50 text-muted px-2 py-1 rounded hover:bg-bg3 transition-all"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRestore(b.filename)}
                              className="text-[10px] font-bold bg-sky/15 text-sky px-2.5 py-1 rounded-full hover:bg-sky/25 transition-all flex items-center gap-1"
                              title="Restore this backup"
                            >
                              <RotateCcw size={10} /> Restore
                            </button>
                          )}

                          {/* Delete */}
                          {confirmDelete === b.filename ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-red font-bold mr-1">Delete?</span>
                              <button
                                onClick={() => handleDeleteBackup(b.filename)}
                                disabled={deletingFile === b.filename}
                                className="text-[10px] font-bold bg-red/20 text-red px-2 py-1 rounded hover:bg-red/30 transition-all disabled:opacity-50"
                              >
                                {deletingFile === b.filename ? 'Deleting...' : 'Yes'}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="text-[10px] font-bold bg-bg3/50 text-muted px-2 py-1 rounded hover:bg-bg3 transition-all"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(b.filename)}
                              className="text-[10px] font-bold bg-red/10 text-red/70 px-2.5 py-1 rounded-full hover:bg-red/20 hover:text-red transition-all flex items-center gap-1"
                              title="Delete this backup"
                            >
                              <Trash2 size={10} /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted mt-4 leading-relaxed">
          <AlertTriangle size={11} className="inline mr-1 text-amber" />
          <strong>Restoring</strong> a backup will replace your current database. A backup of the current state is recommended before restoring.
          Backups older than the 20 most recent are automatically removed.
        </p>
      </div>

      {/* ─── System ─── */}
      <div className="glass-panel p-6">
        <h3 className="font-bold flex items-center gap-2 mb-6">
          <HardDrive size={18} className="text-green" />
          System
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <button className="premium-btn bg-red text-white shadow-[0_4px_14px_rgba(239,68,68,0.4)] hover:bg-red-600 flex items-center gap-2 w-full justify-center">
            <Trash2 size={16} />
            Clear Cache
          </button>

          <button
            onClick={() => { setResetConfirm(true); setResetConfirmText(''); }}
            className="premium-btn bg-amber-600 text-white shadow-[0_4px_14px_rgba(245,158,11,0.4)] hover:bg-amber-700 flex items-center gap-2 w-full justify-center"
          >
            <Trash2 size={16} />
            Reset All Stored Data
          </button>

          <div className="glass-panel p-4 flex items-center justify-between bg-bg3/30 border border-glass-border">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">App Version</span>
            <span className="text-sm font-semibold text-sky">v2.0.0</span>
          </div>
        </div>
      </div>

      {/* ─── Factory Reset Confirmation Modal ─── */}
      {resetConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
          <div className="glass-panel w-full max-w-md p-8 flex flex-col gap-6 border border-red-500/40 shadow-[0_0_60px_rgba(239,68,68,0.3)]">
            {/* Icon + Title */}
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <AlertTriangle size={32} className="text-red-400" />
              </div>
              <h2 className="text-xl font-black text-text tracking-tight">Factory Reset</h2>
              <p className="text-sm text-muted leading-relaxed">
                This will <strong className="text-red-400">permanently delete</strong> all inventory, bills, purchases, customers,
                settings, and every other record. The app will restart as if newly installed.
              </p>
              <p className="text-xs text-red-400/80 font-semibold uppercase tracking-wider">
                This action cannot be undone.
              </p>
            </div>

            {/* Typed confirmation */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider">
                Type <span className="text-red-400 font-black">RESET</span> to confirm
              </label>
              <input
                id="resetConfirmInput"
                type="text"
                className="premium-input w-full text-center font-mono font-bold tracking-widest"
                placeholder="RESET"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleResetData(); }}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => { setResetConfirm(false); setResetConfirmText(''); }}
                disabled={resetLoading}
                className="premium-btn bg-bg3/60 text-muted hover:text-text hover:bg-bg3 flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleResetData}
                disabled={resetLoading || resetConfirmText.trim().toUpperCase() !== 'RESET'}
                className="premium-btn flex-1 flex items-center justify-center gap-2 text-white transition-all"
                style={{
                  background: resetConfirmText.trim().toUpperCase() === 'RESET' ? 'rgb(185,28,28)' : 'rgba(120,20,20,0.4)',
                  cursor: resetConfirmText.trim().toUpperCase() === 'RESET' ? 'pointer' : 'not-allowed',
                  opacity: resetConfirmText.trim().toUpperCase() === 'RESET' ? 1 : 0.5,
                }}
              >
                {resetLoading ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {resetLoading ? 'Resetting...' : 'Erase Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConnectModal && <MobileConnectionModal onClose={() => setShowConnectModal(false)} />}
    </div>
  );
};

export default Settings;
