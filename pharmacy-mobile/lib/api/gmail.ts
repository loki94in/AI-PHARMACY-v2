import * as SecureStore from '../secureStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

// ─── Google OAuth Token Sync & Gmail REST Direct Fetching ──────────────────

export interface GoogleAuthSettings {
  gmail_user: string;
  gmail_oauth_access_token: string;
  gmail_oauth_refresh_token: string;
  google_client_id: string;
  google_client_secret: string;
  gmail_oauth_token_expiry: string;
}

export async function syncGoogleAuthFromPc(): Promise<GoogleAuthSettings | null> {
  try {
    const settings = await request<Record<string, string>>('/settings');
    const auth = {
      gmail_user: settings['gmail_user'] || '',
      gmail_oauth_access_token: settings['gmail_oauth_access_token'] || '',
      gmail_oauth_refresh_token: settings['gmail_oauth_refresh_token'] || '',
      google_client_id: settings['google_client_id'] || '',
      google_client_secret: settings['google_client_secret'] || '',
      gmail_oauth_token_expiry: settings['gmail_oauth_token_expiry'] || '',
    };
    await SecureStore.setItemAsync('gmail_user', auth.gmail_user);
    await SecureStore.setItemAsync('gmail_oauth_access_token', auth.gmail_oauth_access_token);
    await SecureStore.setItemAsync('gmail_oauth_refresh_token', auth.gmail_oauth_refresh_token);
    await SecureStore.setItemAsync('google_client_id', auth.google_client_id);
    await SecureStore.setItemAsync('google_client_secret', auth.google_client_secret);
    await SecureStore.setItemAsync('gmail_oauth_token_expiry', auth.gmail_oauth_token_expiry);
    return auth;
  } catch (e) {
    console.warn('Failed to sync Google OAuth tokens from PC:', e);
    return {
      gmail_user: (await SecureStore.getItemAsync('gmail_user')) || '',
      gmail_oauth_access_token: (await SecureStore.getItemAsync('gmail_oauth_access_token')) || '',
      gmail_oauth_refresh_token: (await SecureStore.getItemAsync('gmail_oauth_refresh_token')) || '',
      google_client_id: (await SecureStore.getItemAsync('google_client_id')) || '',
      google_client_secret: (await SecureStore.getItemAsync('google_client_secret')) || '',
      gmail_oauth_token_expiry: (await SecureStore.getItemAsync('gmail_oauth_token_expiry')) || '',
    };
  }
}

export async function getValidGmailAccessToken(auth: GoogleAuthSettings): Promise<string | null> {
  const expiry = auth.gmail_oauth_token_expiry ? parseInt(auth.gmail_oauth_token_expiry, 10) : 0;
  if (Date.now() + 60000 >= expiry && auth.gmail_oauth_refresh_token && auth.google_client_id && auth.google_client_secret) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: auth.google_client_id,
          client_secret: auth.google_client_secret,
          refresh_token: auth.gmail_oauth_refresh_token,
          grant_type: 'refresh_token',
        }).toString(),
      });
      const data = await response.json() as any;
      if (data.access_token) {
        const newExpiry = Date.now() + (data.expires_in * 1000);
        await SecureStore.setItemAsync('gmail_oauth_access_token', data.access_token);
        await SecureStore.setItemAsync('gmail_oauth_token_expiry', newExpiry.toString());
        return data.access_token;
      }
    } catch (err) {
      console.warn('Failed to refresh Google token on mobile:', err);
    }
  }
  return auth.gmail_oauth_access_token;
}

export interface GmailMessagePreview {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

// ponytail: one-liner helper for 7-day cutoff
const ONE_WEEK_AGO = () => Date.now() - 7 * 24 * 60 * 60 * 1000;
const filterLastWeek = <T extends { date: string }>(list: T[]): T[] =>
  list.filter(e => new Date(e.date).getTime() >= ONE_WEEK_AGO());

export async function fetchGmailEmailsDirect(): Promise<GmailMessagePreview[]> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=has:attachment`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!listRes.ok) {
    throw new Error(`Gmail API List failed: ${listRes.statusText}`);
  }

  const listData = await listRes.json() as any;
  const messages = listData.messages || [];

  const previews: GmailMessagePreview[] = [];

  for (const msg of messages) {
    try {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!detailRes.ok) continue;
      const detail = await detailRes.json() as any;

      const subjectHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'subject');
      const fromHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'from');
      const dateHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'date');

      previews.push({
        id: detail.id,
        threadId: detail.threadId,
        subject: subjectHeader ? subjectHeader.value : '(No Subject)',
        from: fromHeader ? fromHeader.value : 'Unknown',
        date: dateHeader ? dateHeader.value : new Date().toISOString(),
        snippet: detail.snippet || ''
      });
    } catch (e) {
      console.warn(`Failed to fetch email detail for ${msg.id}:`, e);
    }
  }

  // Only cache emails from the last 7 days
  const recent = filterLastWeek(previews);
  await AsyncStorage.setItem('cached_mobile_emails', JSON.stringify(recent));
  return recent;
}

export async function getCachedEmails(): Promise<GmailMessagePreview[]> {
  try {
    const data = await AsyncStorage.getItem('cached_mobile_emails');
    const all: GmailMessagePreview[] = data ? JSON.parse(data) : [];
    // Strip anything older than 7 days from cache
    return filterLastWeek(all);
  } catch {
    return [];
  }
}

export async function fetchGmailMessageDetail(messageId: string): Promise<any> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) {
    throw new Error(`Gmail API message fetch failed: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchGmailAttachment(messageId: string, attachmentId: string): Promise<string> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) {
    throw new Error(`Gmail API attachment fetch failed: ${res.statusText}`);
  }
  const data = await res.json() as any;
  return data.data; // Base64 encoded attachment content
}

export async function sendEmailViaGmailApiDirect(to: string, subject: string, body: string): Promise<boolean> {
  try {
    const auth = await syncGoogleAuthFromPc();
    if (!auth || !auth.gmail_oauth_access_token) {
      throw new Error('Google Gmail OAuth credentials not synced');
    }

    const token = await getValidGmailAccessToken(auth);
    if (!token) throw new Error('Failed to acquire valid Google access token');

    const mimeMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body
    ].join('\r\n');

    // Safe custom base64 encoder
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let rawEncoded = '';
    let i = 0;
    const bytes = [];
    for (let j = 0; j < mimeMessage.length; j++) {
      let c = mimeMessage.charCodeAt(j);
      if (c < 128) { bytes.push(c); }
      else if (c < 2048) {
        bytes.push((c >> 6) | 192);
        bytes.push((c & 63) | 128);
      } else {
        bytes.push((c >> 12) | 224);
        bytes.push(((c >> 6) & 63) | 128);
        bytes.push((c & 63) | 128);
      }
    }

    while (i < bytes.length) {
      const b1 = bytes[i++];
      const b2 = i < bytes.length ? bytes[i++] : NaN;
      const b3 = i < bytes.length ? bytes[i++] : NaN;

      const enc1 = b1 >> 2;
      const enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
      const enc3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
      const enc4 = isNaN(b3) ? 64 : b3 & 63;

      rawEncoded += chars.charAt(enc1) + chars.charAt(enc2) +
        (enc3 === 64 ? '' : chars.charAt(enc3)) +
        (enc4 === 64 ? '' : chars.charAt(enc4));
    }
    const base64Encoded = rawEncoded.replace(/\+/g, '-').replace(/\//g, '_');

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: base64Encoded })
      }
    );

    return response.ok;
  } catch (err) {
    console.error('Direct Gmail send failed:', err);
    return false;
  }
}

export async function disconnectGoogleAuthServer(): Promise<{ success: boolean; message: string }> {
  try {
    return await request('/settings/google/disconnect', {
      method: 'POST',
    });
  } catch (err) {
    console.warn('Failed to disconnect Google account from server:', err);
    throw err;
  }
}
