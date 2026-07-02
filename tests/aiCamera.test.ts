import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('AI Camera Audit Routes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let auditQueuePath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicamera-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    await ensureSchema(dbPath);
    
    // Set env variables
    process.env.DB_PATH = dbPath;
    
    auditQueuePath = path.join(tmpDir, 'audit_queue.json');
    // Set initial template
    fs.writeFileSync(auditQueuePath, JSON.stringify([
      {
        id: 'audit_test_1',
        imagePath: 'data/audit_images/audit_test_1.jpg',
        rawOcrText: 'AMOXICILLIN 500',
        cloudSuggestedText: JSON.stringify({ name: 'Amoxicillin', strength: '500mg' }),
        cloudDetails: { name: 'Amoxicillin', strength: '500mg' },
        status: 'pending_human_review',
        createdAt: new Date().toISOString()
      },
      {
        id: 'audit_test_2',
        imagePath: 'data/audit_images/audit_test_2.jpg',
        rawOcrText: 'PARACETAMOL 650',
        cloudSuggestedText: '',
        cloudDetails: null,
        status: 'pending_human_review',
        createdAt: new Date().toISOString()
      }
    ], null, 2));

    const { default: aiCameraRouter } = await import('../src/routes/aiCamera.js');

    // Override the hardcoded AUDIT_QUEUE_PATH in runtime or monkey patch it
    // Wait, in aiCamera.ts we had:
    // const AUDIT_QUEUE_PATH = path.resolve(__dirname, '..', '..', 'data', 'audit_queue.json');
    // So to make the router use our test JSON file, we can temporarily rename the target file or monkey patch.
    // Actually, let's back up the real file if it exists, replace it with our test file, and restore it.
  }, 30000);

  let originalRealQueue: string | null = null;
  const realQueuePath = path.resolve(process.cwd(), 'data', 'audit_queue.json');

  beforeEach(() => {
    // Back up real queue file and write the test one
    if (fs.existsSync(realQueuePath)) {
      originalRealQueue = fs.readFileSync(realQueuePath, 'utf8');
    }
    const testQueueData = fs.readFileSync(auditQueuePath, 'utf8');
    fs.writeFileSync(realQueuePath, testQueueData);

    app = express();
    app.use(express.json());
    // Lazy load or import router
  });

  afterEach(() => {
    // Restore real queue
    if (originalRealQueue !== null) {
      fs.writeFileSync(realQueuePath, originalRealQueue);
    } else if (fs.existsSync(realQueuePath)) {
      fs.unlinkSync(realQueuePath);
    }
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('GET /api/aicamera/audit/queue returns pending audit list', async () => {
    const { default: aiCameraRouter } = await import('../src/routes/aiCamera.js');
    app.use('/api/aicamera', aiCameraRouter);

    const res = await request(app).get('/api/aicamera/audit/queue');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].id).toBe('audit_test_1');
    expect(res.body[1].id).toBe('audit_test_2');
  });

  test('POST /api/aicamera/audit/resolve action=add_to_db inserts medicine', async () => {
    const { default: aiCameraRouter } = await import('../src/routes/aiCamera.js');
    app.use('/api/aicamera', aiCameraRouter);

    const res = await request(app)
      .post('/api/aicamera/audit/resolve')
      .send({
        id: 'audit_test_1',
        name: 'Amoxicillin 500mg',
        mrp: 120,
        action: 'add_to_db'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify DB insert
    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const med = await db.get('SELECT * FROM medicines WHERE name = ?', ['Amoxicillin 500mg']);
    expect(med).toBeDefined();
    expect(med.mrp).toBe(120);
    await db.close();

    // Verify status updated in JSON
    const queueData = JSON.parse(fs.readFileSync(realQueuePath, 'utf8'));
    const entry = queueData.find((item: any) => item.id === 'audit_test_1');
    expect(entry.status).toBe('resolved');
  });

  test('POST /api/aicamera/audit/resolve action=dismiss marks as dismissed', async () => {
    const { default: aiCameraRouter } = await import('../src/routes/aiCamera.js');
    app.use('/api/aicamera', aiCameraRouter);

    const res = await request(app)
      .post('/api/aicamera/audit/resolve')
      .send({
        id: 'audit_test_2',
        action: 'dismiss'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify status updated to dismissed in JSON
    const queueData = JSON.parse(fs.readFileSync(realQueuePath, 'utf8'));
    const entry = queueData.find((item: any) => item.id === 'audit_test_2');
    expect(entry.status).toBe('dismissed');
  });

  test('DELETE /api/aicamera/audit/:id removes item from list', async () => {
    const { default: aiCameraRouter } = await import('../src/routes/aiCamera.js');
    app.use('/api/aicamera', aiCameraRouter);

    const res = await request(app).delete('/api/aicamera/audit/audit_test_1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const queueData = JSON.parse(fs.readFileSync(realQueuePath, 'utf8'));
    const entry = queueData.find((item: any) => item.id === 'audit_test_1');
    expect(entry).toBeUndefined();
  });
});
