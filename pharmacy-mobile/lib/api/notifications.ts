import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';
import { sendEmailViaGmailApiDirect, syncGoogleAuthFromPc } from './gmail';

const MOBILE_AUTOMATION_KEY = 'mobile_automation_tasks';

// ─── Push Notifications Token Registration ──────────────────────────────────

export async function registerPushToken(
  token: string,
  deviceName: string,
  os: string,
  deviceUuid?: string | null
): Promise<any> {
  return request('/notifications/register-token', {
    method: 'POST',
    body: JSON.stringify({ token, deviceName, os, device_uuid: deviceUuid || null }),
  });
}

// ─── Notification Storage & Management Helpers ──────────────────────────────

export interface SavedNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
}

export async function getSavedNotifications(): Promise<SavedNotification[]> {
  try {
    const data = await AsyncStorage.getItem('saved_notifications');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveNotification(title: string, body: string): Promise<SavedNotification[]> {
  try {
    const list = await getSavedNotifications();
    const newNotif: SavedNotification = {
      id: Date.now().toString(),
      title,
      body,
      timestamp: new Date().toISOString(),
      read: false,
    };
    list.unshift(newNotif); // latest first
    const trimmed = list.slice(0, 50); // limit to 50 alerts
    await AsyncStorage.setItem('saved_notifications', JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return [];
  }
}

export async function markAllNotificationsAsRead(): Promise<void> {
  try {
    const list = await getSavedNotifications();
    const updated = list.map(item => ({ ...item, read: true }));
    await AsyncStorage.setItem('saved_notifications', JSON.stringify(updated));
  } catch {}
}

export async function clearAllNotifications(): Promise<void> {
  try {
    await AsyncStorage.removeItem('saved_notifications');
  } catch {}
}

// ─── Mobile Automation Tasks (WhatsApp/Email fallback senders) ─────────────

export interface MobileAutomationTask {
  id: string;
  type: 'email' | 'whatsapp';
  recipient: string;
  subject?: string;
  message: string;
  status: 'pending' | 'sent' | 'failed' | 'sent_manually';
  error?: string;
  created_at: string;
  invoice_no?: string;
}

export async function getMobileAutomationTasks(): Promise<MobileAutomationTask[]> {
  try {
    const data = await AsyncStorage.getItem(MOBILE_AUTOMATION_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveMobileAutomationTask(task: Omit<MobileAutomationTask, 'id' | 'created_at'>): Promise<MobileAutomationTask> {
  const tasks = await getMobileAutomationTasks();
  const newTask: MobileAutomationTask = {
    ...task,
    id: 'TASK-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
    created_at: new Date().toISOString()
  };
  tasks.unshift(newTask);
  await AsyncStorage.setItem(MOBILE_AUTOMATION_KEY, JSON.stringify(tasks.slice(0, 50)));
  return newTask;
}

export async function updateMobileAutomationTaskStatus(id: string, status: MobileAutomationTask['status'], error?: string): Promise<void> {
  const tasks = await getMobileAutomationTasks();
  const updated = tasks.map(t => t.id === id ? { ...t, status, error: error || undefined } : t);
  await AsyncStorage.setItem(MOBILE_AUTOMATION_KEY, JSON.stringify(updated));
}

export async function retryMobileFallbackTask(taskId: string): Promise<boolean> {
  const tasks = await getMobileAutomationTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  await updateMobileAutomationTaskStatus(taskId, 'pending');

  if (task.type === 'email') {
    const ok = await sendEmailViaGmailApiDirect(task.recipient, task.subject || 'Pharmacy Invoice', task.message);
    if (ok) {
      await updateMobileAutomationTaskStatus(taskId, 'sent');
      return true;
    } else {
      await updateMobileAutomationTaskStatus(taskId, 'failed', 'Gmail direct send failed');
      return false;
    }
  } else {
    // WhatsApp Fallback
    try {
      const auth = await syncGoogleAuthFromPc();
      if (auth && (auth as any).wa_business_enabled === 'true' && (auth as any).wa_business_access_token) {
        const phoneNumberId = (auth as any).wa_business_phone_number_id;
        const token = (auth as any).wa_business_access_token;
        const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: task.recipient,
            type: 'text',
            text: { body: task.message }
          })
        });
        if (res.ok) {
          await updateMobileAutomationTaskStatus(taskId, 'sent');
          return true;
        }
      }
    } catch {}

    // Deep link redirect WhatsApp App fallback
    try {
      const cleanPhone = task.recipient.replace(/[^0-9]/g, '');
      const url = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(task.message)}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        await updateMobileAutomationTaskStatus(taskId, 'sent_manually');
        return true;
      }
    } catch {}

    await updateMobileAutomationTaskStatus(taskId, 'failed', 'Could not open WhatsApp on device');
    return false;
  }
}

// ─── Server Automation Notifications ────────────────────────────────────────

export async function getServerAutomationNotifications(): Promise<any[]> {
  try {
    return await request<any[]>('/automation/notifications');
  } catch (err) {
    console.warn('Failed to fetch server automation logs:', err);
    return [];
  }
}

export async function retryServerNotification(id: number | string): Promise<boolean> {
  try {
    const res = await request<{ success: boolean }>(`/automation/notifications/${id}/retry`, {
      method: 'POST'
    });
    return res.success;
  } catch (err) {
    console.warn('Server notification retry failed:', err);
    return false;
  }
}

export async function markServerNotificationManual(id: number | string): Promise<boolean> {
  try {
    const res = await request<{ success: boolean }>(`/automation/notifications/${id}/manual`, {
      method: 'POST'
    });
    return res.success;
  } catch (err) {
    console.warn('Server notification manual mark failed:', err);
    return false;
  }
}

// ─── Server Email Mirror ────────────────────────────────────────────────────

export async function getEmailsFromServer(limit = 50): Promise<any[]> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return await request<any[]>(`/email/inbox?limit=${limit}&since=${encodeURIComponent(since)}`);
  } catch (err) {
    console.warn('Failed to fetch emails from PC server:', err);
    throw err;
  }
}

export async function getAttachmentPreviewFromServer(filename: string): Promise<any> {
  try {
    return await request<any>(`/email/attachments/preview?filename=${encodeURIComponent(filename)}`);
  } catch (err) {
    console.warn('Failed to get attachment preview from PC server:', err);
    throw err;
  }
}

// ─── Multi-Device Registry ──────────────────────────────────────────────────

export interface RegisteredDevice {
  token: string;
  device_id?: string;
  device_name: string;
  os: string;
  created_at?: string;
  last_seen?: string;
  is_online?: number;
  offline_seconds?: number;
  is_blocked?: number;
}

export async function getRegisteredDevices(): Promise<RegisteredDevice[]> {
  try {
    const res = await request<any>('/notifications/devices');
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.devices)) return res.devices;
    return [];
  } catch (err) {
    console.warn('Failed to fetch registered devices:', err);
    throw err;
  }
}

export function renameDevice(token: string, name: string) {
  return request<{ success: boolean }>(`/notifications/devices/${encodeURIComponent(token)}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** Block = phone refused at registration (403) until unblocked. */
export function setDeviceBlocked(token: string, blocked: boolean) {
  return request<{ success: boolean }>(`/notifications/devices/${encodeURIComponent(token)}/block`, {
    method: 'PUT',
    body: JSON.stringify({ blocked }),
  });
}

export interface DeviceLogRow {
  id: number;
  token: string;
  device_name: string;
  os: string;
  status: string;
  timestamp: string;
}

export async function getDeviceLogs(): Promise<DeviceLogRow[]> {
  try {
    const res = await request<any>('/notifications/devices/logs');
    return Array.isArray(res?.logs) ? res.logs : [];
  } catch (err) {
    console.warn('Failed to fetch device logs:', err);
    throw err;
  }
}

export async function clearDeviceLogs(): Promise<void> {
  await request('/notifications/devices/logs/clear', { method: 'POST' });
}

// ─── Assistant Chat Logging ─────────────────────────────────────────────────

export async function logAssistantChat(payload: {
  sessionId: string;
  deviceName: string;
  sender: 'user' | 'assistant';
  messageText: string;
  metadata?: any;
}): Promise<any> {
  try {
    return await request('/notifications/chat-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('Failed to log assistant chat session:', err);
    return { success: false, offline: true };
  }
}
