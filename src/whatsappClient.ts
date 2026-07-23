import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { eventService } from './services/eventService.js';
import { dbManager } from './database/connection.js';
import { config as appConfig } from './config/index.js';
import { whatsappBusinessService } from './services/whatsappBusinessService.js';

// whatsapp-web.js uses CommonJS default export, so Client is a value not a type.
// Use InstanceType<typeof Client> to get the correct instance type.
type WAClient = InstanceType<typeof Client>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

// Catch and ignore Puppeteer/whatsapp-web.js internal detached frame and context
// destroyed rejections so they don't crash the server process in dev or production.
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
  console.error('[Unhandled Rejection]', reason);
});

let clientInstance: WAClient | null = null;
let activeClient: WAClient | null = null; // Track currently initializing or active client
let initializing = false;
let isSyncing = false;
let qrTimeout: NodeJS.Timeout | null = null;

export let currentQr: string | null = null;
export let isReady: boolean = false;

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
  if (row) {
    return row.value === 'true';
  }

  // Default to automated mode (use the scanned in-app WhatsApp Web session headlessly)
  return false;
}

/** Kill stale Chrome/Edge processes and remove lock files holding the wwebjs session profile. */
function cleanupProfileLocks() {
  const sessionPath = path.resolve(process.cwd(), '.wwebjs_auth', 'session');

  try {
    if (process.platform === 'win32') {
      const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe' or name = 'msedge.exe'\\" | Where-Object { $_.CommandLine -like '*wwebjs_auth*session*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
      execSync(cmd, { stdio: 'ignore' });
      console.log('[WhatsApp Init] Stale WhatsApp browser processes terminated.');
    }
  } catch (err: any) {
    console.warn('[WhatsApp Init] Could not check/kill running browser processes (non-fatal):', err.message);
  }

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

/** Shared ignore-check used by the message_create handler (mirrors whatsappIntentService's own copy, used for the raw client event path). */
async function isChatIgnored(db: any, chatId: string): Promise<boolean> {
  const phone = chatId.split('@')[0];
  const row = await db.get(
    `SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ? OR phone = ? LIMIT 1`,
    [chatId, phone]
  );
  if (row) {
    return row.reason !== 'unignored';
  }
  const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
  if (isGroupOrBroadcast) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
        [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
      );
    } catch (e) {
      console.warn('[WhatsApp] Failed to auto-insert ignored chat:', e);
    }
  }
  return isGroupOrBroadcast;
}

/** Asynchronously sync chats and recent messages from WhatsApp to SQLite (fired on 'ready' and opportunistically). */
async function syncWhatsappData(client: WAClient) {
  if (isSyncing) {
    console.log('[WhatsApp] Synchronization already in progress, skipping duplicate request.');
    return;
  }
  isSyncing = true;
  try {
    console.log('[WhatsApp] Starting background synchronization of chats and messages...');
    const chats = await client.getChats();
    const db = await dbManager.getConnection();

    const ignoreRows = await db.all('SELECT phone, reason FROM ignored_whatsapp_numbers');
    const ignoreMap = new Map<string, string>();
    for (const r of ignoreRows) {
      ignoreMap.set(r.phone, r.reason);
    }

    const isIgnoredCached = async (chatId: string) => {
      const phone = chatId.split('@')[0];
      const explicit = ignoreMap.get(chatId) || ignoreMap.get(phone);
      if (explicit !== undefined) {
        return explicit !== 'unignored';
      }
      const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
      if (isGroupOrBroadcast) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
            [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
          );
          ignoreMap.set(chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast');
        } catch (e) {
          console.warn('[WhatsApp] Failed to auto-insert ignored chat in sync:', e);
        }
      }
      return isGroupOrBroadcast;
    };

    for (const chat of chats) {
      const chatId = chat.id._serialized;
      if (await isIgnoredCached(chatId)) {
        continue;
      }
      const lastMsg = chat.lastMessage ? chat.lastMessage.body : null;

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
  } finally {
    isSyncing = false;
  }
}

/** Initialize the WhatsApp client and return it */
export async function initClient(): Promise<WAClient> {
  if (clientInstance) return clientInstance;
  if (initializing) {
    return new Promise<WAClient>((resolve, reject) => {
      const check = () => {
        if (clientInstance) resolve(clientInstance);
        else if (!initializing) reject(new Error('Initialization failed'));
        else setTimeout(check, 50);
      };
      check();
    });
  }

  cleanupProfileLocks();

  initializing = true;
  return new Promise<WAClient>((resolve, reject) => {
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

    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-gpu'
    ];

    const client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: execPath
        ? { executablePath: execPath, headless: true, args: puppeteerArgs }
        : { headless: true, args: puppeteerArgs }
    });
    activeClient = client;

    client.on('qr', (qr: string) => {
      console.log('WhatsApp QR code received');
      currentQr = qr;
      isReady = false;

      if (qrTimeout) clearTimeout(qrTimeout);
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

      syncWhatsappData(client).catch(err => {
        console.error('[WhatsApp] Background sync failed:', err);
      });

      // Drain any messages that were queued while client was initializing
      drainSendQueue().catch(err => {
        console.error('[WhatsApp] Queue drain failed (non-fatal):', err);
      });
    });

    client.on('disconnected', (reason: string) => {
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

    client.on('message_create', async (msg: any) => {
      try {
        const chatId = msg.to && msg.fromMe ? msg.to : msg.from;
        const db = await dbManager.getConnection();

        if (await isChatIgnored(db, chatId)) {
          return;
        }

        const msgId = msg.id?._serialized || msg.id?.id || `msg_${msg.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        await db.run(
          `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            msgId,
            chatId,
            msg.body || '',
            msg.fromMe ? 1 : 0,
            msg.timestamp || Math.floor(Date.now() / 1000),
            msg.type || 'text',
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

        // Route inbound customer messages through the existing WhatsApp intent service
        if (!msg.fromMe) {
          import('./services/whatsappIntentService.js')
            .then(({ whatsappIntentService }) => whatsappIntentService.handleInbound(msg))
            .catch(err => console.error('[WhatsApp] Intent service error:', err));
        }
      } catch (err) {
        console.error('[WhatsApp] Error in message_create event handler:', err);
      }
    });

    client.on('message_ack', async (msg: any, ack: any) => {
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

  isReady = false;
  currentQr = null;
  initializing = false;
  if (qrTimeout) clearTimeout(qrTimeout);

  if (activeClient) {
    try {
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

  const authPath = '.wwebjs_auth';
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log('[WhatsApp] Old session data cleared from', authPath);
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to clear session folder (non-fatal):', err);
  }

  try {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM ignored_whatsapp_numbers WHERE reason IN ('group', 'broadcast')");
    console.log('[WhatsApp] Cleared auto-ignored group and broadcast chats from database.');
  } catch (err) {
    console.error('[WhatsApp] Failed to clear auto-ignored chats from database (non-fatal):', err);
  }

  await new Promise(r => setTimeout(r, 2000));
  initClient().catch(err => {
    console.error('[WhatsApp] Re-initialization after reconnect failed (non-fatal):', err.message);
  });
}

/** Send a media or text message using the WhatsApp Business API or the live WhatsApp Web client, and log it to SQLite */
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
    if (!useBusiness && (!isReady || !clientInstance)) {
      try {
        console.log('[WhatsApp Client] Client not ready on sendMessage call. Initializing headless WhatsApp client...');
        await initClient();
      } catch (initErr) {
        console.error('[WhatsApp Client] Auto-initialization failed during send:', initErr);
        throw new Error('WhatsApp session is not connected. Please scan the QR code in Settings or click "Open Live Chrome Window" to log in.');
      }
    }

    try {
      if (!useBusiness) {
        // Live WhatsApp Web client. Its own message_create event (fromMe: true) will
        // log this send to SQLite and broadcast it with the real WA message id, so we
        // must NOT also run the manual DB-write tail below for this branch — that
        // would insert a second, duplicate row under a synthetic id.
        if (file && file.mimetype && file.data) {
          const { MessageMedia } = await import('whatsapp-web.js');
          const media = new MessageMedia(file.mimetype, file.data, file.filename || 'file');
          await clientInstance!.sendMessage(chatId, media, { caption: caption ?? '' });
        } else if (mediaPath) {
          const { MessageMedia } = await import('whatsapp-web.js');
          const media = MessageMedia.fromFilePath(mediaPath);
          await clientInstance!.sendMessage(chatId, media, { caption: caption ?? '' });
        } else {
          await clientInstance!.sendMessage(chatId, caption ?? '');
        }
        continue;
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
    } catch (err: any) {
      console.error('[WhatsApp Client Wrapper] Send failed:', err?.message || err);
      throw err;
    }

    // Business API sends have no local client event to log them, so write here.
    // (The automated/whatsapp-web.js branch never reaches this point — it `continue`s above.)
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

/** Drain pending outbound messages from whatsapp_send_queue once the client is ready */
async function drainSendQueue(): Promise<void> {
  if (!isReady || !clientInstance) return;
  try {
    const db = await dbManager.getConnection();
    const pending = await db.all(
      'SELECT id, number, message FROM whatsapp_send_queue WHERE sent_at IS NULL ORDER BY created_at ASC'
    );
    if (pending.length === 0) return;
    console.log(`[WhatsApp] Draining ${pending.length} queued message(s)...`);
    for (const row of pending) {
      try {
        await sendMessage(row.number, undefined, row.message);
        await db.run('UPDATE whatsapp_send_queue SET sent_at = ? WHERE id = ?', [Date.now(), row.id]);
        console.log(`[WhatsApp] Queued message sent to ${row.number}`);
      } catch (err: any) {
        console.warn(`[WhatsApp] Failed to send queued message to ${row.number}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp] drainSendQueue error:', err?.message);
  }
}

/** Get all chats from the local SQLite cache with contact name enrichment */
export async function getChats(): Promise<any[]> {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, name, unread_count as unreadCount, timestamp, is_group as isGroup, last_message as lastMessage, resolved_number as resolvedNumber
       FROM whatsapp_chats
       ORDER BY timestamp DESC`
    );

    // Enrich names from pharmacy DB tables (customers, refills, delivery_boys, doctors)
    for (const r of rows) {
      const rawNum = r.resolvedNumber || (r.id ? r.id.split('@')[0] : '');
      const digits = rawNum.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : '';

      if (last10) {
        const likePattern = `%${last10}%`;

        // 1. Check customers
        const cust = await db.get('SELECT name FROM customers WHERE mobile LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (cust?.name) {
          r.name = cust.name;
          continue;
        }

        // 2. Check patient refills
        const refill = await db.get('SELECT patient_name FROM patient_refills WHERE patient_phone LIKE ? AND patient_name IS NOT NULL AND patient_name != "" LIMIT 1', [likePattern]);
        if (refill?.patient_name) {
          r.name = refill.patient_name;
          continue;
        }

        // 3. Check delivery boys
        const deliv = await db.get('SELECT name FROM delivery_boys WHERE (whatsapp_number LIKE ? OR mobile LIKE ?) AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern, likePattern]);
        if (deliv?.name) {
          r.name = deliv.name;
          continue;
        }

        // 4. Check doctors
        const doc = await db.get('SELECT name FROM doctors WHERE mobile LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (doc?.name) {
          r.name = doc.name;
          continue;
        }

        // 5. Check sales invoices
        const sale = await db.get('SELECT customer_name FROM sales_invoices WHERE customer_phone LIKE ? AND customer_name IS NOT NULL AND customer_name != "" LIMIT 1', [likePattern]);
        if (sale?.customer_name) {
          r.name = sale.customer_name;
        }
      }
    }

    return rows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChats SQLite error:', err);
    return [];
  }
}

/** Get messages for a specific chat from local SQLite cache */
export async function getChatMessages(chatId: string, limit: number = 500): Promise<any[]> {
  const raw = String(chatId || '').trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  const phoneWithoutCc = digits.length >= 10 ? digits.slice(-10) : digits;
  const likePattern = `%${phoneWithoutCc}%`;

  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT wm.id, wm.body, wm.from_me as fromMe, wm.timestamp,
              wm.type, wm.has_media as hasMedia,
              sm.result_json as scannedResult
       FROM whatsapp_messages wm
       LEFT JOIN scanned_messages sm ON sm.msg_id = wm.id
       WHERE wm.chat_id = ? OR wm.chat_id LIKE ?
       ORDER BY wm.timestamp ASC
       LIMIT ?`,
      [raw, likePattern, limit]
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
