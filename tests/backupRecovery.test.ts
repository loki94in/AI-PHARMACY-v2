import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { backupRecoveryService } from '../src/services/backupRecoveryService.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Backup & Recovery Service and Routes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    // Set up a temporary database in a temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    process.env.DB_PATH = dbPath;

    // Dynamically load the utilities router after setting DB_PATH
    const { default: utilitiesRouter } = await import('../src/routes/utilities.js');
    app = express();
    app.use(express.json());
    app.use('/utils', utilitiesRouter);
  });

  afterAll(() => {
    // Restore the database path environment variable and clean up temporary directory
    if (originalDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalDbPath;
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('GET /utils/backup/status retrieves status successfully', async () => {
    const res = await request(app).get('/utils/backup/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('localBackupStatus');
    expect(res.body).toHaveProperty('gdriveStatus');
    expect(res.body).toHaveProperty('telegramStatus');
    expect(res.body).toHaveProperty('totalBackupSize');
    expect(res.body).toHaveProperty('availableArchives');
  });

  test('POST /utils/backup/fresh-install sets backup_fresh_installed to true', async () => {
    const res = await request(app).post('/utils/backup/fresh-install');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Fresh installation mode set');
  });

  test('POST /utils/backup/toggle-pause toggles the isPaused state', async () => {
    const res = await request(app).post('/utils/backup/toggle-pause');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('isPaused');
    
    // Toggle back to resume normal operations
    const resResume = await request(app).post('/utils/backup/toggle-pause');
    expect(resResume.status).toBe(200);
    expect(resResume.body.success).toBe(true);
    expect(resResume.body.isPaused).toBe(false);
  });

  test('POST /utils/backup/manual creates a manual backup', async () => {
    const res = await request(app).post('/utils/backup/manual');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('archiveName');
    
    const archiveName = res.body.archiveName;
    const ARCHIVES_DIR = path.resolve(__dirname, '..', 'backup', 'archives');
    const archivePath = path.join(ARCHIVES_DIR, archiveName);
    
    expect(fs.existsSync(archivePath)).toBe(true);

    // Clean up created manual archive
    try {
      fs.unlinkSync(archivePath);
    } catch (_) {}
  });

  test('DELETE /utils/backup/archive/:filename deletes archive successfully or errors if not found', async () => {
    // Create a dummy archive file to delete
    const ARCHIVES_DIR = path.resolve(__dirname, '..', 'backup', 'archives');
    const dummyArchive = 'archive_dummy.zip';
    const dummyPath = path.join(ARCHIVES_DIR, dummyArchive);
    
    if (!fs.existsSync(ARCHIVES_DIR)) {
      fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    }
    fs.writeFileSync(dummyPath, 'dummy data');

    const res = await request(app).delete(`/utils/backup/archive/${dummyArchive}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fs.existsSync(dummyPath)).toBe(false);
  });
});
