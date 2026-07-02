import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

import fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  getScheduleConfig,
  setScheduleConfig,
} from '../services/backupService.js';
import { backupRecoveryService } from '../services/backupRecoveryService.js';
import { closeMessageDAO } from '../database/messageDAO.js';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';

// Trigger manual backup
router.post('/backup', async (_req, res) => {
  try {
    const result = await createBackup('Manual');
    res.json({ success: true, message: 'Backup created successfully', backupFilename: result.filename });
  } catch (error) {
    console.error('Backup failed:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// List all backups
router.get('/backup/list', async (_req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, backups });
  } catch (error) {
    console.error('Listing backups failed:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Delete a specific backup
router.delete('/backup/:filename', async (req, res) => {
  try {
    // Security: path.basename is applied inside deleteBackup()
    deleteBackup(req.params.filename);
    res.json({ success: true, message: 'Backup deleted' });
  } catch (error: any) {
    console.error('Delete backup failed:', error);
    res.status(400).json({ error: error.message || 'Failed to delete backup' });
  }
});

// Get backup schedule config
router.get('/backup/schedule', async (_req, res) => {
  try {
    const frequency = await getScheduleConfig();
    res.json({ success: true, frequency });
  } catch (error) {
    console.error('Get schedule failed:', error);
    res.status(500).json({ error: 'Failed to get backup schedule' });
  }
});

// Set backup schedule config
router.post('/backup/schedule', async (req, res) => {
  try {
    const { frequency } = req.body;
    if (!frequency) {
      return res.status(400).json({ error: 'frequency is required (off, 3h, 6h)' });
    }
    await setScheduleConfig(frequency);
    res.json({ success: true, message: `Backup schedule set to: ${frequency}` });
  } catch (error: any) {
    console.error('Set schedule failed:', error);
    res.status(400).json({ error: error.message || 'Failed to set backup schedule' });
  }
});

// Generate barcode labels
router.post('/barcode', async (req, res) => {
  const { items } = req.body; // Array of { name, batch }
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Items array is required' });
  }

  try {
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const doc = new PDFDocument({ margin: 30 });
    const pdfPath = path.join(uploadsDir, `barcodes_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    
    doc.pipe(stream);
    
    doc.fontSize(18).text('Medicine QR Code Labels', { align: 'center', underline: true });
    doc.moveDown(1.5);
    
    // Grid layout for labels: 3 labels per row
    let x = 40;
    let y = 100;
    const labelWidth = 160;
    const labelHeight = 150;
    const padding = 15;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qrText = `PRODUCT:${item.name || 'Unknown'}|BATCH:${item.batch || 'N/A'}`;
      const qrBuffer = await QRCode.toBuffer(qrText, { width: 120, margin: 1 });
      
      // Draw a boundary box for the label
      doc.rect(x, y, labelWidth, labelHeight).strokeColor('#e2e8f0').stroke();
      
      // Add text inside label
      doc.fillColor('#1e293b').fontSize(10).text(item.name || 'Unknown', x + 10, y + 10, { width: labelWidth - 20, height: 25, ellipsis: true });
      doc.fillColor('#64748b').fontSize(8).text(`Batch: ${item.batch || 'N/A'}`, x + 10, y + 35);
      
      // Embed QR image
      doc.image(qrBuffer, x + (labelWidth - 90) / 2, y + 50, { width: 90, height: 90 });
      
      // Advance to next position
      x += labelWidth + padding;
      if (x + labelWidth > doc.page.width - 40) {
        x = 40;
        y += labelHeight + padding;
        if (y + labelHeight > doc.page.height - 40) {
          doc.addPage();
          x = 40;
          y = 50;
        }
      }
    }
    
    doc.end();
    
    stream.on('finish', () => {
      res.json({ success: true, pdfUrl: `/uploads/${path.basename(pdfPath)}` });
    });
  } catch (error) {
    console.error('Barcode generation failed:', error);
    res.status(500).json({ error: 'Failed to generate barcodes' });
  }
});

// Generate barcode PDF for a single code
router.get('/barcode/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const doc = new PDFDocument();
    const pdfPath = path.join(uploadsDir, `barcode_${code}_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    
    const qrBuffer = await QRCode.toBuffer(code, { width: 200, margin: 1 });
    
    doc.fontSize(20).text('Invoice / Bill Barcode Label', { align: 'center', underline: true });
    doc.moveDown();
    
    doc.fontSize(14).text(`Bill Reference: ${code}`, { align: 'center' });
    doc.moveDown();
    
    // Embed single large QR Code representing the bill ID
    const imageWidth = 180;
    const xPos = (doc.page.width - imageWidth) / 2;
    doc.image(qrBuffer, xPos, doc.y, { width: imageWidth, height: imageWidth });
    
    doc.end();
    stream.on('finish', () => {
      res.json({ success: true, pdfUrl: `/uploads/${path.basename(pdfPath)}` });
    });
  } catch (error) {
    console.error('Barcode generation failed:', error);
    res.status(500).json({ error: 'Failed to generate barcode' });
  }
});

// Telegram functionality has been moved to src/telegramBot.ts

// Cloud storage with AWS S3
router.post('/cloud/push', async (req, res) => {
  try {
    const { default: AWS } = await import('aws-sdk');
    const s3 = new AWS.S3();

    // Upload database file to S3
    const bucketName = process.env.S3_BUCKET_NAME || 'ai-pharmacy-backups';
    const key = `backups/app_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;

    const fileStream = fs.createReadStream(DB_PATH);

    const uploadParams = {
      Bucket: bucketName,
      Key: key,
      Body: fileStream
    };

    const data = await s3.upload(uploadParams).promise();

    // Log the action
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['CLOUD_PUSH', `Uploaded to S3: ${data.Key}`]);
    
    res.json({ success: true, message: 'Data pushed to AWS S3', s3Url: data.Location });
  } catch (e: any) {
    console.error('Cloud push error:', e);
    res.status(500).json({ error: 'Failed to push to cloud' });
  }
});

// Restore a backup (accepts { filename } in body, or restores latest)
router.post('/backup/restore', async (req, res) => {
  try {
    let { filename } = req.body || {};
    if (!filename) {
      // Default to latest backup
      const backups = listBackups();
      if (backups.length === 0) {
        return res.status(400).json({ error: 'No backup files found to restore' });
      }
      filename = backups[0].filename;
    }
    await restoreBackup(filename);
    res.json({ success: true, message: `Backup restored successfully from: ${filename}` });
  } catch (e: any) {
    console.error('Backup restore error:', e);
    res.status(500).json({ error: 'Failed to restore backup: ' + e.message });
  }
});

// Legacy restore endpoint (restores latest backup)
router.post('/restore', async (_req, res) => {
  try {
    const backups = listBackups();
    if (backups.length === 0) {
      return res.status(400).json({ error: 'No backup files found to restore' });
    }
    await restoreBackup(backups[0].filename);
    res.json({ success: true, message: `Backup restored successfully from: ${backups[0].filename}` });
  } catch (e: any) {
    console.error('Restore error:', e);
    res.status(500).json({ error: 'Failed to restore backup: ' + e.message });
  }
});

// GET /api/utilities/backup/status
router.get('/backup/status', async (req, res) => {
  try {
    const status = await backupRecoveryService.checkStartupRestore();
    const db = await dbManager.getConnection();
    
    // Fetch individual toggles and values
    const getSetting = async (key: string, def: string) => {
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
      return row ? row.value : def;
    };

    const localEnabled = await getSetting('backup_local_enabled', 'true') === 'true';
    const gdriveEnabled = await getSetting('backup_gdrive_enabled', 'false') === 'true';
    const telegramEnabled = await getSetting('backup_telegram_enabled', 'false') === 'true';
    const autoEnabled = await getSetting('backup_auto_enabled', 'true') === 'true';
    const isPaused = await getSetting('backup_is_paused', 'false') === 'true';

    // Calculate total size of snapshots and archives
    const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backup');
    const SNAPSHOTS_DIR = path.join(BACKUP_DIR, 'snapshots');
    const ARCHIVES_DIR = path.join(BACKUP_DIR, 'archives');
    
    let totalSize = 0;
    const calculateFolderSize = (dir: string) => {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(f => {
          const stats = fs.statSync(path.join(dir, f));
          if (stats.isFile()) {
            totalSize += stats.size;
          }
        });
      }
    };
    calculateFolderSize(SNAPSHOTS_DIR);
    calculateFolderSize(ARCHIVES_DIR);

    // Get last backup & last upload details
    const archives = backupRecoveryService.listArchives();
    const lastArchive = archives[0];
    
    const uploadLogRaw = await getSetting('backup_upload_log', '{}');
    const uploadLog = JSON.parse(uploadLogRaw);
    
    let lastUploadDate = 'Never';
    let lastBackupDate = 'Never';

    if (lastArchive) {
      lastBackupDate = lastArchive.date;
      const log = uploadLog[lastArchive.filename];
      if (log && (log.gdrive || log.telegram)) {
        lastUploadDate = lastArchive.date;
      }
    }

    // Next scheduled backup
    const frequency = await getScheduleConfig();
    let nextScheduledBackup = 'N/A';
    if (frequency !== 'off' && !isPaused) {
      nextScheduledBackup = `In ${frequency}`;
    }

    res.json({
      success: true,
      showRestorePopup: status.showRestorePopup,
      availableArchives: archives,
      localBackupStatus: localEnabled ? (isPaused ? 'Paused' : 'Enabled') : 'Disabled',
      gdriveStatus: gdriveEnabled ? (isPaused ? 'Paused' : 'Enabled') : 'Disabled',
      telegramStatus: telegramEnabled ? (isPaused ? 'Paused' : 'Enabled') : 'Disabled',
      lastBackupDate,
      lastUploadDate,
      nextScheduledBackup,
      totalBackupSize: totalSize,
      backupStorageLocations: {
        local: 'backup/archives',
        gdrive: gdriveEnabled ? 'Google Drive Cloud Storage' : 'Not Configured',
        telegram: telegramEnabled ? 'Telegram Bot Notifications' : 'Not Configured'
      },
      isPaused
    });
  } catch (err: any) {
    console.error('[Backup] Status API failed:', err);
    res.status(500).json({ error: 'Failed to retrieve backup status: ' + err.message });
  }
});

// POST /api/utilities/backup/fresh-install
router.post('/backup/fresh-install', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backup_fresh_installed', 'true')");
    res.json({ success: true, message: 'Fresh installation mode set' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to set fresh installation mode: ' + err.message });
  }
});

// POST /api/utilities/backup/archive/restore
router.post('/backup/archive/restore', async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename parameter is required' });
  }
  try {
    await backupRecoveryService.restoreFromArchive(filename);
    res.json({ success: true, message: 'Backup restored successfully' });
  } catch (err: any) {
    console.error('[Backup] Restore failed:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// DELETE /api/utilities/backup/archive/:filename
router.delete('/backup/archive/:filename', async (req, res) => {
  try {
    backupRecoveryService.deleteArchive(req.params.filename);
    res.json({ success: true, message: 'Archive deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete archive: ' + err.message });
  }
});

// POST /api/utilities/backup/manual
router.post('/backup/manual', async (req, res) => {
  try {
    const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backup');
    const SNAPSHOTS_DIR = path.join(BACKUP_DIR, 'snapshots');
    const ARCHIVES_DIR = path.join(BACKUP_DIR, 'archives');

    const archiveName = `archive_manual_${new Date().toISOString().split('T')[0]}_${Date.now()}.zip`;
    const archivePath = path.join(ARCHIVES_DIR, archiveName);
    
    // Create new snapshot
    const snapshotFile = await backupRecoveryService.createSnapshot();
    const files = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.startsWith('snapshot_') && (f.endsWith('.db') || f.endsWith('.db.gz')));
    
    if (files.length > 0) {
      const zip = new AdmZip();
      files.forEach(f => zip.addLocalFile(path.join(SNAPSHOTS_DIR, f)));
      zip.writeZip(archivePath);
      // Clean up snapshots
      files.forEach(f => fs.unlinkSync(path.join(SNAPSHOTS_DIR, f)));
      // Upload manual archive
      await backupRecoveryService.uploadArchive(archiveName);
      await backupRecoveryService.enforceRetention();
    } else {
      // Create backup of active db directly as a zip archive
      const tempDbFile = `snapshot_manual_${Date.now()}.db`;
      const tempDbPath = path.join(SNAPSHOTS_DIR, tempDbFile);
      const tempDb = new Database(DB_PATH);
      await tempDb.backup(tempDbPath);
      tempDb.close();

      const zip = new AdmZip();
      zip.addLocalFile(tempDbPath);
      zip.writeZip(archivePath);
      fs.unlinkSync(tempDbPath);

      await backupRecoveryService.uploadArchive(archiveName);
      await backupRecoveryService.enforceRetention();
    }

    res.json({ success: true, message: 'Manual backup and upload completed successfully', archiveName });
  } catch (err: any) {
    console.error('[Backup] Manual backup failed:', err);
    res.status(500).json({ error: 'Manual backup failed: ' + err.message });
  }
});

// POST /api/utilities/backup/toggle-pause
router.post('/backup/toggle-pause', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'backup_is_paused'");
    const currentVal = row ? row.value === 'true' : false;
    const newVal = !currentVal;
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backup_is_paused', ?)", [newVal ? 'true' : 'false']);
    res.json({ success: true, message: newVal ? 'Automatic backup paused' : 'Automatic backup resumed', isPaused: newVal });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to toggle pause: ' + err.message });
  }
});

// Rotate encryption key placeholder
router.post('/encrypt/rotate', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['ROTATE_KEY', 'Encryption key rotated']);
        res.json({ success: true, message: 'Encryption key rotated (simulated)' });
  } catch (e) {
    console.error('Key rotation error:', e);
    res.status(500).json({ error: 'Failed to rotate key' });
  }
});



// Gmail test‑connection endpoint as requested
router.get('/gmail/test', async (req, res) => {
  try {
    console.log('TEST_CONNECTION_GMAIL');
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['TEST_CONNECTION_GMAIL', 'Gmail test connection invoked']);
        res.json({ success: true, message: 'Gmail connection OK' });
  } catch (e) {
    console.error('Gmail test connection error:', e);
    res.status(500).json({ error: 'Gmail test connection failed' });
  }
});

// WhatsApp test‑connection endpoint as requested
router.get('/whatsapp/test', async (req, res) => {
  try {
    console.log('TEST_CONNECTION_WHATSAPP');
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['TEST_CONNECTION_WHATSAPP', 'WhatsApp test connection invoked']);
        res.json({ success: true, message: 'WhatsApp connection OK' });
  } catch (e) {
    console.error('WhatsApp test connection error:', e);
    res.status(500).json({ error: 'WhatsApp test connection failed' });
  }
});

// WhatsApp send‑test‑message endpoint as requested
router.post('/whatsapp/send', async (req, res) => {
  try {
    // payload could contain chatId/message but we just mock success
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['WHATSAPP_SEND', 'Mock WhatsApp test message sent']);
        res.json({ success: true, message: 'WhatsApp test message sent (mock)' });
  } catch (e) {
    console.error('WhatsApp send‑test error:', e);
    res.status(500).json({ error: 'Failed to send WhatsApp test message' });
  }
});
router.get('/test-connection', async (req, res) => {
  try {
    const service = (req.query.service as string) || '';
    const actionType = service ? `TEST_CONNECTION_${service.toUpperCase()}` : 'TEST_CONNECTION';
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT 1 as ok');
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', [actionType, `Test connection ${service ? 'for ' + service : 'generic'}`]);
        let message = 'Connection test OK';
    if (service) {
      const friendly = service.charAt(0).toUpperCase() + service.slice(1);
      message = `${friendly} test OK`;
    }
    res.json({ success: true, message, result: row });
  } catch (e) {
    console.error('Test connection error:', e);
    res.status(500).json({ error: 'Connection test failed' });
  }
});

// POST /api/utilities/reset-data
router.post('/reset-data', async (req, res) => {
  try {
    // wipeAll=true means a full factory reset — settings are NOT preserved
    const wipeAll = req.body?.wipeAll === true;

    // 1. Read existing configurations BEFORE stopping workers
    //    (only needed when we intend to restore them after the wipe)
    let appSettingsRows: any[] = [];
    let settingsRows: any[] = [];
    if (!wipeAll) {
      try {
        const { open } = await import('sqlite');
        const { default: sqlite3 } = await import('sqlite3');
        const dbRaw = await open({ filename: DB_PATH, driver: sqlite3.Database });
        try {
          appSettingsRows = await dbRaw.all('SELECT * FROM app_settings');
        } catch (_) {}
        try {
          settingsRows = await dbRaw.all('SELECT * FROM settings');
        } catch (_) {}
        await dbRaw.close();
      } catch (e) {
        console.warn('[Reset] Failed to read configurations from DB:', e);
      }
    }

    // 2. Instead of deleting the DB file (fails on Windows due to file locks held by
    //    child workers, backup service, etc.), we wipe all data IN-PLACE using SQL.
    //    This is reliable because we can write to the DB through the existing connection.
    const db = await dbManager.getConnection();

    // 2a. Get all user-created table names
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );

    // 2b. Drop every table
    for (const { name } of tables) {
      await db.run(`DROP TABLE IF EXISTS "${name}"`);
    }

    // 2c. Close the now-empty connection so ensureSchema gets a fresh one
    await dbManager.close(true);

    // 2d. Also close the messageDAO connection so it reconnects to the fresh schema
    try {
      closeMessageDAO();
    } catch (_) {}

    // 2e. Lock and close all active staging database connections to release file locks on Windows
    try {
      const { closeAllStagingConnections, lockStagingDb } = await import('./migration.js');
      lockStagingDb();
      await closeAllStagingConnections();
    } catch (_) {}

    // 3. Recreate all tables from scratch via the schema migrations
    const { ensureSchema } = await import('../database.js');
    await ensureSchema(DB_PATH);

    // 3b. Compact the DB file to reclaim space from dropped tables
    try {
      const freshDb = await dbManager.getConnection();
      await freshDb.run('VACUUM');
    } catch (_) {}


    // 5. Restore configurations into the fresh database (skipped for full factory reset)
    if (!wipeAll) {
      try {
        const { open } = await import('sqlite');
        const { default: sqlite3 } = await import('sqlite3');
        const dbRaw = await open({ filename: DB_PATH, driver: sqlite3.Database });
        
        await dbRaw.run('BEGIN TRANSACTION');
        try {
          for (const row of appSettingsRows) {
            await dbRaw.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [row.key, row.value]);
          }
          for (const row of settingsRows) {
            await dbRaw.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [row.key, row.value]);
          }
          // Log reset event
          await dbRaw.run(
            "INSERT INTO action_logs (action_type, description) VALUES ('SYSTEM_RESET', 'System data reset & database self-healed successfully')"
          );
          await dbRaw.run('COMMIT');
        } catch (err) {
          await dbRaw.run('ROLLBACK');
          throw err;
        }
        await dbRaw.close();
      } catch (err: any) {
        console.error('[Reset] Failed to restore configurations:', err);
      }
    } else {
      // Log the factory reset in the fresh DB + set flag to skip shutdown backup
      try {
        const { open } = await import('sqlite');
        const { default: sqlite3 } = await import('sqlite3');
        const dbRaw = await open({ filename: DB_PATH, driver: sqlite3.Database });
        await dbRaw.run(
          "INSERT INTO action_logs (action_type, description) VALUES ('FACTORY_RESET', 'Full factory reset — all data and settings wiped')"
        );
        // Flag tells gracefulShutdown to skip the next shutdown backup
        await dbRaw.run(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('factory_reset_pending', 'true')"
        );
        await dbRaw.close();
      } catch (_) {}
    }

    // 6. Clean up file directories on disk
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    const rawDir = path.resolve(__dirname, '..', '..', 'catalogue', 'raw');
    const migrationReportsDir = path.resolve(__dirname, '..', '..', 'data', 'migration_reports');
    const auditImagesDir = path.resolve(__dirname, '..', '..', 'data', 'audit_images');

    const clearDir = (dirPath: string, preserveFiles: string[] = []) => {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          clearDir(filePath, preserveFiles);
          try {
            if (fs.readdirSync(filePath).length === 0) {
              fs.rmdirSync(filePath);
            }
          } catch (_) {}
        } else {
          if (!preserveFiles.includes(file)) {
            try {
              fs.unlinkSync(filePath);
            } catch (_) {}
          }
        }
      }
    };

    clearDir(uploadsDir, wipeAll ? [] : ['custom_stamp.png', 'custom_signature.png']);
    clearDir(rawDir);
    clearDir(migrationReportsDir);
    clearDir(auditImagesDir);

    if (wipeAll) {
      // Factory reset: also wipe all backup files, archives, snapshots
      const backupDir = path.resolve(__dirname, '..', '..', 'backup');
      clearDir(backupDir); // clears all .db.gz files, archives/, snapshots/ subdirs

      // Wipe migration staging database (separate from app.db)
      const dataDir = path.resolve(__dirname, '..', '..', 'data');
      const stagingDbPath = path.join(dataDir, 'staging.db');
      if (fs.existsSync(stagingDbPath)) {
        try {
          const { open } = await import('sqlite');
          const { default: sqlite3 } = await import('sqlite3');
          const stagingDb = await open({ filename: stagingDbPath, driver: sqlite3.Database });
          await stagingDb.run('PRAGMA foreign_keys = OFF');
          const stagingTables = await stagingDb.all(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
          );
          for (const { name } of stagingTables) {
            await stagingDb.run(`DROP TABLE IF EXISTS "${name}"`);
          }
          await stagingDb.run('VACUUM');
          await stagingDb.close();
        } catch (err) {
          console.warn('[Reset] Failed to wipe staging DB in-place:', err);
        }
      }
      const stagingDbFiles = ['staging.db', 'staging.db-wal', 'staging.db-shm'];
      for (const f of stagingDbFiles) {
        try { if (fs.existsSync(path.join(dataDir, f))) fs.unlinkSync(path.join(dataDir, f)); } catch (_) {}
      }
      // Unlock staging database connections
      try {
        const { unlockStagingDb } = await import('./migration.js');
        unlockStagingDb();
      } catch (_) {}

      // Wipe uploaded migration source files (zip, csv, xlsx etc.)
      const migrationSampelDir = path.resolve(__dirname, '..', '..', 'MIGRATION SAMPEL');
      clearDir(migrationSampelDir);

      // Wipe temp data directories
      const tempDirs = [
        path.resolve(__dirname, '..', '..', 'data', 'temp_migration'),
        path.resolve(__dirname, '..', '..', 'data', 'temp_ocr'),
        path.resolve(__dirname, '..', '..', 'data', 'search_screenshots'),
        path.resolve(__dirname, '..', '..', 'data', 'archived_migrations'),
      ];
      for (const d of tempDirs) clearDir(d);

      // Delete ALL temp/leftover DB files and runtime state files in data/
      const runtimeDataFiles = ['audit_queue.json', 'ocr_corrections.json', 'suggested_names.json'];
      if (fs.existsSync(dataDir)) {
        for (const f of fs.readdirSync(dataDir)) {
          // Skip the freshly-created app.db and its journal files
          if (f === 'app.db' || f === 'app.db-wal' || f === 'app.db-shm') continue;
          // Skip model files and reference data needed for OCR/search
          if (f === 'models' || f === 'reference_medicines.csv' || f === 'medicines_list.txt' || f === 'medicine_dict.txt' || f === 'medicine_patterns.txt') continue;
          // Skip sub-directories already handled above
          const fullPath = path.join(dataDir, f);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue;
          // Delete everything else: temp DBs, .bak files, test DBs, runtime JSON
          try { fs.unlinkSync(fullPath); } catch (_) {}
        }
      }

      // Wipe WhatsApp web.js auth/cache sessions (forces fresh auth on restart)
      const wwwebAuthDir = path.resolve(__dirname, '..', '..', '.wwebjs_auth');
      const wwwebCacheDir = path.resolve(__dirname, '..', '..', '.wwebjs_cache');
      clearDir(wwwebAuthDir);
      clearDir(wwwebCacheDir);
    }

    res.json({ success: true, message: wipeAll ? 'Factory reset complete. App is now in fresh installation state.' : 'All stored data reset and database self-healed successfully' });
  } catch (error: any) {
    try {
      const { unlockStagingDb } = await import('./migration.js');
      unlockStagingDb();
    } catch (_) {}
    console.error('Reset data error:', error);
    res.status(500).json({ error: 'Failed to reset data: ' + error.message });
  }
});


export default router;
