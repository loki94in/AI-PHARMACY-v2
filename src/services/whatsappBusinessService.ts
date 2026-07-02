// WhatsApp Business Cloud API Service
// Uses Node.js native fetch (available in Node 18+) — no extra packages needed.
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

interface WaBusinessConfig {
  enabled: boolean;
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  webhookVerifyToken: string;
}

interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class WhatsAppBusinessService {
  /**
   * Load WhatsApp Business API config from app_settings table.
   */
  async getConfig(): Promise<WaBusinessConfig> {
    const db = await dbManager.getConnection();
    try {
      const rows = await db.all(
        `SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?, ?)`,
        [
          'wa_business_enabled',
          'wa_business_phone_number_id',
          'wa_business_access_token',
          'wa_business_waba_id',
          'wa_business_webhook_verify_token',
        ]
      );
      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.key] = row.value;
      }
      return {
        enabled: map['wa_business_enabled'] === 'true',
        phoneNumberId: map['wa_business_phone_number_id'] || '',
        accessToken: map['wa_business_access_token'] || '',
        wabaId: map['wa_business_waba_id'] || '',
        webhookVerifyToken: map['wa_business_webhook_verify_token'] || '',
      };
    } finally {
          }
  }

  /**
   * Verify that the stored access token and phone number ID are valid
   * by calling the Graph API.
   */
  async testConnection(): Promise<{ success: boolean; phone?: string; name?: string; error?: string }> {
    const config = await this.getConfig();
    if (!config.phoneNumberId || !config.accessToken) {
      return { success: false, error: 'Phone Number ID and Access Token are required.' };
    }

    try {
      const url = `${GRAPH_API_BASE}/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return { success: false, error: (errBody as any)?.error?.message || `HTTP ${res.status}` };
      }
      const data = await res.json() as any;
      return {
        success: true,
        phone: data.display_phone_number,
        name: data.verified_name,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown error' };
    }
  }

  /**
   * Send a plain text message to a WhatsApp number.
   * @param to  Recipient phone number in international format (e.g. "919876543210")
   * @param text Message body
   */
  /**
   * Split a comma/semicolon/space separated string of numbers into individual sanitized phone numbers
   */
  private parseRecipients(to: string): string[] {
    return String(to)
      .split(/[,;\s]+/)
      .map(r => this.sanitizePhone(r))
      .filter(r => r.length > 0);
  }

  /**
   * Send a plain text message to a WhatsApp number.
   * @param to  Recipient phone number in international format (e.g. "919876543210")
   * @param text Message body
   */
  async sendTextMessage(to: string, text: string): Promise<SendMessageResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return { success: false, error: 'WhatsApp Business API is not enabled.' };
    }
    if (!config.phoneNumberId || !config.accessToken) {
      return { success: false, error: 'Missing credentials. Configure in Settings.' };
    }

    const recipients = this.parseRecipients(to);
    let lastResult: SendMessageResult = { success: false, error: 'No recipients specified.' };

    for (const cleanPhone of recipients) {
      try {
        const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'text',
            text: { preview_url: false, body: text },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = (errBody as any)?.error?.message || `HTTP ${res.status}`;
          console.error('[WA Business] Send text failed:', msg);
          lastResult = { success: false, error: msg };
        } else {
          const data = await res.json() as any;
          const messageId = data?.messages?.[0]?.id;
          lastResult = { success: true, messageId };
        }
      } catch (err: any) {
        console.error('[WA Business] Send text failed:', err.message);
        lastResult = { success: false, error: err.message || 'Unknown error' };
      }
    }
    return lastResult;
  }

  /**
   * Send a document (e.g. PDF invoice) to a WhatsApp number.
   * Uploads the file first via multipart form-data, then sends a document message.
   * @param to  Recipient phone number
   * @param filePath Absolute path to the document
   * @param caption Optional caption text
   * @param filename Display filename (e.g. "Invoice_123.pdf")
   */
  async sendDocument(
    to: string,
    filePath: string,
    caption?: string,
    filename?: string
  ): Promise<SendMessageResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return { success: false, error: 'WhatsApp Business API is not enabled.' };
    }
    if (!config.phoneNumberId || !config.accessToken) {
      return { success: false, error: 'Missing credentials. Configure in Settings.' };
    }

    // Validate the file exists and is within the expected directory
    const resolvedPath = path.resolve(filePath);
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
      return { success: false, error: 'File must be within the uploads directory.' };
    }
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: 'File not found.' };
    }

    const recipients = this.parseRecipients(to);
    let lastResult: SendMessageResult = { success: false, error: 'No recipients specified.' };

    try {
      // Step 1: Upload the media using multipart form-data via native fetch + Blob
      const fileBuffer = fs.readFileSync(resolvedPath);
      const displayName = filename || path.basename(resolvedPath);

      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), displayName);

      const uploadRes = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}` },
        body: formData,
        signal: AbortSignal.timeout(30000),
      });

      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => ({}));
        return { success: false, error: (errBody as any)?.error?.message || 'Media upload failed.' };
      }

      const uploadData = await uploadRes.json() as any;
      const mediaId = uploadData?.id;
      if (!mediaId) {
        return { success: false, error: 'Media upload failed — no ID returned.' };
      }

      // Step 2: Send document message referencing the uploaded media to each recipient
      for (const cleanPhone of recipients) {
        const msgRes = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'document',
            document: {
              id: mediaId,
              caption: caption || '',
              filename: displayName,
            },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!msgRes.ok) {
          const errBody = await msgRes.json().catch(() => ({}));
          const msg = (errBody as any)?.error?.message || `HTTP ${msgRes.status}`;
          console.error('[WA Business] Send document failed:', msg);
          lastResult = { success: false, error: msg };
        } else {
          const msgData = await msgRes.json() as any;
          const messageId = msgData?.messages?.[0]?.id;
          lastResult = { success: true, messageId };
        }
      }
    } catch (err: any) {
      console.error('[WA Business] Send document failed:', err.message);
      lastResult = { success: false, error: err.message || 'Unknown error' };
    }
    return lastResult;
  }

  /**
   * Send a pre-approved template message (required for initiating conversations
   * outside the 24-hour customer service window).
   * @param to  Recipient phone number
   * @param templateName Template name as registered in Meta Business Manager
   * @param languageCode Language code (e.g. "en_US", "hi")
   * @param components Template component parameters (header, body, button variables)
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string = 'en_US',
    components?: any[]
  ): Promise<SendMessageResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return { success: false, error: 'WhatsApp Business API is not enabled.' };
    }
    if (!config.phoneNumberId || !config.accessToken) {
      return { success: false, error: 'Missing credentials. Configure in Settings.' };
    }

    const recipients = this.parseRecipients(to);
    let lastResult: SendMessageResult = { success: false, error: 'No recipients specified.' };

    for (const cleanPhone of recipients) {
      try {
        const payload: any = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
          },
        };
        if (components && components.length > 0) {
          payload.template.components = components;
        }

        const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = (errBody as any)?.error?.message || `HTTP ${res.status}`;
          console.error('[WA Business] Send template failed:', msg);
          lastResult = { success: false, error: msg };
        } else {
          const data = await res.json() as any;
          const messageId = data?.messages?.[0]?.id;
          lastResult = { success: true, messageId };
        }
      } catch (err: any) {
        console.error('[WA Business] Send template failed:', err.message);
        lastResult = { success: false, error: err.message || 'Unknown error' };
      }
    }
    return lastResult;
  }

  /**
   * Sanitize a phone number to international format (digits only, with country code).
   */
  private sanitizePhone(phone: string): string {
    let clean = String(phone).replace(/\D/g, '');
    // Add India country code if 10 digits
    if (clean.length === 10) {
      clean = `91${clean}`;
    }
    return clean;
  }
}

// Singleton
export const whatsappBusinessService = new WhatsAppBusinessService();
