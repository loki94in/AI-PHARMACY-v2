import * as SecureStore from '../secureStore';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const SERVER_KEY = 'pharmacy_server_url';

let cachedBaseUrl: string | null = null;

/**
 * Stable per-phone identity used for multi-device tracking and bill attribution.
 * uuid persists in SecureStore; name falls back like the root layout does.
 */
export async function getDeviceIdentity(): Promise<{ uuid: string; name: string }> {
  let uuid = await SecureStore.getItemAsync('admin_device_uuid');
  if (!uuid) {
    uuid = 'DEV-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await SecureStore.setItemAsync('admin_device_uuid', uuid);
  }
  const name =
    ((Constants as any).deviceName as string) ||
    (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android Device' : 'Device');
  return { uuid, name };
}

// ─── Server URL Management ──────────────────────────────────────────────────

export async function getServerUrl(): Promise<string | null> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const url = await SecureStore.getItemAsync(SERVER_KEY);
  if (url) cachedBaseUrl = url;
  return url;
}

export async function setServerUrl(url: string): Promise<void> {
  // Normalize: remove trailing slash
  const clean = url.replace(/\/+$/, '');
  await SecureStore.setItemAsync(SERVER_KEY, clean);
  cachedBaseUrl = clean;
}

export async function clearServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(SERVER_KEY);
  cachedBaseUrl = null;
}

// ─── Generic Fetch Wrapper ──────────────────────────────────────────────────

export async function request<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const base = await getServerUrl();
  if (!base) throw new Error('Server URL not configured');

  // Ensure device UUID is created
  let deviceUuid = await SecureStore.getItemAsync('admin_device_uuid');
  if (!deviceUuid) {
    deviceUuid = 'DEV-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await SecureStore.setItemAsync('admin_device_uuid', deviceUuid);
  }

  const sessionToken = await SecureStore.getItemAsync('admin_session_token');

  const url = `${base}/api${endpoint}`;
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
      ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
      'x-device-id': deviceUuid,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

// ─── Connection Test ────────────────────────────────────────────────────────

export async function testConnectionWithTimeout(serverUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

export async function scanSubnetForServer(subnet: string): Promise<string | null> {
  const port = 3000;
  const batchSize = 25;

  for (let i = 1; i <= 255; i += batchSize) {
    const promises: Promise<string | null>[] = [];
    for (let j = i; j < i + batchSize && j <= 255; j++) {
      const url = `http://${subnet}.${j}:${port}`;
      promises.push(
        (async () => {
          const ok = await testConnectionWithTimeout(url, 800);
          return ok ? url : null;
        })()
      );
    }
    const results = await Promise.all(promises);
    const found = results.find(r => r !== null);
    if (found) return found;
  }
  return null;
}

export async function autoDiscoverServer(): Promise<string | null> {
  // 1. Try cached server URL first
  const cached = await SecureStore.getItemAsync(SERVER_KEY);
  if (cached) {
    const ok = await testConnection(cached);
    if (ok) {
      cachedBaseUrl = cached;
      return cached;
    }
  }

  // 2. Try Expo host URI if in development
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const parts = hostUri.split(':');
    const devIp = parts[0];
    if (devIp) {
      const devServerUrl = `http://${devIp}:3000`;
      const ok = await testConnection(devServerUrl);
      if (ok) {
        await setServerUrl(devServerUrl);
        return devServerUrl;
      }

      // Try scanning the developer's subnet
      const subnetParts = devIp.split('.');
      if (subnetParts.length === 4) {
        const subnet = `${subnetParts[0]}.${subnetParts[1]}.${subnetParts[2]}`;
        const found = await scanSubnetForServer(subnet);
        if (found) {
          await setServerUrl(found);
          return found;
        }
      }
    }
  }

  // 3. Try scanning common subnet IP ranges as fallback
  const commonSubnets = ['192.168.1', '192.168.0', '192.168.29', '192.168.31', '10.0.0'];
  for (const subnet of commonSubnets) {
    const found = await scanSubnetForServer(subnet);
    if (found) {
      await setServerUrl(found);
      return found;
    }
  }

  return null;
}

export async function testConnection(serverUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 seconds timeout (local WiFi can be slow)

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}
