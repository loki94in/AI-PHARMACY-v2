import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { eventService } from './services/eventService.js';
import { dbManager } from './database/connection.js';
import { config as appConfig } from './config/index.js';
import { whatsappBusinessService } from './services/whatsappBusinessService.js';

// whatsapp-web.js uses CommonJS default export, so Client is a value not a type.
// Use InstanceType<typeof Client> to get the correct instance type.
type WAClient = InstanceType<typeof Client>;

let clientInstance: WAClient | null = null;

// Catch and ignore Puppeteer/whatsapp-web.js internal detached frame and context destroyed rejections
// to prevent them from crashing the server process in dev or production.
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason);
  if (
    msg.includes('detached Frame') ||
    msg.includes('Execution context was destroyed') ||
    msg.includes('Session closed. Most likely the page has been closed') ||
    msg.includes('Target closed')
  ) {
    console.warn('[WhatsApp SafeGuard] Handled and suppressed internal Puppeteer/WA rejection:', msg);
    return;
  }
  // Let other unhandled rejections bubble or log them
  console.error('[Unhandled Rejection]', reason);
});

/** Helper to check whether we should route messages to WhatsApp Business Cloud API */
export async function shouldRouteToBusiness(): Promise<boolean> {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)`,
      ['whatsapp_enabled', 'wa_business_enabled', 'whatsapp_preferred_system']
    );
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    const whatsappEnabled = map['whatsapp_enabled'] === 'true';
    const waBusinessEnabled = map['wa_business_enabled'] === 'true';
    const preferredSystem = map['whatsapp_preferred_system'] || 'automated';

    if (waBusinessEnabled && !whatsappEnabled) {
      return true;
    }
    if (waBusinessEnabled && whatsappEnabled && preferredSystem === 'official') {
      return true;
    }
    return false;
  } catch (err) {
    console.error('Error checking WhatsApp routing preferences:', err);
    return false;
  }
}
let activeClient: WAClient | null = null; // Track currently initializing or active client
let initializing = false;

export let currentQr: string | null = null;
export let isReady: boolean = false;

let qrTimeout: NodeJS.Timeout | null = null;

function cleanupProfileLocks() {
  const sessionPath = path.resolve(process.cwd(), '.wwebjs_auth', 'session');
  
  // 1. Terminate any stale Chrome/Edge processes holding this profile lock
  try {
    if (process.platform === 'win32') {
      const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe' or name = 'msedge.exe'\\" | Where-Object { $_.CommandLine -like '*wwebjs_auth*session*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
      execSync(cmd, { stdio: 'ignore' });
      console.log('[WhatsApp Init] Stale WhatsApp browser processes terminated.');
    }
  } catch (err: any) {
    console.warn('[WhatsApp Init] Could not check/kill running browser processes (non-fatal):', err.message);
  }

  // 2. Remove locks and devtools active port files to avoid Puppeteer launch hangs
  const filesToClean = ['lockfile', 'SingletonLock', 'DevToolsActivePort'];
  for (const file of filesToClean) {
    const filePath = path.join(sessionPath, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[WhatsApp Init] Cleaned stale lock file: ${file}`);
      } catch (err: any) {
        console.warn(`[WhatsApp Init] Could not delete lock file ${file}: ${err.message}`);
      }
    }
  }
}

/** Initialize the WhatsApp client and return it */
export async function initClient(): Promise<WAClient> {
  if (clientInstance) return clientInstance;
  if (initializing) {
    // wait for existing init to finish
    return new Promise<WAClient>((resolve, reject) => {
      const check = () => {
        if (clientInstance) resolve(clientInstance);
        else if (!initializing) reject(new Error('Initialization failed'));
        else setTimeout(check, 50);
      };
      check();
    });
  }
  
  // Clean up any stale profile locks before initiating Chrome
  cleanupProfileLocks();

  initializing = true;
  return new Promise<WAClient>((resolve, reject) => {
    
    // Find local browser executable
    let execPath = '';
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        execPath = p;
        break;
      }
    }

    const client = new Client({ 
      authStrategy: new LocalAuth(),
      puppeteer: execPath ? { 
        executablePath: execPath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-session-crashed-bubble',
          '--disable-gpu'
        ]
      } : {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-session-crashed-bubble',
          '--disable-gpu'
        ]
      }
    });
    activeClient = client;

    client.on('qr', async (qr: string) => {
      console.log('WhatsApp QR code received');
      currentQr = qr;
      isReady = false;

      // Try sending QR via Telegram
      try {
        const qrcode = await import('qrcode');
        const buffer = await qrcode.default.toBuffer(qr);
        const { telegramBotService } = await import('./telegramBot.js');
        await telegramBotService.sendPhotoToDefaultChat(
          buffer, 
          '🚨 WhatsApp Action Required!\nPlease scan this new QR code within 30 seconds to reconnect.'
        );
      } catch (err) {
        console.error('Failed to send QR to telegram', err);
      }

      if (qrTimeout) clearTimeout(qrTimeout);
      
      // 30-second timeout to reload QR
      qrTimeout = setTimeout(() => {
        if (!isReady) {
          console.log('QR Code expired (30s). Destroying client to prevent leak. Standing by.');
          client.destroy().catch(err => console.error('Error destroying WA client:', err));
        }
      }, 30000);
    });

    client.on('ready', () => {
      console.log('WhatsApp Client is ready!');
      if (qrTimeout) clearTimeout(qrTimeout);
      clientInstance = client;
      activeClient = client;
      initializing = false;
      isReady = true;
      currentQr = null;
      resolve(client);

      // Start background synchronization of chats and messages
      syncWhatsappData(client).catch(err => {
        console.error('[WhatsApp] Background sync failed:', err);
      });
    });

    client.on('disconnected', (reason) => {
      console.log('WhatsApp client disconnected:', reason);
      isReady = false;
      clientInstance = null;
      activeClient = null;
      initializing = false;
      if (qrTimeout) clearTimeout(qrTimeout);
      
      eventService.broadcast('auth_failure', {
        message: 'WhatsApp Web disconnected. Please scan the QR code in Settings to reconnect.',
        service: 'whatsapp'
      });

      // Gracefully destroy, then wait for explicit reconnect to avoid detached frame errors
      client.destroy().catch(() => {}).finally(() => {
        console.log('WhatsApp client destroyed. Waiting for manual or API-triggered reconnect.');
      });
    });

    client.on('auth_failure', (msg: string) => {
      initializing = false;
      isReady = false;
      activeClient = null;
      
      eventService.broadcast('auth_failure', {
        message: `WhatsApp authentication failed: ${msg}. Please reconnect in Settings.`,
        service: 'whatsapp'
      });

      reject(new Error(msg));
    });

    const isChatIgnored = async (db: any, chatId: string): Promise<boolean> => {
      const phone = chatId.split('@')[0];
      const row = await db.get(
        `SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ? OR phone = ? LIMIT 1`,
        [chatId, phone]
      );
      if (row) {
        return row.reason !== 'unignored';
      }
      const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
      return isGroupOrBroadcast;
    };
    
    // Register message creation event listener for offline caching
    client.on('message_create', async (msg) => {
      try {
        const chatId = msg.to && msg.fromMe ? msg.to : msg.from;
        const db = await dbManager.getConnection();

        // Completely skip saving, broadcasting, or processing if the chat is on the ignore list
        const ignored = await isChatIgnored(db, chatId);
        if (ignored) {
          return;
        }
        
        await db.run(
          `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            msg.id._serialized,
            chatId,
            msg.body || '',
            msg.fromMe ? 1 : 0,
            msg.timestamp,
            msg.type,
            msg.hasMedia ? 1 : 0
          ]
        );

        let resolvedNumber = chatId.split('@')[0];
        let chatName = chatId.split('@')[0];
        try {
          const chat = await msg.getChat();
          if (chat) chatName = chat.name || chatName;
        } catch (e) {}

        if (chatId.endsWith('@lid')) {
          try {
            const mapping = await client.getContactLidAndPhone([chatId]);
            if (mapping && mapping[0] && mapping[0].pn) {
              resolvedNumber = mapping[0].pn;
            } else {
              const contact = await msg.getContact();
              if (contact && contact.number && contact.number !== resolvedNumber) {
                resolvedNumber = contact.number;
              }
            }
          } catch (e) {}
        }

        await db.run(
          `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             timestamp=excluded.timestamp,
             last_message=excluded.last_message,
             resolved_number=excluded.resolved_number,
             unread_count = CASE WHEN ? = 0 THEN unread_count + 1 ELSE unread_count END`,
          [
            chatId,
            chatName,
            msg.fromMe ? 0 : 1,
            msg.timestamp,
            msg.body || '',
            chatId.includes('g.us') ? 1 : 0,
            resolvedNumber,
            msg.fromMe ? 1 : 0
          ]
        );

        eventService.broadcast('wa_new_message', {
          chat_id: chatId,
          message: {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            type: msg.type,
            hasMedia: msg.hasMedia
          }
        });

        // Route inbound customer messages through WhatsApp intent service
        if (!msg.fromMe) {
          import('./services/whatsappIntentService.js')
            .then(({ whatsappIntentService }) => whatsappIntentService.handleInbound(msg))
            .catch(err => console.error('[WhatsApp] Intent service error:', err));
        }
      } catch (err) {
        console.error('[WhatsApp] Error in message_create event handler:', err);
      }
    });

    client.on('message_ack', async (msg, ack) => {
      try {
        eventService.broadcast('wa_message_ack', {
          msg_id: msg.id._serialized,
          ack
        });
      } catch (err) {
        console.error('[WhatsApp] Error in message_ack event handler:', err);
      }
    });

    client.initialize().catch(err => {
      console.error('[WhatsApp] Failed during initialize():', err);
      initializing = false;
      isReady = false;
      clientInstance = null;
      activeClient = null;
      reject(err);
    });
  });
}

/** Send a media message using the initialized client or WhatsApp Business API */
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

  // Check if we should route to official WhatsApp Business API
  const useBusiness = await shouldRouteToBusiness();
  if (useBusiness) {
    if (file && file.mimetype && file.data) {
      if (!fs.existsSync(appConfig.tempDir)) {
        fs.mkdirSync(appConfig.tempDir, { recursive: true });
      }
      const tempFilePath = path.join(appConfig.tempDir, `wa_temp_${Date.now()}_${file.filename || 'document.pdf'}`);
      fs.writeFileSync(tempFilePath, Buffer.from(file.data, 'base64'));
      try {
        const result = await whatsappBusinessService.sendDocument(to, tempFilePath, caption, file.filename);
        if (!result.success) {
          throw new Error(result.error || 'Failed to send document via WhatsApp Business API');
        }
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    } else if (mediaPath) {
      const result = await whatsappBusinessService.sendDocument(to, mediaPath, caption);
      if (!result.success) {
        throw new Error(result.error || 'Failed to send document via WhatsApp Business API');
      }
    } else {
      const result = await whatsappBusinessService.sendTextMessage(to, caption ?? '');
      if (!result.success) {
        throw new Error(result.error || 'Failed to send text message via WhatsApp Business API');
      }
    }
    return;
  }

  // Otherwise, use standard WhatsApp Web automated client
  if (!clientInstance) {
    throw new Error('Client not initialized. Call initClient() first.');
  }

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

    try {
      if (file && file.mimetype && file.data) {
        const { MessageMedia } = await import('whatsapp-web.js');
        const media = new MessageMedia(file.mimetype, file.data, file.filename || 'file');
        await clientInstance.sendMessage(chatId, media, { caption: caption ?? '' });
      } else if (mediaPath) {
        const { MessageMedia } = await import('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(mediaPath);
        await clientInstance.sendMessage(chatId, media, { caption: caption ?? '' });
      } else {
        await clientInstance.sendMessage(chatId, caption ?? '');
      }
    } catch (err) {
      console.error(`Failed to send WhatsApp message to ${chatId}:`, err);
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
    console.error('Error fetching chats from SQLite:', err);
    if (clientInstance) {
      return await clientInstance.getChats();
    }
    return [];
  }
}

/** Get messages for a specific chat from local SQLite cache */
export async function getChatMessages(chatId: string, limit: number = 50): Promise<any[]> {
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
       WHERE chat_id = ? 
       ORDER BY timestamp ASC 
       LIMIT ?`,
      [cleanId, limit]
    );

    if (rows.length > 0) {
      return rows;
    }

    if (clientInstance) {
      const chat = await clientInstance.getChatById(cleanId).catch(() => null);
      if (chat) {
        const liveMsgs = await chat.fetchMessages({ limit }).catch(() => []);
        (async () => {
          try {
            const dbConn = await dbManager.getConnection();
            for (const msg of liveMsgs) {
              await dbConn.run(
                `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO NOTHING`,
                [
                  msg.id._serialized,
                  cleanId,
                  msg.body || '',
                  msg.fromMe ? 1 : 0,
                  msg.timestamp,
                  msg.type,
                  msg.hasMedia ? 1 : 0
                ]
              );
            }
          } catch (err) {
            console.error('Error saving fallback live messages:', err);
          }
        })();
        return liveMsgs.map(m => ({
          id: m.id._serialized,
          body: m.body,
          fromMe: m.fromMe,
          timestamp: m.timestamp,
          type: m.type,
          hasMedia: m.hasMedia
        }));
      }
    }
    return [];
  } catch (err) {
    console.error('Error fetching messages from SQLite:', err);
    if (clientInstance) {
      const chat = await clientInstance.getChatById(cleanId).catch(() => null);
      if (chat) {
        const liveMsgs = await chat.fetchMessages({ limit }).catch(() => []);
        return liveMsgs.map(m => ({
          id: m.id._serialized,
          body: m.body,
          fromMe: m.fromMe,
          timestamp: m.timestamp,
          type: m.type,
          hasMedia: m.hasMedia
        }));
      }
    }
    return [];
  }
}

/** Asynchronously sync chats and recent messages from WhatsApp to SQLite */
async function syncWhatsappData(client: WAClient) {
  try {
    console.log('[WhatsApp] Starting background synchronization of chats and messages...');
    const chats = await client.getChats();
    const db = await dbManager.getConnection();

    // Load ignored list into memory once to avoid N+1 query lookup overhead
    const ignoreRows = await db.all('SELECT phone, reason FROM ignored_whatsapp_numbers');
    const ignoreMap = new Map<string, string>();
    for (const r of ignoreRows) {
      ignoreMap.set(r.phone, r.reason);
    }

    const isIgnored = (chatId: string) => {
      const phone = chatId.split('@')[0];
      const explicit = ignoreMap.get(chatId) || ignoreMap.get(phone);
      if (explicit !== undefined) {
        return explicit !== 'unignored';
      }
      return chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
    };
    
    for (const chat of chats) {
      const chatId = chat.id._serialized;
      if (isIgnored(chatId)) {
        continue; // Completely skip synchronization for ignored chats
      }
      const lastMsg = chat.lastMessage ? chat.lastMessage.body : null;
      
      // Resolve phone number if LID
      let resolvedNumber = chatId.split('@')[0];
      if (chatId.endsWith('@lid')) {
        try {
          const mapping = await client.getContactLidAndPhone([chatId]);
          if (mapping && mapping[0] && mapping[0].pn) {
            resolvedNumber = mapping[0].pn;
          } else {
            const contact = await client.getContactById(chatId);
            if (contact && contact.number && contact.number !== resolvedNumber) {
              resolvedNumber = contact.number;
            }
          }
        } catch (e) {
          console.error(`[WhatsApp] Failed to resolve LID ${chatId}:`, e);
        }
      }
      
      await db.run(
        `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           unread_count=excluded.unread_count,
           timestamp=excluded.timestamp,
           last_message=excluded.last_message,
           is_group=excluded.is_group,
           resolved_number=excluded.resolved_number`,
        [
          chatId,
          chat.name || chat.id.user,
          chat.unreadCount || 0,
          chat.timestamp || Math.floor(Date.now() / 1000),
          lastMsg,
          chat.isGroup ? 1 : 0,
          resolvedNumber
        ]
      );
    }
    console.log('[WhatsApp] Background synchronization completed successfully.');
    eventService.broadcast('wa_chats_updated', { success: true });
  } catch (err) {
    console.error('[WhatsApp] Error during synchronization:', err);
  }
}

/** Destroy the WhatsApp client to release file locks on the session folder */
export async function destroyClient(): Promise<void> {
  console.log('[WhatsApp] Destroying client to release session locks...');
  isReady = false;
  currentQr = null;
  initializing = false;
  if (qrTimeout) {
    clearTimeout(qrTimeout);
    qrTimeout = null;
  }
  if (activeClient) {
    try {
      // Race destroy promise with a 5-second timeout to prevent indefinite hangs
      await Promise.race([
        activeClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('client.destroy() timed out')), 5000))
      ]);
    } catch (err) {
      console.error('[WhatsApp] Error destroying client:', err);
    }
    activeClient = null;
  }
  clientInstance = null;
}

/** Force reconnect, clear saved session, and reinitialize for a fresh QR code */
export async function forceReconnect(): Promise<void> {
  console.log('[WhatsApp] Force reconnect requested. Destroying client and clearing session...');
  
  // 1. Reset state immediately
  isReady = false;
  currentQr = null;
  initializing = false;
  if (qrTimeout) clearTimeout(qrTimeout);
  
  // 2. Destroy the existing client if any
  if (activeClient) {
    try {
      // Race destroy promise with a 5-second timeout to prevent indefinite hangs
      await Promise.race([
        activeClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('client.destroy() timed out')), 5000))
      ]);
    } catch (err) {
      console.error('[WhatsApp] Error destroying client (non-fatal):', err);
    }
    activeClient = null;
  }
  clientInstance = null;

  // 3. Delete the stored auth session so a fresh QR is required
  const authPath = '.wwebjs_auth';
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log('[WhatsApp] Old session data cleared from', authPath);
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to clear session folder (non-fatal):', err);
  }

  // 4. Wait a moment then reinitialize — a fresh QR will be emitted
  await new Promise(r => setTimeout(r, 2000));
  initClient().catch(err => {
    console.error('[WhatsApp] Re-initialization after reconnect failed (non-fatal):', err.message);
  });
}

/** Download media for a specific message */
export async function getMessageMedia(chatId: string, messageId: string): Promise<{ mimetype: string; data: string; filename?: string }> {
  if (!clientInstance) {
    throw new Error('WhatsApp client not initialized.');
  }

  let cleanId = String(chatId);
  if (!cleanId.includes('@')) {
    let cleanPhone = cleanId.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    cleanId = `${cleanPhone}@c.us`;
  }

  const chat = await clientInstance.getChatById(cleanId);
  if (!chat) {
    throw new Error('Chat not found.');
  }

  // Fetch recent messages to locate the target message
  const messages = await chat.fetchMessages({ limit: 100 });
  const message = messages.find(m => m.id._serialized === messageId);
  
  if (!message) {
    throw new Error('Message not found.');
  }
  if (!message.hasMedia) {
    throw new Error('Message does not contain media.');
  }

  const media = await message.downloadMedia();
  if (!media) {
    throw new Error('Failed to download message media.');
  }

  return {
    mimetype: media.mimetype,
    data: media.data, // base64 string
    filename: media.filename || undefined
  };
}
