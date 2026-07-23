import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { dbManager } from './database/connection.js';
import { eventService } from './services/eventService.js';
import { cleanProfileLockFiles } from './services/tokenRefreshScheduler.js';

// Define session directory for LocalAuth
const sessionPath = path.resolve(process.cwd(), '.wwebjs_auth', 'session');

// Clean up any stale lock files to prevent Puppeteer launch failures
try {
    cleanProfileLockFiles(sessionPath);
} catch (lockErr) {
    console.warn('[WhatsApp Handler] Warning: Failed to clean profile lock files:', lockErr);
}

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getChromeExecutablePath() {
    try {
        const localPath = puppeteer.executablePath();
        if (localPath && fs.existsSync(localPath)) {
            console.log(`[WhatsApp Handler] Using self-contained Chrome at: ${localPath}`);
            return localPath;
        }
    } catch (e) {
        console.warn('[WhatsApp Handler] Error checking self-contained Puppeteer path:', e);
    }
    
    // Fallback to system Chrome
    const systemPath = findChromePath();
    if (systemPath) {
        console.log(`[WhatsApp Handler] Self-contained Chrome not found. Falling back to system Chrome at: ${systemPath}`);
        return systemPath;
    }
    
    console.warn('[WhatsApp Handler] No Chrome executable found. Relying on default browser resolution.');
    return undefined;
}

const chromePath = getChromeExecutablePath();
const puppeteerOpts: any = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};
if (chromePath) {
    puppeteerOpts.executablePath = chromePath;
}

// Initialize the client with LocalAuth (saves session so you don't scan QR every time)
export const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.resolve(process.cwd(), '.wwebjs_auth')
    }),
    puppeteer: puppeteerOpts
});

// Generate QR Code in terminal
client.on('qr', async (qr) => {
    try {
        const { setCurrentQr } = await import('./whatsappClient.js');
        setCurrentQr(qr);
    } catch (err) {
        console.error('[WhatsApp Handler] Failed to set QR code on client wrapper:', err);
    }
    
    console.log('\n=========================================');
    console.log('📱 SCAN THIS QR CODE WITH WHATSAPP 📱');
    console.log('=========================================\n');
    qrcodeTerminal.generate(qr, { small: true });
});

// Client is connected and ready
client.on('ready', async () => {
    try {
        const { setCurrentQr, setIsReady } = await import('./whatsappClient.js');
        setCurrentQr(null);
        setIsReady(true);

        // Sync active chats from phone to local SQLite database so they show up immediately in the CRM
        console.log('[WhatsApp Handler] Synchronizing active chats to SQLite database...');
        try {
            const chats = await client.getChats();
            const db = await dbManager.getConnection();
            for (const chat of chats) {
                const chatId = chat.id._serialized;
                if (chatId === 'status@broadcast') continue;
                
                const chatName = chat.name || chatId.split('@')[0];
                const resolvedNumber = chatId.split('@')[0];
                const unreadCount = chat.unreadCount || 0;
                const timestamp = chat.timestamp || Math.floor(Date.now() / 1000);
                
                let lastMessageText = '';
                try {
                    const msgs = await chat.fetchMessages({ limit: 1 });
                    if (msgs && msgs.length > 0) {
                        lastMessageText = msgs[0].body || '';
                    }
                } catch (msgErr) {
                    lastMessageText = chat.lastMessage ? chat.lastMessage.body : '';
                }

                await db.run(
                    `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET
                       unread_count = EXCLUDED.unread_count,
                       timestamp = EXCLUDED.timestamp,
                       last_message = EXCLUDED.last_message`,
                    [chatId, chatName, unreadCount, timestamp, lastMessageText, chat.isGroup ? 1 : 0, resolvedNumber]
                );
            }
            console.log(`[WhatsApp Handler] Synced ${chats.length} active chats successfully.`);
            eventService.broadcast('wa_chats_updated', {});
        } catch (syncErr) {
            console.error('[WhatsApp Handler] Failed to sync active chats on ready:', syncErr);
        }
    } catch (err) {
        console.error('[WhatsApp Handler] Failed to update client wrapper status:', err);
    }
    console.log('✅ WhatsApp Client is READY and listening for messages!');
});

// Listen for incoming messages
client.on('message', async (msg) => {
    const isGroup = msg.from.endsWith('@g.us') || msg.from.includes('-');
    if (msg.from === 'status@broadcast' || isGroup) return;

    const chatId = msg.from; // e.g. "919876543210@c.us"
    const from = chatId.split('@')[0];
    const timestamp = msg.timestamp;
    const bodyText = msg.body || '';
    const msgId = msg.id?._serialized || msg.id?.id || `msg_${msg.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const hasMedia = msg.hasMedia ? 1 : 0;
    const msgType = msg.type || 'text';

    console.log(`\n📩 [New Message] From: ${from} | Text: "${bodyText}"`);

    // 1. Save message to local database so it displays in CRM chat thread
    try {
        const db = await dbManager.getConnection();

        // Save to whatsapp_messages
        await db.run(
            `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
            [msgId, chatId, bodyText, msg.fromMe ? 1 : 0, timestamp, msgType, hasMedia]
        );

        // Fetch or update chat unread count and details
        const existingChat = await db.get('SELECT name, unread_count FROM whatsapp_chats WHERE id = ?', [chatId]);
        const currentUnread = msg.fromMe ? 0 : (existingChat?.unread_count || 0) + 1;
        const chatName = existingChat?.name || from;

        await db.run(
            `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               unread_count = EXCLUDED.unread_count,
               timestamp = EXCLUDED.timestamp,
               last_message = EXCLUDED.last_message`,
            [chatId, chatName, currentUnread, timestamp, bodyText, 0, from]
        );

        // Broadcast SSE event so the CRM UI updates instantly
        eventService.broadcast('wa_new_message', {
            chat_id: chatId,
            message: {
                id: msgId,
                body: bodyText,
                fromMe: msg.fromMe,
                timestamp,
                type: msgType,
                hasMedia: !!hasMedia
            }
        });
    } catch (dbErr) {
        console.error('❌ [Database Error] Failed to save message to SQLite:', dbErr);
    }

    // 2. Route message through the unified intent and search service
    try {
        const { whatsappIntentService } = await import('./services/whatsappIntentService.js');
        whatsappIntentService.handleInbound(msg).catch(err => {
            console.error('[WhatsApp Handler] Intent service execution failed:', err);
        });
    } catch (err) {
        console.error('[WhatsApp Handler] Failed to load whatsappIntentService:', err);
    }
});

export const startWhatsAppClient = () => {
    console.log('🔄 WhatsApp Client automated initialization is disabled (Direct/Redirect mode is active).');
};
