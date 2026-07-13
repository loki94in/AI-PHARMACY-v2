import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eventService } from './services/eventService.js';
import { dbManager } from './database/connection.js';
import { config as appConfig } from './config/index.js';
import { whatsappBusinessService } from './services/whatsappBusinessService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

// Keep types and flags aligned so imports from other modules do not break
export let currentQr: string | null = null;
export let isReady: boolean = false;
let initializing = false;

export function setCurrentQr(qr: string | null) {
  currentQr = qr;
}

export function setIsReady(ready: boolean) {
  isReady = ready;
}

/** Helper to check whether we should route messages to WhatsApp Business Cloud API */
export async function shouldRouteToBusiness(): Promise<boolean> {
  const db = await dbManager.getConnection();
  
  // First, check preferred system
  const preferredSystemRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_preferred_system'");
  if (preferredSystemRow) {
    if (preferredSystemRow.value === 'official') return true;
    if (preferredSystemRow.value === 'automated') return false;
  }
  
  // Fallback to wa_business_enabled
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'wa_business_enabled'");
  return row ? row.value === 'true' : false;
}

/** Initialize the WhatsApp client */
export async function initClient(): Promise<any> {
  // Headless client wrapper disabled at user request.
  isReady = false;
  initializing = false;
  return {};
}

/** Destroy the WhatsApp client */
export async function destroyClient(): Promise<void> {
  isReady = false;
  initializing = false;
}

/** Force reconnect */
export async function forceReconnect(): Promise<void> {
  // No-op in direct/manual mode
}

/** Send a media or text message using the WhatsApp Business API and log it to SQLite */
export async function sendMessage(
  to: string,
  mediaPath?: string,
  caption?: string,
  file?: { mimetype: string; data: string; filename?: string }
): Promise<void> {
  if (!to) {
    console.warn('Attempted to send WhatsApp message to an empty or null number. Skipping.');
    return;
  }

  const db = await dbManager.getConnection();
  const recipients = String(to)
    .split(/[,;\s]+/)
    .map(r => r.trim())
    .filter(r => r.length > 0);

  for (const recipient of recipients) {
    let chatId = recipient;
    if (!chatId.includes('@')) {
      let cleanPhone = chatId.replace(/\D/g, '');
      if (cleanPhone.length === 10) {
        cleanPhone = `91${cleanPhone}`;
      }
      chatId = `${cleanPhone}@c.us`;
    }
    const cleanPhone = chatId.split('@')[0];

    let success = false;
    let messageId = `msg_out_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const useBusiness = await shouldRouteToBusiness();
    if (!useBusiness && !isReady) {
      throw new Error('Client not initialized');
    }

    try {
      if (!useBusiness) {
        // Automated headless client disabled at user request. Log message to SQLite.
        console.log(`[WhatsApp Client] Headless client disabled. Logged message to ${chatId}: ${caption || ''}`);
        success = true;
      } else {
        if (file && file.mimetype && file.data) {
          if (!fs.existsSync(appConfig.tempDir)) {
            fs.mkdirSync(appConfig.tempDir, { recursive: true });
          }
          const tempFilePath = path.join(appConfig.tempDir, `wa_temp_${Date.now()}_${file.filename || 'document.pdf'}`);
          fs.writeFileSync(tempFilePath, Buffer.from(file.data, 'base64'));
          try {
            const result = await whatsappBusinessService.sendDocument(cleanPhone, tempFilePath, caption, file.filename);
            success = result.success;
            if (result.messageId) messageId = result.messageId;
          } finally {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          }
        } else if (mediaPath) {
          const result = await whatsappBusinessService.sendDocument(cleanPhone, mediaPath, caption);
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        } else {
          const result = await whatsappBusinessService.sendTextMessage(cleanPhone, caption ?? '');
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        }
      }
    } catch (err) {
      console.error('[WhatsApp Client Wrapper] Send failed:', err);
    }

    // Save to local database so it is visible in the frontend chat thread
    const bodyText = file ? `[Document] ${file.filename || ''} ${caption || ''}` : (mediaPath ? `[Document] ${path.basename(mediaPath)} ${caption || ''}` : (caption || ''));
    const timestamp = Math.floor(Date.now() / 1000);
    const hasMedia = file || mediaPath ? 1 : 0;

    try {
      await db.run(
        `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [messageId, chatId, bodyText, 1, timestamp, file || mediaPath ? 'document' : 'text', hasMedia]
      );

      const existingChat = await db.get('SELECT name FROM whatsapp_chats WHERE id = ?', [chatId]);
      const chatName = existingChat?.name || cleanPhone;

      await db.run(
        `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           last_message = EXCLUDED.last_message,
           resolved_number = EXCLUDED.resolved_number`,
        [chatId, chatName, 0, timestamp, bodyText, 0, cleanPhone]
      );

      // Broadcast event so UI updates instantly
      eventService.broadcast('wa_new_message', {
        chat_id: chatId,
        message: {
          id: messageId,
          body: bodyText,
          fromMe: true,
          timestamp,
          type: file || mediaPath ? 'document' : 'text',
          hasMedia: !!hasMedia
        }
      });
    } catch (dbErr) {
      console.error('[WhatsApp Client Wrapper] SQLite write error:', dbErr);
    }
  }
}

/** Get all chats from the local SQLite cache */
export async function getChats(): Promise<any[]> {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, name, unread_count as unreadCount, timestamp, is_group as isGroup, last_message as lastMessage, resolved_number as resolvedNumber 
       FROM whatsapp_chats 
       ORDER BY timestamp DESC`
    );
    return rows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChats SQLite error:', err);
    return [];
  }
}

/** Get messages for a specific chat from local SQLite cache */
export async function getChatMessages(chatId: string, limit: number = 500): Promise<any[]> {
  let cleanId = String(chatId);
  if (!cleanId.includes('@')) {
    let cleanPhone = cleanId.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    cleanId = `${cleanPhone}@c.us`;
  }

  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, body, from_me as fromMe, timestamp, type, has_media as hasMedia 
       FROM whatsapp_messages 
       WHERE chat_id = ? AND (body != '' OR has_media = 1)
       ORDER BY timestamp ASC 
       LIMIT ?`,
      [cleanId, limit]
    );
    return rows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChatMessages SQLite error:', err);
    return [];
  }
}

/** Retrieve cached media file from local storage */
export async function getMessageMedia(chatId: string, messageId: string): Promise<{ mimetype: string; data: string; filename?: string }> {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Look for any file in the uploads directory that starts with the messageId
  const files = fs.readdirSync(UPLOADS_DIR);
  const matchedFile = files.find(f => f.startsWith(messageId));

  if (!matchedFile) {
    throw new Error(`Media not found locally for message ID: ${messageId}`);
  }

  const filePath = path.join(UPLOADS_DIR, matchedFile);
  const ext = path.extname(matchedFile).toLowerCase();
  
  let mimetype = 'image/jpeg';
  if (ext === '.png') mimetype = 'image/png';
  else if (ext === '.pdf') mimetype = 'application/pdf';
  else if (ext === '.mp3') mimetype = 'audio/mp3';
  else if (ext === '.mp4') mimetype = 'video/mp4';

  const data = fs.readFileSync(filePath).toString('base64');
  return {
    mimetype,
    data,
    filename: matchedFile
  };
}
