// Messaging Hub API (Agent 2)
import express from 'express';
import { initClient, sendMessage, currentQr, isReady, forceReconnect, destroyClient, shouldRouteToBusiness } from '../whatsappClient.js';
import QRCode from 'qrcode';
import { eventService } from '../services/eventService.js';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const router = express.Router();
let isLoginWindowActive = false;

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

// Get current WhatsApp authentication status and QR code
router.get('/qr', async (req, res) => {
  try {
    if (isLoginWindowActive) {
      return res.json({ isReady: false, qrUrl: null, message: 'Chrome login window is open. Scan the QR code in Chrome.' });
    }

    const useBusiness = await shouldRouteToBusiness();
    if (useBusiness) {
      return res.json({ isReady: true, qrUrl: null, message: 'WhatsApp Business API is active.' });
    }

    if (isReady) {
      return res.json({ isReady: true, qrUrl: null });
    }
    if (currentQr) {
      const qrUrl = await QRCode.toDataURL(currentQr);
      return res.json({ isReady: false, qrUrl });
    }
    
    // Trigger initialization if it hasn't started or QR isn't ready
    initClient().catch(console.error);
    
    res.json({ isReady: false, qrUrl: null, message: 'Initializing WhatsApp client. Waiting for QR...' });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Launch non-headless login window for WhatsApp Web
router.post('/login-window', async (req, res) => {
  const chromePath = findChromePath();
  if (!chromePath) {
    return res.status(404).json({ error: 'Google Chrome was not found on your system. Please install Google Chrome to use this feature.' });
  }

  if (isLoginWindowActive) {
    return res.json({ success: true, message: 'Chrome login window is already open.' });
  }

  isLoginWindowActive = true;
  res.json({ success: true, message: 'Opening WhatsApp login window...' });

  (async () => {
    let browser;
    try {
      // 1. Destroy background client to release session folder locks
      await destroyClient();

      // Give the OS 2.5 seconds to fully release file locks on the profile directory
      await new Promise(resolve => setTimeout(resolve, 2500));

      console.log('[WhatsApp] Launching Chrome for WhatsApp login from:', chromePath);
      const authPath = path.resolve(process.cwd(), '.wwebjs_auth', 'session');
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
        userDataDir: authPath
      });

      const [page] = await browser.pages();
      await page.goto('https://web.whatsapp.com/', { waitUntil: 'networkidle2' });

      // Poll for login confirmation or user closure (up to 10 minutes)
      for (let i = 0; i < 600; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if browser was closed
        const isClosed = !browser.connected || (await browser.pages().catch(() => [])).length === 0;
        if (isClosed) {
          console.log('[WhatsApp] Login window closed by user.');
          break;
        }

        // Check if logged in (look for pane-side or chat-list or chat-icon)
        const isLoggedIn = await page.evaluate(() => {
          return !!(
            document.querySelector('[data-testid="chat-list"]') ||
            document.querySelector('#pane-side') ||
            document.querySelector('[data-icon="chat"]')
          );
        }).catch(() => false);

        if (isLoggedIn) {
          console.log('[WhatsApp] Login detected in Chrome popup!');
          // Give it a moment to sync cookies and IndexedDB to userDataDir
          await new Promise(resolve => setTimeout(resolve, 3000));
          break;
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp] Error in Chrome login window:', err);
      // Broadcast error message to the frontend so the user knows why it failed
      try {
        eventService.broadcast('auth_failure', {
          message: `Failed to open WhatsApp login window: ${err.message || err}. Ensure Chrome is installed and not already open in another process.`
        });
      } catch (broadcastErr) {
        console.error('[WhatsApp] Failed to broadcast auth failure:', broadcastErr);
      }
    } finally {
      isLoginWindowActive = false;
      if (browser) {
        try {
          await browser.close();
        } catch (err) {
          console.error('[WhatsApp] Error closing browser:', err);
        }
      }
      // Re-initialize the background client now that Chrome is closed
      console.log('[WhatsApp] Re-initializing background client...');
      initClient().catch(err => {
        console.error('[WhatsApp] Re-initialization after popup failed:', err);
      });
    }
  })();
});

// Force reconnect and clear session
router.post('/reconnect', async (req, res) => {

  try {
    // Return early to the client, the forceReconnect runs asynchronously 
    // and takes a few seconds to destroy and restart the browser
    forceReconnect().catch(console.error);
    res.json({ success: true, message: 'Reconnecting...' });
  } catch (err) {
    console.error('Reconnect error:', err);
    res.status(500).json({ error: 'Failed to reconnect' });
  }
});

// Send a WhatsApp message via the hub
router.post('/send', async (req, res) => {
  const { number, message, mediaUrl, file } = req.body;
  if (!number || (!message && !file)) {
    return res.status(400).json({ error: 'number and either message or file are required' });
  }
  try {
    await sendMessage(number, mediaUrl, message, file);
    res.json({ success: true, message: 'WhatsApp message sent' });
  } catch (err) {
    console.error('Messaging hub error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get all WhatsApp chats
router.get('/chats', async (req, res) => {
  try {
    const { getChats } = await import('../whatsappClient.js');
    const chats = await getChats();
    // Sanitize the objects to prevent circular JSON stringify issues
    const sanitizedChats = chats.map(c => {
      if (c.id && typeof c.id === 'string') {
        // Flat format from local database
        return {
          id: c.id,
          name: c.name || c.id.split('@')[0],
          unreadCount: c.unreadCount || 0,
          timestamp: c.timestamp,
          isGroup: !!c.isGroup,
          lastMessage: c.lastMessage
        };
      }
      // Raw nested format from whatsapp-web.js client
      return {
        id: c.id._serialized,
        name: c.name || c.id.user,
        unreadCount: c.unreadCount,
        timestamp: c.timestamp,
        isGroup: c.isGroup,
        lastMessage: c.lastMessage ? c.lastMessage.body : null
      };
    });
    res.json(sanitizedChats);
  } catch (err: any) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch chats' });
  }
});

// Get messages for a specific chat
router.get('/chats/:id/messages', async (req, res) => {
  try {
    const { getChatMessages } = await import('../whatsappClient.js');
    const messages = await getChatMessages(req.params.id);
    const sanitizedMessages = messages.map(m => {
      if (m.id && typeof m.id === 'string') {
        // Flat format from local database
        return {
          id: m.id,
          body: m.body,
          fromMe: !!m.fromMe,
          timestamp: m.timestamp,
          type: m.type,
          hasMedia: !!m.hasMedia
        };
      }
      // Raw nested format from whatsapp-web.js client
      return {
        id: m.id._serialized,
        body: m.body,
        fromMe: m.fromMe,
        timestamp: m.timestamp,
        type: m.type,
        hasMedia: m.hasMedia
      };
    });
    res.json(sanitizedMessages);
  } catch (err: any) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch messages' });
  }
});

// Get media for a specific message
router.get('/chats/:chatId/messages/:messageId/media', async (req, res) => {
  try {
    const { getMessageMedia } = await import('../whatsappClient.js');
    const media = await getMessageMedia(req.params.chatId, req.params.messageId);
    res.json(media);
  } catch (err: any) {
    console.error('Error fetching message media:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch media' });
  }
});

export default router;
