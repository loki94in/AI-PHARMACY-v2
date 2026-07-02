// Smoke tests for utility endpoints
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

let app: express.Express;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'util-smoke-'));
  dbPath = path.join(tmpDir, 'app.db');
  await ensureSchema(dbPath);
  process.env.DB_PATH = dbPath;
  const { default: utilitiesRouter } = await import('../src/routes/utilities.js');
  app = express();
  app.use(express.json());
  app.use('/utils', utilitiesRouter);
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

async function getLastLog() {
  const { open } = await import('sqlite');
  const sqlite3 = await import('sqlite3');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  const row = await db.get('SELECT action_type, description FROM action_logs ORDER BY rowid DESC LIMIT 1');
  await db.close();
  return row;
}

test('POST /utils/backup/restore logs RESTORE_BACKUP', async () => {
  const res = await request(app).post('/utils/backup/restore');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  const log = await getLastLog();
  expect(log?.action_type).toBe('RESTORE_BACKUP');
});

test('GET /utils/test-connection generic logs TEST_CONNECTION', async () => {
  const res = await request(app).get('/utils/test-connection');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('Connection test OK');
  const log = await getLastLog();
  expect(log?.action_type).toBe('TEST_CONNECTION');
});

test('GET /utils/test-connection?service=gmail logs TEST_CONNECTION_GMAIL', async () => {
  const res = await request(app).get('/utils/test-connection').query({ service: 'gmail' });
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('Gmail test OK');
  const log = await getLastLog();
  expect(log?.action_type).toBe('TEST_CONNECTION_GMAIL');
});

test('GET /utils/test-connection?service=whatsapp logs TEST_CONNECTION_WHATSAPP', async () => {
  const res = await request(app).get('/utils/test-connection').query({ service: 'whatsapp' });
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('WhatsApp test OK');
  const log = await getLastLog();
  expect(log?.action_type).toBe('TEST_CONNECTION_WHATSAPP');
});
