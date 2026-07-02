import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import axios from 'axios';
import { dbManager } from '../database/connection.js';
import { telegramBotService } from '../telegramBot.js';
import { eventService } from './eventService.js';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backup');
const SNAPSHOTS_DIR = path.join(BACKUP_DIR, 'snapshots');
const ARCHIVES_DIR = path.join(BACKUP_DIR, 'archives');

// Ensure directories exist
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(ARCHIVES_DIR)) {
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

let snapshotTimeout: NodeJS.Timeout | null = null;

export class BackupRecoveryService {
  private static instance: BackupRecoveryService;

  private constructor() {
    // Start background resilience scan for pending uploads
    setInterval(() => this.retryPendingUploads(), 60 * 60 * 1000); // Every hour
  }

  public static getInstance(): BackupRecoveryService {
    if (!BackupRecoveryService.instance) {
      BackupRecoveryService.instance = new BackupRecoveryService();
    }
    return BackupRecoveryService.instance;
  }

  /**
   * Helper to retrieve a key-value setting from app_settings.
   */
  private async getSetting(key: string, defaultValue: string): Promise<string> {
    try {
      const db = await dbManager.getConnection();
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
      return row ? row.value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Helper to save a key-value setting.
   */
  private async setSetting(key: string, value: string): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
    } catch (err) {
      console.error(`Failed to set setting ${key}:`, err);
    }
  }

  /**
   * Triggers a debounced snapshot creation after database writes.
   */
  public triggerSnapshot(): void {
    if (snapshotTimeout) {
      clearTimeout(snapshotTimeout);
    }

    snapshotTimeout = setTimeout(async () => {
      try {
        const autoEnabled = await this.getSetting('backup_auto_enabled', 'true') === 'true';
        const isPaused = await this.getSetting('backup_is_paused', 'false') === 'true';
        
        if (autoEnabled && !isPaused) {
          await this.createSnapshot();
        }
      } catch (err) {
        console.error('[Backup] Snapshot trigger execution failed:', err);
      }
    }, 5000); // 5 seconds debounce
  }

  /**
   * Creates a snapshot of the active SQLite database using better-sqlite3 backup API.
   */
  public async createSnapshot(): Promise<string> {
    const localEnabled = await this.getSetting('backup_local_enabled', 'true') === 'true';
    if (!localEnabled) {
      return '';
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const filename = `snapshot_${dateStr}_${timeStr}.db.gz`;
    const destPath = path.join(SNAPSHOTS_DIR, filename);

    console.log(`[Backup] Generating database snapshot: ${filename}...`);

    // Ensure snapshots directory exists before starting SQLite WAL backup
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }

    // Safely clone database via checkpointed WAL copy to temporary raw file
    const tempDbPath = destPath.replace('.gz', '');
    const tempDb = new Database(DB_PATH);
    await tempDb.backup(tempDbPath);
    tempDb.close();

    // Compress raw database using gzip (ponytail: native stdlib zlib)
    const gzip = zlib.createGzip();
    const source = fs.createReadStream(tempDbPath);
    const destination = fs.createWriteStream(destPath);
    try {
      await pipeline(source, gzip, destination);
    } finally {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    }

    // Log action to DB
    try {
      const db = await dbManager.getConnection();
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['BACKUP_SNAPSHOT', `Snapshot created automatically: ${filename}`]
      );
    } catch {}

    // Same-day retention cleanup: Keep only the latest 5 snapshots for the current day
    try {
      const todayPrefix = `snapshot_${dateStr}_`;
      const files = fs.readdirSync(SNAPSHOTS_DIR)
        .filter(f => f.startsWith(todayPrefix) && (f.endsWith('.db') || f.endsWith('.db.gz')))
        .map(f => {
          const fp = path.join(SNAPSHOTS_DIR, f);
          return { name: f, path: fp, time: fs.statSync(fp).mtime.getTime() };
        })
        .sort((a, b) => b.time - a.time); // newest first

      const MAX_TODAY_SNAPSHOTS = 5;
      if (files.length > MAX_TODAY_SNAPSHOTS) {
        const toDelete = files.slice(MAX_TODAY_SNAPSHOTS);
        for (const snap of toDelete) {
          if (fs.existsSync(snap.path)) {
            fs.unlinkSync(snap.path);
            console.log(`[Backup] Same-day snapshot retention: deleted old snapshot ${snap.name}`);
          }
        }
      }
    } catch (err) {
      console.error('[Backup] Snapshot same-day retention cleanup failed:', err);
    }

    // Check if daily compression should be performed (if we have previous days' snapshots)
    await this.compressPreviousDaysSnapshots();

    return filename;
  }

  /**
   * Compresses snapshots from previous days into daily zip archives.
   */
  public async compressPreviousDaysSnapshots(): Promise<void> {
    const dailyCompressEnabled = await this.getSetting('backup_daily_compression', 'true') === 'true';
    if (!dailyCompressEnabled) return;

    try {
      const files = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.startsWith('snapshot_') && (f.endsWith('.db') || f.endsWith('.db.gz')));
      if (files.length === 0) return;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateGroups: Record<string, string[]> = {};

      // Group snapshot files by their date part
      for (const file of files) {
        const parts = file.split('_');
        if (parts.length >= 2) {
          const datePart = parts[1]; // YYYY-MM-DD
          if (datePart < todayStr) { // Only process historical days
            if (!dateGroups[datePart]) {
              dateGroups[datePart] = [];
            }
            dateGroups[datePart].push(file);
          }
        }
      }

      // Compress each group
      for (const [datePart, snapshotFiles] of Object.entries(dateGroups)) {
        const archiveName = `archive_${datePart}.zip`;
        const archivePath = path.join(ARCHIVES_DIR, archiveName);

        console.log(`[Backup] Compressing previous day snapshots for ${datePart} into ${archiveName}...`);
        
        const zip = new AdmZip();
        for (const file of snapshotFiles) {
          const filePath = path.join(SNAPSHOTS_DIR, file);
          if (fs.existsSync(filePath)) {
            zip.addLocalFile(filePath);
          }
        }
        zip.writeZip(archivePath);

        // Delete source snapshots ONLY after successful compression
        if (fs.existsSync(archivePath)) {
          for (const file of snapshotFiles) {
            fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
          }
          console.log(`[Backup] Compressed ${snapshotFiles.length} snapshots into ${archiveName}. Original snapshots cleaned.`);

          // Upload to Google Drive and Telegram
          await this.uploadArchive(archiveName);

          // Enforce retention rules
          await this.enforceRetention();
        }
      }
    } catch (err) {
      console.error('[Backup] Daily snapshots compression failed:', err);
    }
  }

  /**
   * Uploads the daily archive to Google Drive and Telegram if configured.
   */
  public async uploadArchive(filename: string): Promise<void> {
    const archivePath = path.join(ARCHIVES_DIR, filename);
    if (!fs.existsSync(archivePath)) return;

    const gdriveEnabled = await this.getSetting('backup_gdrive_enabled', 'false') === 'true';
    const telegramEnabled = await this.getSetting('backup_telegram_enabled', 'false') === 'true';
    const notifsEnabled = await this.getSetting('backup_notifications_enabled', 'true') === 'true';

    // Retrieve upload log
    const uploadLogRaw = await this.getSetting('backup_upload_log', '{}');
    const uploadLog: Record<string, { gdrive?: boolean; telegram?: boolean }> = JSON.parse(uploadLogRaw);
    
    if (!uploadLog[filename]) {
      uploadLog[filename] = {};
    }

    let gdriveUploaded = uploadLog[filename].gdrive || false;
    let telegramUploaded = uploadLog[filename].telegram || false;

    // 1. Google Drive Upload
    if (gdriveEnabled && !gdriveUploaded) {
      try {
        console.log(`[Backup] Uploading ${filename} to Google Drive...`);
        const success = await this.uploadToGoogleDrive(archivePath, filename);
        if (success) {
          gdriveUploaded = true;
          uploadLog[filename].gdrive = true;
          console.log(`[Backup] ${filename} successfully uploaded to Google Drive.`);
          if (notifsEnabled) {
            this.broadcastNotification('backup_upload_gdrive', `Google Drive upload completed: ${filename}`);
          }
        } else {
          console.warn(`[Backup] Google Drive upload failed for ${filename}. Will retry later.`);
        }
      } catch (err) {
        console.error(`[Backup] Google Drive upload error for ${filename}:`, err);
      }
    }

    // 2. Telegram Upload
    if (telegramEnabled && !telegramUploaded) {
      try {
        console.log(`[Backup] Sending ${filename} to Telegram...`);
        const success = await this.uploadToTelegram(archivePath, filename);
        if (success) {
          telegramUploaded = true;
          uploadLog[filename].telegram = true;
          console.log(`[Backup] ${filename} successfully sent to Telegram.`);
          if (notifsEnabled) {
            this.broadcastNotification('backup_upload_telegram', `Telegram backup completed: ${filename}`);
          }
        } else {
          console.warn(`[Backup] Telegram upload failed for ${filename}. Will retry later.`);
        }
      } catch (err) {
        console.error(`[Backup] Telegram upload error for ${filename}:`, err);
      }
    }

    // Save updated log
    await this.setSetting('backup_upload_log', JSON.stringify(uploadLog));
  }

  /**
   * Retries uploading any pending daily archives.
   */
  public async retryPendingUploads(): Promise<void> {
    try {
      const archives = fs.readdirSync(ARCHIVES_DIR).filter(f => f.startsWith('archive_') && f.endsWith('.zip'));
      if (archives.length === 0) return;

      console.log('[Backup] Scanning archives for pending cloud uploads...');
      for (const archive of archives) {
        await this.uploadArchive(archive);
      }
    } catch (err) {
      console.error('[Backup] Retry pending uploads execution failed:', err);
    }
  }

  /**
   * Upload to Google Drive using standard OAuth2 and multipart API requests.
   */
  private async uploadToGoogleDrive(filePath: string, filename: string): Promise<boolean> {
    try {
      const clientId = await this.getSetting('google_client_id', '');
      const clientSecret = await this.getSetting('google_client_secret', '');
      const refreshToken = await this.getSetting('gmail_oauth_refresh_token', '');

      if (!clientId || !clientSecret || !refreshToken) {
        console.warn('[Backup] Google Drive upload skipped: Credentials incomplete.');
        return false;
      }

      // Refresh Access Token
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const accessToken = tokenRes.data.access_token;
      if (!accessToken) {
        console.error('[Backup] Failed to refresh Google access token.');
        return false;
      }

      // Perform Multipart Upload
      const fileBuffer = fs.readFileSync(filePath);
      
      const metadata = {
        name: filename,
        mimeType: 'application/zip'
      };

      const boundary = 'foo_bar_boundary';
      const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
        Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const uploadRes = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', multipartBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': multipartBody.length,
        }
      });

      return uploadRes.status === 200 && !!uploadRes.data.id;
    } catch (err: any) {
      console.error('[Backup] Google Drive multipart upload failed:', err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Sends the archive to the configured Telegram Chat ID.
   */
  private async uploadToTelegram(filePath: string, filename: string): Promise<boolean> {
    try {
      const token = await this.getSetting('telegram_token', process.env.TELEGRAM_BOT_TOKEN || '');
      const chatId = await this.getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || '');

      if (!token || !chatId) {
        console.warn('[Backup] Telegram upload skipped: bot credentials or chat ID missing.');
        return false;
      }

      // Send document via API directly to support offline/independent bot instances
      const form = new URLSearchParams();
      // Since it's a file stream upload, axios can post multipart/form-data
      // Let's use form-data manually to avoid importing form-data package
      const fileStream = fs.createReadStream(filePath);
      
      // Let's build Axios multipart request
      const { default: FormData } = await import('form-data');
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', fileStream, filename);
      formData.append('caption', `AI Pharmacy OS daily backup archive: ${filename}`);

      const response = await axios.post(`https://api.telegram.org/bot${token}/sendDocument`, formData, {
        headers: formData.getHeaders()
      });

      return response.status === 200 && response.data.ok;
    } catch (err: any) {
      console.error('[Backup] Telegram document dispatch failed:', err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Enforces retention policy keeping only the latest 4 backup archives.
   */
  public async enforceRetention(): Promise<void> {
    const autoDelete = await this.getSetting('backup_auto_delete_old_archives', 'true') === 'true';
    if (!autoDelete) return;

    try {
      const archives = fs.readdirSync(ARCHIVES_DIR)
        .filter(f => f.startsWith('archive_') && f.endsWith('.zip'))
        .map(f => {
          const filePath = path.join(ARCHIVES_DIR, f);
          const stats = fs.statSync(filePath);
          return { filename: f, path: filePath, mtime: stats.mtime };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Newest first

      if (archives.length > 4) {
        const toDelete = archives.slice(4);
        for (const arch of toDelete) {
          if (fs.existsSync(arch.path)) {
            fs.unlinkSync(arch.path);
            console.log(`[Backup] Retention cleanup: deleted old archive ${arch.filename}`);
          }
        }
      }
    } catch (err) {
      console.error('[Backup] Enforce retention execution failed:', err);
    }
  }

  /**
   * Check on startup if the database is fresh (0 sales invoices & 0 purchases)
   * and we have some backup configuration or local files.
   */
  public async checkStartupRestore(): Promise<{ showRestorePopup: boolean; availableArchives: any[] }> {
    const startupCheck = await this.getSetting('backup_startup_restore_check', 'true') === 'true';
    const freshInstalled = await this.getSetting('backup_fresh_installed', 'false') === 'true';

    if (!startupCheck || freshInstalled) {
      return { showRestorePopup: false, availableArchives: [] };
    }

    try {
      const db = await dbManager.getConnection();
      const salesCount = await db.get('SELECT COUNT(*) as count FROM sales_invoices');
      const purchasesCount = await db.get('SELECT COUNT(*) as count FROM purchases');

      // Database is fresh if both counts are 0
      const isDbFresh = (salesCount?.count || 0) === 0 && (purchasesCount?.count || 0) === 0;
      if (!isDbFresh) {
        return { showRestorePopup: false, availableArchives: [] };
      }

      // Gather available archives
      const archives = this.listArchives();
      const showRestorePopup = archives.length > 0;

      return { showRestorePopup, availableArchives: archives };
    } catch (err) {
      console.error('[Backup] Startup restore check failed:', err);
      return { showRestorePopup: false, availableArchives: [] };
    }
  }

  /**
   * Lists all local backup archives.
   */
  public listArchives(): { filename: string; date: string; sizeBytes: number; source: string }[] {
    if (!fs.existsSync(ARCHIVES_DIR)) return [];

    const uploadLogRaw = fs.existsSync(DB_PATH) ? '' : '{}'; // Avoid connection during early startup queries if possible
    let uploadLog: Record<string, { gdrive?: boolean; telegram?: boolean }> = {};
    try {
      // Direct load if DB is initialized
      const db = new Database(DB_PATH, { readonly: true });
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'backup_upload_log'").get() as any;
      uploadLog = JSON.parse(row?.value || '{}');
      db.close();
    } catch {}

    return fs.readdirSync(ARCHIVES_DIR)
      .filter(f => f.startsWith('archive_') && f.endsWith('.zip'))
      .map(filename => {
        const filePath = path.join(ARCHIVES_DIR, filename);
        const stats = fs.statSync(filePath);
        
        // Extract date YYYY-MM-DD from archive_YYYY-MM-DD.zip
        const date = filename.replace('archive_', '').replace('.zip', '');
        
        const sources = ['Local'];
        if (uploadLog[filename]?.gdrive) sources.push('Google Drive');
        if (uploadLog[filename]?.telegram) sources.push('Telegram');

        return {
          filename,
          date,
          sizeBytes: stats.size,
          source: sources.join(', ')
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Restores data from a compressed zip archive.
   */
  public async restoreFromArchive(filename: string): Promise<void> {
    const sanitized = path.basename(filename);
    if (!sanitized.endsWith('.zip') && !sanitized.endsWith('.db') && !sanitized.endsWith('.db.gz')) {
      throw new Error('Invalid file format. Must be .zip archive, .db file, or .db.gz file.');
    }

    let filePath = '';
    let isZip = sanitized.endsWith('.zip');

    if (isZip) {
      filePath = path.join(ARCHIVES_DIR, sanitized);
    } else {
      filePath = path.join(BACKUP_DIR, sanitized);
      if (!fs.existsSync(filePath)) {
        // Fallback check snapshots directory
        filePath = path.join(SNAPSHOTS_DIR, sanitized);
      }
    }

    // Verify boundary sandbox check (prevent directory traversal)
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(BACKUP_DIR + path.sep)) {
      throw new Error('Directory traversal access denied');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Backup file not found: ${sanitized}`);
    }

    if (isZip) {
      // Unzip archive
      const tempExtractDir = path.join(BACKUP_DIR, 'temp_restore');
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractDir, { recursive: true });

      const zip = new AdmZip(filePath);
      zip.extractAllTo(tempExtractDir, true);

      // Find the newest/largest db file inside the unzipped folder
      const dbFiles = fs.readdirSync(tempExtractDir).filter(f => f.endsWith('.db') || f.endsWith('.db.gz'));
      if (dbFiles.length === 0) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        throw new Error('No valid database file (.db or .db.gz) found inside the archive.');
      }

      // Sort by size or modification time
      const targetDbFile = dbFiles[0];
      const targetDbPath = path.join(tempExtractDir, targetDbFile);

      // Close live database connection
      await dbManager.close();

      if (targetDbFile.endsWith('.gz')) {
        const gunzip = zlib.createGunzip();
        const source = fs.createReadStream(targetDbPath);
        const destination = fs.createWriteStream(DB_PATH);
        await pipeline(source, gunzip, destination);
      } else {
        fs.copyFileSync(targetDbPath, DB_PATH);
      }

      // Clean temp folder
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    } else {
      // Direct DB file restore
      await dbManager.close();
      if (sanitized.endsWith('.gz')) {
        const gunzip = zlib.createGunzip();
        const source = fs.createReadStream(filePath);
        const destination = fs.createWriteStream(DB_PATH);
        await pipeline(source, gunzip, destination);
      } else {
        fs.copyFileSync(filePath, DB_PATH);
      }
    }

    // Re-open database connection and log successful restore
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['RESTORE_BACKUP', `Database successfully restored from archive/file: ${sanitized}`]
    );

    this.broadcastNotification('backup_restore_completed', `Database restore completed successfully: ${sanitized}`);
  }

  /**
   * Delete a specific archive.
   */
  public deleteArchive(filename: string): void {
    const sanitized = path.basename(filename);
    if (!sanitized.endsWith('.zip')) {
      throw new Error('Invalid archive filename');
    }

    const filePath = path.join(ARCHIVES_DIR, sanitized);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(ARCHIVES_DIR + path.sep)) {
      throw new Error('Access denied');
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Backup] Deleted archive: ${sanitized}`);
    }
  }

  /**
   * Broadcast SSE Event / UI Notification.
   */
  private broadcastNotification(type: string, message: string): void {
    eventService.broadcast('notification', {
      type,
      title: 'Backup System Alert',
      message,
      timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    });
  }
}

export const backupRecoveryService = BackupRecoveryService.getInstance();
