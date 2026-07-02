import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import express from 'express';

describe('API Auth Middleware', () => {
  let app: express.Express;
  let originalNodeEnv: string | undefined;
  let dbPath: string;
  let dbManager: any;
  let authenticateApiKey: any;

  beforeAll(async () => {
    // Generate a unique dynamic path and set env var FIRST!
    dbPath = path.join(os.tmpdir(), `auth-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;

    // Run ensureSchema to create tables
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    // Dynamically load the modules so they read the newly set process.env.DB_PATH
    const conn = await import('../src/database/connection.js');
    dbManager = conn.dbManager;

    const auth = await import('../src/middleware/auth.js');
    authenticateApiKey = auth.authenticateApiKey;

    originalNodeEnv = process.env.NODE_ENV;
    app = express();
    app.use(express.json());
    app.get('/test-api', authenticateApiKey, (req, res) => {
      res.json({
        success: true,
        user: (req as any).user,
        session: (req as any).session
      });
    });
  });

  afterAll(async () => {
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {}
  });

  afterEach(async () => {
    delete process.env.API_KEY;
    delete process.env.SKIP_AUTH;
    process.env.NODE_ENV = originalNodeEnv || 'test';
    // Clean up session token
    try {
      const db = await dbManager.getConnection();
      await db.run("DELETE FROM app_settings WHERE key = 'license_session_token'");
      await dbManager.close();
    } catch (_) {}
  });

  test('should bypass authentication when NODE_ENV is test and inject mock user/session', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SKIP_AUTH = 'true';
    const res = await request(app).get('/test-api');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({ id: 'mock-dev-user', name: 'Mock Dev User', role: 'admin' });
    expect(res.body.session).toEqual({ token: 'mock-dev-session-token', isValid: true });
  });

  test('should block request without api key when NODE_ENV is not test', async () => {
    process.env.NODE_ENV = 'production';
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('license_session_token', 'secure-key-abc')");
    await dbManager.close();

    const res = await request(app).get('/test-api');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  test('should allow request with valid X-API-Key', async () => {
    process.env.NODE_ENV = 'production';
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('license_session_token', 'secure-key-abc')");
    await dbManager.close();

    const res = await request(app)
      .get('/test-api')
      .set('x-api-key', 'secure-key-abc');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should fallback to Pass@123 if API_KEY is not defined', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.API_KEY;
    // No session token in DB — middleware falls back to config.apiKey ('Pass@123')
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM app_settings WHERE key = 'license_session_token'");
    await dbManager.close();

    const res = await request(app)
      .get('/test-api')
      .set('x-api-key', 'Pass@123');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
