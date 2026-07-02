// Email Parser API (Agent 2)
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { emailService } from '../services/emailService.js';
import { eventService } from '../services/eventService.js';


import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const getDbPath = () => process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const getUploadsDir = () => process.env.UPLOADS_DIR || path.resolve(__dirname, '..', '..', 'uploads');

const router = express.Router();

// Receive raw email payload (e.g., webhook from email service)
router.post('/', async (req, res) => {
  const { subject, from, body, attachments } = req.body;
  if (!subject || !from) {
    return res.status(400).json({ error: 'subject and from are required' });
  }
  try {
    // Log the basic email info
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['EMAIL_RECEIVED', `From: ${from}, Subject: ${subject}`]
    );
    
    // Process the email content using our email service
    const emailData = {
      from,
      subject,
      body: body || '',
      attachments: attachments || []
    };

    // Log the email receipt (more detailed)
    const db2 = await dbManager.getConnection();
    await db2.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['EMAIL_RECEIVED_PROCESSED', `From: ${from}, Subject: ${subject}`]
    );
    
    // Process the email using our EmailService
    await emailService.processEmail(emailData);

    // Handle attachments if any
    if (emailData.attachments.length > 0) {
      await emailService.processAttachments(emailData.attachments);
    }

    console.log(`Email processed from ${from}: ${subject}`);
    eventService.broadcast('email_update', { success: true, message: 'Email received and processed' });
    res.json({ success: true, message: 'Email received and processed' });
  } catch (error: any) {
    console.error('Email parse error:', error);
    eventService.broadcast('email_update', { success: false, error: error.message || 'Failed to process email' });
    res.status(500).json({ error: 'Failed to process email' });
  }
});

// GET /api/email/inbox — serves from local SQLite DB (offline-capable)
// Also triggers a background IMAP delta sync for new emails
router.get('/inbox', async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  // Default: last 7 days. Mobile can override with ?since=ISO_DATE
  const since = req.query.since as string | undefined
    || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const inbox = await emailService.fetchInbox(limit, since);
    res.json(inbox);
  } catch (error) {
    console.error('Fetch inbox error:', error);
    res.status(500).json({ error: 'Failed to fetch email inbox' });
  }
});

// POST /api/email/:id/seen
router.post('/:id/seen', async (req, res) => {
  const emailId = req.params.id;
  const uid = parseInt(emailId);
  if (isNaN(uid)) {
    return res.status(400).json({ error: 'Invalid email UID (must be a number)' });
  }
  try {
    // Mark as seen in local DB first
    await emailService.markEmailSeen(uid);
    // Also push to IMAP (best-effort)
    const success = await emailService.markAsSeen(uid);
    res.json({ success });
  } catch (error) {
    console.error('Mark as seen error:', error);
    res.status(500).json({ error: 'Failed to mark email as seen' });
  }
});

// POST /api/email/sync — trigger a manual IMAP delta sync
router.post('/sync', async (req, res) => {
  try {
    const synced = await emailService.syncNewEmailsFromIMAP();
    res.json({ success: true, synced, message: `Synced ${synced} new email(s) from Gmail` });
  } catch (error: any) {
    console.error('Manual sync error:', error);
    res.status(500).json({ error: error.message || 'Failed to sync emails' });
  }
});

// POST /api/email/:uid/saved — mark an email as saved/processed (turns Grey in UI)
router.post('/:uid/saved', async (req, res) => {
  const uid = parseInt(req.params.uid);
  if (isNaN(uid)) {
    return res.status(400).json({ error: 'Invalid email UID' });
  }
  try {
    const success = await emailService.markEmailSaved(uid);
    res.json({ success });
  } catch (error) {
    console.error('Mark email saved error:', error);
    res.status(500).json({ error: 'Failed to mark email as saved' });
  }
});


// POST /api/email/import-manual
router.post('/import-manual', async (req, res) => {
  const { subject, from, body, date, attachments } = req.body;
  if (!subject || !from) {
    return res.status(400).json({ error: 'subject and from are required' });
  }
  try {
    const emailData = {
      from,
      subject,
      body: body || '',
      date: date ? new Date(date) : new Date(),
      attachments: attachments || []
    };

    await emailService.processEmail(emailData);

    res.json({ success: true, message: 'Invoice manually imported and delivery boy alerted' });
  } catch (error) {
    console.error('Manual import error:', error);
    res.status(500).json({ error: 'Failed to manually import email invoice' });
  }
});

// GET /api/email/attachments
router.get('/attachments', async (req, res) => {
  try {
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const files = fs.readdirSync(uploadsDir);
    const attachments = files.map(filename => {
      const filePath = path.join(uploadsDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        createdAt: stats.birthtime || stats.mtime,
      };
    }).filter(file => file.filename.match(/\.(csv|txt|xlsx?|ods)$/i));

    res.json(attachments);
  } catch (error) {
    console.error('Failed to read attachments:', error);
    res.status(500).json({ error: 'Failed to retrieve attachments' });
  }
});

// GET /api/email/:id/attachments — get files available for a specific email
router.get('/:id/attachments', async (req, res) => {
  try {
    const emailId = req.params.id;
    const uid = parseInt(emailId);
    if (isNaN(uid)) {
      return res.status(400).json({ error: 'Invalid email UID (must be a number)' });
    }

    const attachments = await emailService.downloadAttachmentsForUid(uid);
    res.json(attachments);
  } catch (error) {
    console.error('Failed to read email attachments:', error);
    res.status(500).json({ error: 'Failed to retrieve attachments' });
  }
});

// GET /api/email/attachments/preview — serves a text preview of CSV, PDF, Excel, and TXT files
router.get('/attachments/preview', async (req, res) => {
  const filename = req.query.filename as string;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }
  try {
    const uploadsDir = getUploadsDir();
    const filePath = path.resolve(uploadsDir, filename);

    // Prevent directory traversal attacks
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Attachment file not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext === '.txt' || ext === '.csv') {
      const text = await fs.promises.readFile(filePath, 'utf-8');
      res.json({ success: true, type: 'text', content: text.substring(0, 50000) });
    } else if (ext === '.pdf') {
      const { default: pdfParse } = await import('pdf-parse');
      const dataBuffer = await fs.promises.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      res.json({ success: true, type: 'text', content: data.text });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const { default: XLSX } = await import('xlsx');
      const dataBuffer = await fs.promises.readFile(filePath);
      const workbook = XLSX.read(dataBuffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      res.json({ success: true, type: 'text', content: csv.substring(0, 50000) });
    } else {
      res.status(400).json({ error: 'Preview not supported for this file type' });
    }
  } catch (error: any) {
    console.error('Failed to generate file preview:', error);
    res.status(500).json({ error: error.message || 'Failed to generate file preview' });
  }
});


// POST /api/email/attachments/parse
router.post('/attachments/parse', async (req, res) => {
  const { filename, importData = true } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }
  try {
    const filePath = path.resolve(getUploadsDir(), filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Attachment file not found' });
    }

    const result = await emailService.parseAndImportAttachment(filePath, importData);
    eventService.broadcast('email_update', { success: true, message: 'Attachment parsed successfully' });
    res.json(result);
  } catch (error: any) {
    console.error('Failed to parse attachment:', error);
    eventService.broadcast('email_update', { success: false, error: error.message || 'Failed to parse attachment' });
    res.status(500).json({ error: 'Failed to parse attachment' });
  }
});

// DELETE /api/email/attachments/cache
router.delete('/attachments/cache', async (req, res) => {
  try {
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ success: true, count: 0, message: 'Uploads directory does not exist' });
    }
    const files = fs.readdirSync(uploadsDir);
    let count = 0;
    for (const filename of files) {
      if (filename.startsWith('att-')) {
        const filePath = path.join(uploadsDir, filename);
        fs.unlinkSync(filePath);
        count++;
      }
    }
    console.log(`Deleted ${count} files from attachments cache.`);
    res.json({ success: true, count, message: `Successfully deleted ${count} files from attachments cache` });
  } catch (error: any) {
    console.error('Failed to clear attachments cache:', error);
    res.status(500).json({ error: error.message || 'Failed to clear attachments cache' });
  }
});

// Initiate Google OAuth for Gmail
router.get('/auth/google', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const clientIdRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_client_id'");
    
    const clientId = clientIdRow?.value;
    if (!clientId) {
      return res.status(400).send('Please configure Google Client ID in settings first.');
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/email/auth/google/callback`;
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://mail.google.com/ https://www.googleapis.com/auth/drive.file')}` +
      `&access_type=offline` +
      `&prompt=consent`;

    res.redirect(googleAuthUrl);
  } catch (error: any) {
    console.error('Google Auth Redirect error:', error);
    res.status(500).send('Failed to initiate Gmail authentication: ' + error.message);
  }
});

// Google OAuth Callback Handler
router.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }

  try {
    const db = await dbManager.getConnection();
    const clientIdRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_client_id'");
    const clientSecretRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_client_secret'");
    const userRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_user'");
    
    const clientId = clientIdRow?.value;
    const clientSecret = clientSecretRow?.value;
    const emailUser = userRow?.value;

    if (!clientId || !clientSecret) {
            return res.status(400).send('Google OAuth configuration incomplete on backend');
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/email/auth/google/callback`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await response.json() as any;
    if (tokenData.error) {
            throw new Error(tokenData.error_description || tokenData.error);
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiryTimestamp = Date.now() + (expires_in * 1000);

    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_oauth_access_token', ?)", [access_token]);
    if (refresh_token) {
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_oauth_refresh_token', ?)", [refresh_token]);
    }
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_oauth_token_expiry', ?)", [expiryTimestamp.toString()]);
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_auth_method', 'oauth2')");

    let detectedEmail = emailUser;
    if (access_token) {
      try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const profileData = await profileRes.json() as any;
        if (profileData && profileData.email) {
          detectedEmail = profileData.email;
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_user', ?)", [detectedEmail]);
        }
      } catch (profileErr) {
        console.warn('Failed to fetch user profile email:', profileErr);
      }
    }

    
    res.send(`
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background-color: #121212; color: #fff; }
            .card { background: #1e1e1e; padding: 40px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
            h1 { color: #4CAF50; }
            p { font-size: 16px; color: #ccc; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Gmail Connected Successfully!</h1>
            <p>Email: <strong>${detectedEmail || 'Associated Account'}</strong></p>
            <p>You can close this tab now and go back to the app.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('OAuth Callback Error:', err);
    res.status(500).send('Authentication Callback Failed: ' + err.message);
  }
});

export default router;
