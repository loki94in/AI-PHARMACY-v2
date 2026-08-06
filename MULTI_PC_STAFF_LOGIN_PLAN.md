# Multi-PC Staff Login & Role-Based Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-staff username/password login (Admin / Cashier roles) on top of the existing single-instance license auth, so that when multiple PCs on the same LAN point their browsers at the host PC's server, every action is attributed to a real staff member, and Stock Adjustment + Purchase Bill entry are restricted to the Admin role regardless of which PC they're performed from.

**Architecture:** The app is a single Node/Express server (`src/server.ts`) + React SPA already reachable from any LAN device (CORS in `server.ts` already allows private LAN origins — verified, no change needed there). This plan adds a second, independent auth layer on top of the existing license/session-token gate (`authenticateApiKey` in `src/middleware/auth.ts`, unchanged): a `staff_users` table, a per-browser session token (`x-staff-token` header, mirroring the existing `x-session-token` header convention), and `requireRole()` middleware applied to the two write endpoints that must stay Admin-only. All writes continue to go straight to the host's single SQLite database in real time — no local buffering, no sync layer, consistent with the existing strict-inventory-only-sales design.

**Tech Stack:** Node's built-in `crypto` module for password hashing (scrypt) — no new npm dependency. `better-sqlite3`/`sqlite` (existing). Express middleware (existing pattern). React Context for frontend auth state (existing pattern used elsewhere in the app, e.g. `useFetchMode` hook style). No new frontend dependencies.

## Global Constraints

- No new npm dependencies — use Node's built-in `crypto` (scrypt) for password hashing and `crypto.randomBytes` for session tokens, matching the codebase's existing hand-rolled-token style (see `push_tokens` / `device_connection_logs` in `src/database.ts`).
- This is a **second, independent layer** on top of the existing license/session-token system. Do not remove, weaken, or bypass `authenticateApiKey` in `src/middleware/auth.ts`. Do not touch `src/routes/security.ts` (`/api/security/admin/login`) — it is a separate, unrelated legacy "remote device" mechanism with its own known issues (hardcoded fallback credentials) tracked elsewhere; this plan does not fix or reuse it.
- Every schema change must bump `CURRENT_SCHEMA_VERSION` in `src/database.ts` (currently `30`) — the boot sequence has a fast-path that **skips the entire DDL block** if the stored `schema_version` is already ≥ `CURRENT_SCHEMA_VERSION`. Forgetting the bump means the new tables silently never get created on any install that already booted once.
- Frontend has no component test harness (`frontend/**/*.test.tsx` does not exist, no Vitest/RTL configured) — frontend tasks in this plan end in a manual verification checklist, not automated tests. Backend tasks use the existing `jest` + `supertest` pattern seen in `tests/auth.test.ts`.
- Restriction basis is **role, not physical PC** (per confirmed decision): an Admin-role login can adjust stock or enter purchases from any PC on the LAN; a Cashier-role login cannot, even from the host PC itself.
- Restricted pages stay **visible but locked** for Cashier logins (not hidden from navigation) — confirmed decision.
- Sessions do **not** expire on idle — confirmed decision. They end only on explicit logout.
- Staff picks a role from a **preset dropdown** (`admin` / `cashier`) when the Admin creates an account — confirmed decision, not a per-permission checklist.
- The first Admin account is created via a **first-run setup screen**, not shipped with default credentials — confirmed decision.

---

## File Structure

New files:
- `src/utils/staffPassword.ts` — password hash/verify (scrypt)
- `src/middleware/staffAuth.ts` — session resolution + role-gate middleware
- `src/routes/staffAuth.ts` — login/logout/me/setup + staff account CRUD
- `tests/staffPassword.test.ts`
- `tests/staffSchema.test.ts`
- `tests/staffAuth.test.ts`
- `tests/staffPermissions.test.ts` (protected-route enforcement)
- `frontend/src/contexts/StaffAuthContext.tsx` — current staff user/role, login/logout
- `frontend/src/pages/StaffLogin/index.tsx` — first-run setup + login screen

Modified files:
- `src/database.ts` — new tables, new `action_logs` columns, schema version bump
- `src/server.ts` — register `attachStaffUser` middleware + `/api/staff-auth` route
- `src/routes/investigation.ts` — guard `PUT /inventory/:inventoryId` with `requireRole('admin')`
- `src/routes/purchases.ts` — guard `POST /manual`, `PUT /:id/full`, `DELETE /:id` with `requireRole('admin')`
- `frontend/src/services/api.ts` — attach `x-staff-token` header, add staff-auth API functions
- `frontend/src/App.tsx` — gate the app behind `StaffAuthContext` (render `StaffLogin` if not logged in)
- `frontend/src/pages/Settings/index.tsx` — new "Staff" tab (list/create/disable accounts)
- `frontend/src/pages/Investigation/index.tsx` — lock the "Adjust" / "Save Stock Adjustments" actions for non-admin
- `frontend/src/pages/Purchases/index.tsx` — lock the "Save Purchase" action for non-admin

---

### Task 1: Password hashing utility

**Files:**
- Create: `src/utils/staffPassword.ts`
- Test: `tests/staffPassword.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): string`, `verifyPassword(password: string, storedHash: string): boolean` — used by Task 4 (login/setup routes).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/staffPassword.test.ts
import { hashPassword, verifyPassword } from '../src/utils/staffPassword.js';

describe('staffPassword', () => {
  test('verifyPassword returns true for the correct password', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  test('verifyPassword returns false for an incorrect password', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  test('two hashes of the same password are not identical (random salt)', () => {
    const hashA = hashPassword('same-password');
    const hashB = hashPassword('same-password');
    expect(hashA).not.toBe(hashB);
  });

  test('verifyPassword returns false for a malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffPassword.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/staffPassword.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/staffPassword.ts
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  const storedKey = Buffer.from(hashHex, 'hex');
  if (storedKey.length !== derivedKey.length) return false;
  return timingSafeEqual(storedKey, derivedKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffPassword.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/utils/staffPassword.ts tests/staffPassword.test.ts
git commit -m "feat: add scrypt-based staff password hashing utility"
```

---

### Task 2: Database schema — staff_users, staff_sessions, action_logs attribution

**Files:**
- Modify: `src/database.ts:5` (version bump), `src/database.ts:374` (new tables inside the existing `db.exec` block), `src/database.ts:825` (new `alterStatements` entries)
- Test: `tests/staffSchema.test.ts`

**Interfaces:**
- Produces: `staff_users` table (`id, name, username, password_hash, role, is_active, created_at`), `staff_sessions` table (`token, staff_user_id, created_at, last_seen`), `action_logs.staff_user_id` / `action_logs.staff_name` columns — consumed by Task 3 (middleware), Task 4 (routes), Task 6 (audit tagging).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/staffSchema.test.ts
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('staff login schema', () => {
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `staff-schema-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);
  });

  afterAll(() => {
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });

  test('creates staff_users table with expected columns', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const columns = await db.all('PRAGMA table_info(staff_users)');
    const names = columns.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'name', 'username', 'password_hash', 'role', 'is_active', 'created_at']));
  });

  test('creates staff_sessions table with expected columns', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const columns = await db.all('PRAGMA table_info(staff_sessions)');
    const names = columns.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['token', 'staff_user_id', 'created_at', 'last_seen']));
  });

  test('adds staff_user_id and staff_name columns to action_logs', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const columns = await db.all('PRAGMA table_info(action_logs)');
    const names = columns.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['staff_user_id', 'staff_name']));
  });

  test('rejects an invalid role via the CHECK constraint', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await expect(
      db.run(
        "INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)",
        ['Bad Role', 'badrole', 'x:y', 'superadmin']
      )
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffSchema.test.ts`
Expected: FAIL — `PRAGMA table_info(staff_users)` returns an empty array, so the `arrayContaining` assertions fail.

- [ ] **Step 3: Implement the schema changes**

In `src/database.ts:5`, bump the version so the DDL block isn't skipped on existing installs:

```typescript
const CURRENT_SCHEMA_VERSION = 31;
```

In `src/database.ts`, inside the existing `db.exec(\`...\`)` block, immediately after the `settings` table definition (currently ends at line 374 with `);`), add:

```sql
    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'cashier')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_sessions (
      token TEXT PRIMARY KEY,
      staff_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_user_id) REFERENCES staff_users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions (staff_user_id);
```

In `src/database.ts:825`, add two entries to the existing `alterStatements` array (the one with the `// Pre-check PRAGMA table_info before ALTER TABLE ADD COLUMN` comment above it):

```typescript
    ['action_logs', 'staff_user_id', 'ALTER TABLE action_logs ADD COLUMN staff_user_id INTEGER DEFAULT NULL'],
    ['action_logs', 'staff_name', 'ALTER TABLE action_logs ADD COLUMN staff_name TEXT DEFAULT NULL'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffSchema.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/database.ts tests/staffSchema.test.ts
git commit -m "feat: add staff_users/staff_sessions tables and action_logs attribution columns (schema v31)"
```

---

### Task 3: Staff session middleware

**Files:**
- Create: `src/middleware/staffAuth.ts`
- Test: `tests/staffAuth.test.ts`

**Interfaces:**
- Consumes: `dbManager.getConnection()` from `src/database/connection.js` (existing); `staff_users`/`staff_sessions` tables from Task 2.
- Produces: `attachStaffUser` (Express middleware, non-blocking — resolves `req.staffUser` if a valid token is present, otherwise leaves it undefined and calls `next()`), `requireStaffLogin` (blocking — 401 if no `req.staffUser`), `requireRole(...roles)` (blocking — 401/403), and the `StaffUser` type — consumed by Task 4 (routes), Task 6 (protecting stock/purchase routes), Task 7 (registration in `server.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/staffAuth.test.ts
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import express from 'express';

describe('staff auth middleware', () => {
  let app: express.Express;
  let dbPath: string;
  let dbManager: any;
  let attachStaffUser: any;
  let requireStaffLogin: any;
  let requireRole: any;
  let hashPassword: any;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `staff-auth-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    const conn = await import('../src/database/connection.js');
    dbManager = conn.dbManager;

    const mw = await import('../src/middleware/staffAuth.js');
    attachStaffUser = mw.attachStaffUser;
    requireStaffLogin = mw.requireStaffLogin;
    requireRole = mw.requireRole;

    const pw = await import('../src/utils/staffPassword.js');
    hashPassword = pw.hashPassword;

    app = express();
    app.use(express.json());
    app.use(attachStaffUser);
    app.get('/whoami', (req, res) => res.json({ staffUser: (req as any).staffUser || null }));
    app.get('/admin-only', requireStaffLogin, requireRole('admin'), (req, res) => res.json({ ok: true }));
  });

  afterAll(() => {
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });

  async function createStaffAndSession(role: 'admin' | 'cashier') {
    const db = await dbManager.getConnection();
    const result = await db.run(
      'INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [`${role} user`, `${role}-${Date.now()}`, hashPassword('irrelevant'), role]
    );
    const token = `test-token-${role}-${Date.now()}`;
    await db.run('INSERT INTO staff_sessions (token, staff_user_id) VALUES (?, ?)', [token, result.lastID]);
    return token;
  }

  test('leaves staffUser undefined when no token header is sent', async () => {
    const res = await request(app).get('/whoami');
    expect(res.body.staffUser).toBeNull();
  });

  test('resolves staffUser from a valid x-staff-token', async () => {
    const token = await createStaffAndSession('cashier');
    const res = await request(app).get('/whoami').set('x-staff-token', token);
    expect(res.body.staffUser.role).toBe('cashier');
  });

  test('requireStaffLogin blocks when no session is attached', async () => {
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
  });

  test('requireRole blocks a cashier from an admin-only route', async () => {
    const token = await createStaffAndSession('cashier');
    const res = await request(app).get('/admin-only').set('x-staff-token', token);
    expect(res.status).toBe(403);
  });

  test('requireRole allows an admin through', async () => {
    const token = await createStaffAndSession('admin');
    const res = await request(app).get('/admin-only').set('x-staff-token', token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffAuth.test.ts`
Expected: FAIL — `Cannot find module '../src/middleware/staffAuth.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/middleware/staffAuth.ts
import { Request, Response, NextFunction } from 'express';
import { dbManager } from '../database/connection.js';

export interface StaffUser {
  id: number;
  name: string;
  username: string;
  role: 'admin' | 'cashier';
}

/**
 * Resolves the staff session from the x-staff-token header, if present.
 * Never blocks the request — routes that require a logged-in staff member
 * must chain requireStaffLogin / requireRole after this.
 */
export async function attachStaffUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers['x-staff-token'];
  if (!token || typeof token !== 'string') return next();

  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      `SELECT su.id, su.name, su.username, su.role
       FROM staff_sessions ss
       JOIN staff_users su ON su.id = ss.staff_user_id
       WHERE ss.token = ? AND su.is_active = 1`,
      [token]
    );
    if (row) {
      (req as any).staffUser = row as StaffUser;
      db.run('UPDATE staff_sessions SET last_seen = CURRENT_TIMESTAMP WHERE token = ?', [token]).catch(() => {});
    }
  } catch (err) {
    console.error('[staffAuth] Failed to resolve staff session:', err);
  }
  next();
}

export function requireStaffLogin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).staffUser) {
    return res.status(401).json({ error: 'Staff login required.' });
  }
  next();
}

export function requireRole(...roles: Array<'admin' | 'cashier'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const staffUser = (req as any).staffUser as StaffUser | undefined;
    if (!staffUser) {
      return res.status(401).json({ error: 'Staff login required.' });
    }
    if (!roles.includes(staffUser.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffAuth.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/staffAuth.ts tests/staffAuth.test.ts
git commit -m "feat: add staff session middleware (attachStaffUser, requireStaffLogin, requireRole)"
```

---

### Task 4: Staff auth routes — setup, login, logout, me, account management

**Files:**
- Create: `src/routes/staffAuth.ts`
- Modify: `src/server.ts:211` (register `attachStaffUser`), `src/server.ts:215` area (register the route)
- Test: `tests/staffAuthRoutes.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 1), `staff_users`/`staff_sessions` tables (Task 2), `requireStaffLogin`/`requireRole` (Task 3).
- Produces: `POST /api/staff-auth/setup` (first admin only), `GET /api/staff-auth/setup-required`, `POST /api/staff-auth/login`, `POST /api/staff-auth/logout`, `GET /api/staff-auth/me`, `GET /api/staff-auth/users` (admin), `POST /api/staff-auth/users` (admin), `PUT /api/staff-auth/users/:id` (admin) — consumed by Task 7/8/9 (frontend).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/staffAuthRoutes.test.ts
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import express from 'express';

describe('staff auth routes', () => {
  let app: express.Express;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `staff-auth-routes-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;
    process.env.NODE_ENV = 'test';

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    const { attachStaffUser } = await import('../src/middleware/staffAuth.js');
    const staffAuthRoutes = (await import('../src/routes/staffAuth.js')).default;

    app = express();
    app.use(express.json());
    app.use(attachStaffUser);
    app.use('/api/staff-auth', staffAuthRoutes);
  });

  afterAll(() => {
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });

  test('setup-required is true before any admin exists', async () => {
    const res = await request(app).get('/api/staff-auth/setup-required');
    expect(res.body.setupRequired).toBe(true);
  });

  test('setup creates the first admin and rejects a second attempt', async () => {
    const res = await request(app)
      .post('/api/staff-auth/setup')
      .send({ name: 'Owner', username: 'owner', password: 'ownerpass123' });
    expect(res.status).toBe(200);
    expect(res.body.staffUser.role).toBe('admin');

    const second = await request(app)
      .post('/api/staff-auth/setup')
      .send({ name: 'Other', username: 'other', password: 'irrelevant123' });
    expect(second.status).toBe(409);
  });

  test('setup-required is false after the first admin exists', async () => {
    const res = await request(app).get('/api/staff-auth/setup-required');
    expect(res.body.setupRequired).toBe(false);
  });

  test('login rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/staff-auth/login')
      .send({ username: 'owner', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('login succeeds and returns a token; /me resolves it', async () => {
    const login = await request(app)
      .post('/api/staff-auth/login')
      .send({ username: 'owner', password: 'ownerpass123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const me = await request(app).get('/api/staff-auth/me').set('x-staff-token', login.body.token);
    expect(me.body.staffUser.username).toBe('owner');
    expect(me.body.staffUser.role).toBe('admin');
  });

  test('admin can create a cashier account; cashier cannot create accounts', async () => {
    const login = await request(app)
      .post('/api/staff-auth/login')
      .send({ username: 'owner', password: 'ownerpass123' });
    const adminToken = login.body.token;

    const createCashier = await request(app)
      .post('/api/staff-auth/users')
      .set('x-staff-token', adminToken)
      .send({ name: 'Counter Staff', username: 'cashier1', password: 'cashierpass123', role: 'cashier' });
    expect(createCashier.status).toBe(200);

    const cashierLogin = await request(app)
      .post('/api/staff-auth/login')
      .send({ username: 'cashier1', password: 'cashierpass123' });
    const cashierToken = cashierLogin.body.token;

    const blocked = await request(app)
      .post('/api/staff-auth/users')
      .set('x-staff-token', cashierToken)
      .send({ name: 'Should Fail', username: 'nope', password: 'irrelevant123', role: 'cashier' });
    expect(blocked.status).toBe(403);
  });

  test('logout invalidates the token', async () => {
    const login = await request(app)
      .post('/api/staff-auth/login')
      .send({ username: 'owner', password: 'ownerpass123' });
    const token = login.body.token;

    await request(app).post('/api/staff-auth/logout').set('x-staff-token', token);

    const me = await request(app).get('/api/staff-auth/me').set('x-staff-token', token);
    expect(me.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffAuthRoutes.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/staffAuth.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/routes/staffAuth.ts
import express from 'express';
import { randomBytes } from 'crypto';
import { dbManager } from '../database/connection.js';
import { hashPassword, verifyPassword } from '../utils/staffPassword.js';
import { requireStaffLogin, requireRole } from '../middleware/staffAuth.js';

const router = express.Router();

router.get('/setup-required', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT COUNT(*) as c FROM staff_users');
    res.json({ setupRequired: !row || row.c === 0 });
  } catch (err: any) {
    console.error('[staffAuth] setup-required error:', err);
    res.status(500).json({ error: 'Failed to check setup status.' });
  }
});

router.post('/setup', async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT COUNT(*) as c FROM staff_users');
    if (existing && existing.c > 0) {
      return res.status(409).json({ error: 'Setup already completed — an admin account already exists.' });
    }
    const passwordHash = hashPassword(password);
    const result = await db.run(
      'INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, username, passwordHash, 'admin']
    );
    await db.run('INSERT INTO action_logs (action_type, description, staff_user_id, staff_name) VALUES (?, ?, ?, ?)',
      ['STAFF_SETUP', `First admin account "${username}" created`, result.lastID, name]);
    res.json({ success: true, staffUser: { id: result.lastID, name, username, role: 'admin' } });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    console.error('[staffAuth] setup error:', err);
    res.status(500).json({ error: 'Failed to create admin account.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }
  try {
    const db = await dbManager.getConnection();
    const user = await db.get(
      'SELECT id, name, username, password_hash, role FROM staff_users WHERE username = ? AND is_active = 1',
      [username]
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = randomBytes(32).toString('hex');
    await db.run('INSERT INTO staff_sessions (token, staff_user_id) VALUES (?, ?)', [token, user.id]);
    await db.run('INSERT INTO action_logs (action_type, description, staff_user_id, staff_name) VALUES (?, ?, ?, ?)',
      ['STAFF_LOGIN', `"${user.name}" logged in`, user.id, user.name]);
    res.json({ success: true, token, staffUser: { id: user.id, name: user.name, username: user.username, role: user.role } });
  } catch (err: any) {
    console.error('[staffAuth] login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', requireStaffLogin, async (req, res) => {
  try {
    const token = req.headers['x-staff-token'] as string;
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM staff_sessions WHERE token = ?', [token]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[staffAuth] logout error:', err);
    res.status(500).json({ error: 'Logout failed.' });
  }
});

router.get('/me', requireStaffLogin, (req, res) => {
  res.json({ staffUser: (req as any).staffUser });
});

router.get('/users', requireStaffLogin, requireRole('admin'), async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const users = await db.all('SELECT id, name, username, role, is_active, created_at FROM staff_users ORDER BY created_at ASC');
    res.json({ users });
  } catch (err: any) {
    console.error('[staffAuth] list users error:', err);
    res.status(500).json({ error: 'Failed to load staff accounts.' });
  }
});

router.post('/users', requireStaffLogin, requireRole('admin'), async (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, and role are required.' });
  }
  if (!['admin', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or cashier.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const db = await dbManager.getConnection();
    const passwordHash = hashPassword(password);
    const result = await db.run(
      'INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, username, passwordHash, role]
    );
    const actor = (req as any).staffUser;
    await db.run('INSERT INTO action_logs (action_type, description, staff_user_id, staff_name) VALUES (?, ?, ?, ?)',
      ['STAFF_CREATED', `"${actor.name}" created staff account "${username}" (${role})`, actor.id, actor.name]);
    res.json({ success: true, staffUser: { id: result.lastID, name, username, role } });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    console.error('[staffAuth] create user error:', err);
    res.status(500).json({ error: 'Failed to create staff account.' });
  }
});

router.put('/users/:id', requireStaffLogin, requireRole('admin'), async (req, res) => {
  const staffId = parseInt(req.params.id, 10);
  const { name, role, is_active, password } = req.body || {};
  if (role && !['admin', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or cashier.' });
  }
  try {
    const db = await dbManager.getConnection();
    const target = await db.get('SELECT id FROM staff_users WHERE id = ?', [staffId]);
    if (!target) {
      return res.status(404).json({ error: 'Staff account not found.' });
    }
    if (typeof name === 'string' && name.trim()) {
      await db.run('UPDATE staff_users SET name = ? WHERE id = ?', [name.trim(), staffId]);
    }
    if (role) {
      await db.run('UPDATE staff_users SET role = ? WHERE id = ?', [role, staffId]);
    }
    if (typeof is_active === 'number') {
      await db.run('UPDATE staff_users SET is_active = ? WHERE id = ?', [is_active, staffId]);
      if (is_active === 0) {
        await db.run('DELETE FROM staff_sessions WHERE staff_user_id = ?', [staffId]);
      }
    }
    if (typeof password === 'string' && password.length >= 8) {
      await db.run('UPDATE staff_users SET password_hash = ? WHERE id = ?', [hashPassword(password), staffId]);
    }
    const actor = (req as any).staffUser;
    await db.run('INSERT INTO action_logs (action_type, description, staff_user_id, staff_name) VALUES (?, ?, ?, ?)',
      ['STAFF_UPDATED', `"${actor.name}" updated staff account #${staffId}`, actor.id, actor.name]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[staffAuth] update user error:', err);
    res.status(500).json({ error: 'Failed to update staff account.' });
  }
});

export default router;
```

Register in `src/server.ts`. Change line 211 from:

```typescript
app.use('/api', authenticateApiKey);
```

to:

```typescript
app.use('/api', authenticateApiKey);

// Resolves req.staffUser from x-staff-token, if present. Non-blocking —
// individual routes opt into requireStaffLogin / requireRole.
const { attachStaffUser } = await import('./middleware/staffAuth.js');
app.use('/api', attachStaffUser);
```

`server.ts` is not top-level `await`-friendly mid-file in its current form — instead, add the import at the top with the other static imports and call it directly (simpler, matches existing style):

At `src/server.ts:11`, change:

```typescript
import { authenticateApiKey } from './middleware/auth.js';
```

to:

```typescript
import { authenticateApiKey } from './middleware/auth.js';
import { attachStaffUser } from './middleware/staffAuth.js';
```

Then at line 211:

```typescript
app.use('/api', authenticateApiKey);
app.use('/api', attachStaffUser);
```

Then add the route registration alongside the other `/api/*` registrations (near line 215):

```typescript
app.use('/api/staff-auth', lazyRoute(() => import('./routes/staffAuth.js')));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffAuthRoutes.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Run the full existing test suite to check for regressions**

Run: `npm test`
Expected: No new failures beyond the pre-existing unrelated failing suites (see project memory: ~16 suites already fail on main with unrelated "no such table" setup errors).

- [ ] **Step 6: Commit**

```bash
git add src/routes/staffAuth.ts src/server.ts tests/staffAuthRoutes.test.ts
git commit -m "feat: add staff login/logout/me and staff account management routes"
```

---

### Task 5: Protect Stock Adjustment and Purchase Bill routes with requireRole('admin')

**Files:**
- Modify: `src/routes/investigation.ts:728` (`router.put('/inventory/:inventoryId', ...)`)
- Modify: `src/routes/purchases.ts:736` (`router.post('/manual', ...)`), `src/routes/purchases.ts:1115` (`router.put('/:id/full', ...)`), `src/routes/purchases.ts:1355` (`router.put('/:id', ...)`)
- Test: `tests/staffPermissions.test.ts`

**Interfaces:**
- Consumes: `requireStaffLogin`, `requireRole` from Task 3.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/staffPermissions.test.ts
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import express from 'express';

describe('role-gated write routes', () => {
  let app: express.Express;
  let dbPath: string;
  let dbManager: any;
  let hashPassword: any;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `staff-permissions-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;
    process.env.NODE_ENV = 'test';

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    const conn = await import('../src/database/connection.js');
    dbManager = conn.dbManager;

    const pw = await import('../src/utils/staffPassword.js');
    hashPassword = pw.hashPassword;

    const { attachStaffUser } = await import('../src/middleware/staffAuth.js');
    const investigationRoutes = (await import('../src/routes/investigation.js')).default;
    const purchasesRoutes = (await import('../src/routes/purchases.js')).default;

    app = express();
    app.use(express.json());
    app.use(attachStaffUser);
    app.use('/api/investigation', investigationRoutes);
    app.use('/api/purchases', purchasesRoutes);

    const db = await dbManager.getConnection();
    const admin = await db.run(
      'INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Admin', 'perm-admin', hashPassword('x'), 'admin']
    );
    adminToken = `admin-token-${Date.now()}`;
    await db.run('INSERT INTO staff_sessions (token, staff_user_id) VALUES (?, ?)', [adminToken, admin.lastID]);

    const cashier = await db.run(
      'INSERT INTO staff_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Cashier', 'perm-cashier', hashPassword('x'), 'cashier']
    );
    cashierToken = `cashier-token-${Date.now()}`;
    await db.run('INSERT INTO staff_sessions (token, staff_user_id) VALUES (?, ?)', [cashierToken, cashier.lastID]);
  });

  afterAll(() => {
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });

  test('cashier cannot adjust stock', async () => {
    const res = await request(app)
      .put('/api/investigation/inventory/1')
      .set('x-staff-token', cashierToken)
      .send({ quantity: 10 });
    expect(res.status).toBe(403);
  });

  test('cashier cannot create a manual purchase', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .set('x-staff-token', cashierToken)
      .send({});
    expect(res.status).toBe(403);
  });

  test('an unauthenticated request is rejected (401), not silently allowed', async () => {
    const res = await request(app).post('/api/purchases/manual').send({});
    expect(res.status).toBe(401);
  });

  test('admin request passes the role gate (may still 4xx/5xx deeper in the handler for other reasons, but not 401/403)', async () => {
    const res = await request(app)
      .post('/api/purchases/manual')
      .set('x-staff-token', adminToken)
      .send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffPermissions.test.ts`
Expected: FAIL — cashier requests currently succeed (200/whatever the handler returns) instead of 403, since no role gate exists yet.

- [ ] **Step 3: Add the role gate**

In `src/routes/investigation.ts`, add the import near the top of the file (alongside the existing imports):

```typescript
import { requireStaffLogin, requireRole } from '../middleware/staffAuth.js';
```

Change line 728 from:

```typescript
router.put('/inventory/:inventoryId', async (req, res) => {
```

to:

```typescript
router.put('/inventory/:inventoryId', requireStaffLogin, requireRole('admin'), async (req, res) => {
```

In `src/routes/purchases.ts`, add the same import near the top of the file, then apply the same pattern to the three write endpoints:

Line 736, change:
```typescript
router.post('/manual', async (req, res) => {
```
to:
```typescript
router.post('/manual', requireStaffLogin, requireRole('admin'), async (req, res) => {
```

Line 1115, change:
```typescript
router.put('/:id/full', async (req, res) => {
```
to:
```typescript
router.put('/:id/full', requireStaffLogin, requireRole('admin'), async (req, res) => {
```

Line 1355, change:
```typescript
router.put('/:id', async (req, res) => {
```
to:
```typescript
router.put('/:id', requireStaffLogin, requireRole('admin'), async (req, res) => {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/staffPermissions.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Run the full existing purchases/investigation test suites to check for regressions**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/investigation.test.ts tests/investigationDelta.test.ts`

If any existing test in those files calls these three routes directly via `supertest` without a staff session, it will now fail with 401 — that test needs a `.set('x-staff-token', <token-created-in-that-test's-setup>)` added, following the same `beforeAll` pattern used in `tests/staffPermissions.test.ts` above (create a staff user + session row, then attach the token to the request). Fix any such failures inline before proceeding — do not weaken the new gate to make old tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/investigation.ts src/routes/purchases.ts tests/staffPermissions.test.ts
git commit -m "feat: restrict stock adjustment and purchase bill writes to the admin role"
```

---

### Task 6: Frontend — attach staff token to every API request

**Files:**
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces: `staffAuthApi.login(username, password)`, `staffAuthApi.logout()`, `staffAuthApi.me()`, `staffAuthApi.setupRequired()`, `staffAuthApi.setup(...)`, `staffAuthApi.listUsers()`, `staffAuthApi.createUser(...)`, `staffAuthApi.updateUser(id, ...)` — consumed by Task 7 (`StaffAuthContext`) and Task 8/9 (UI).
- Consumes: existing `apiClient` axios instance (`frontend/src/services/api.ts:6`).

- [ ] **Step 1: Add the request interceptor for the staff token**

Immediately after the existing `apiClient` request interceptor that attaches `x-session-token` (the block around `frontend/src/services/api.ts:100`, containing `config.headers['x-session-token'] = token;`), add a second interceptor:

```typescript
apiClient.interceptors.request.use((config) => {
  try {
    const staffToken = localStorage.getItem('staff_session_token');
    if (staffToken) {
      config.headers = config.headers || {};
      config.headers['x-staff-token'] = staffToken;
    }
  } catch {
    // localStorage unavailable
  }
  return config;
});
```

- [ ] **Step 2: Add the staff-auth API functions**

Add near the other grouped API exports in `frontend/src/services/api.ts` (matching the existing flat-object style used for `api.getPurchase`, `api.createManualPurchase`, etc. — same `api` export object):

```typescript
  staffSetupRequired: () => apiClient.get('/staff-auth/setup-required').then(res => res.data),
  staffSetup: (data: { name: string; username: string; password: string }) =>
    apiClient.post('/staff-auth/setup', data).then(res => res.data),
  staffLogin: (username: string, password: string) =>
    apiClient.post('/staff-auth/login', { username, password }).then(res => res.data),
  staffLogout: () => apiClient.post('/staff-auth/logout').then(res => res.data),
  staffMe: () => apiClient.get('/staff-auth/me').then(res => res.data),
  listStaffUsers: () => apiClient.get('/staff-auth/users').then(res => res.data),
  createStaffUser: (data: { name: string; username: string; password: string; role: 'admin' | 'cashier' }) =>
    apiClient.post('/staff-auth/users', data).then(res => res.data),
  updateStaffUser: (id: number, data: Partial<{ name: string; role: 'admin' | 'cashier'; is_active: number; password: string }>) =>
    apiClient.put(`/staff-auth/users/${id}`, data).then(res => res.data),
```

- [ ] **Step 3: Manual verification**

Run `npm run dev` (or `npm run dev:client` + `npm run dev:server`). Open the browser devtools Network tab, trigger any existing API call (e.g. load the Inventory page), and confirm the request still succeeds — the new interceptor must not throw or break existing requests when `staff_session_token` isn't set yet (it shouldn't be, until Task 8 is done).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add staff-auth API client functions and x-staff-token request interceptor"
```

---

### Task 7: Frontend — StaffAuthContext

**Files:**
- Create: `frontend/src/contexts/StaffAuthContext.tsx`

**Interfaces:**
- Consumes: `api.staffMe`, `api.staffLogin`, `api.staffLogout`, `api.staffSetupRequired`, `api.staffSetup` from Task 6.
- Produces: `<StaffAuthProvider>`, `useStaffAuth()` returning `{ staffUser, loading, setupRequired, login(username, password), logout(), completeSetup(name, username, password) }` — consumed by Task 8 (`App.tsx`, `StaffLogin`) and Task 9/10 (role-gated UI).

- [ ] **Step 1: Write the implementation**

```typescript
// frontend/src/contexts/StaffAuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export interface StaffUser {
  id: number;
  name: string;
  username: string;
  role: 'admin' | 'cashier';
}

interface StaffAuthValue {
  staffUser: StaffUser | null;
  loading: boolean;
  setupRequired: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  completeSetup: (name: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
}

const StaffAuthContext = createContext<StaffAuthValue | null>(null);

export const StaffAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const setupRes = await api.staffSetupRequired();
      if (setupRes?.setupRequired) {
        setSetupRequired(true);
        setStaffUser(null);
        return;
      }
      setSetupRequired(false);

      const token = localStorage.getItem('staff_session_token');
      if (!token) {
        setStaffUser(null);
        return;
      }
      const meRes = await api.staffMe();
      setStaffUser(meRes?.staffUser || null);
    } catch {
      setStaffUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await api.staffLogin(username, password);
      if (res?.token) {
        localStorage.setItem('staff_session_token', res.token);
        setStaffUser(res.staffUser);
        return { success: true };
      }
      return { success: false, error: 'Login failed.' };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error || 'Login failed.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.staffLogout();
    } catch {
      // proceed with local logout even if the server call fails
    }
    localStorage.removeItem('staff_session_token');
    setStaffUser(null);
  }, []);

  const completeSetup = useCallback(async (name: string, username: string, password: string) => {
    try {
      await api.staffSetup({ name, username, password });
      setSetupRequired(false);
      return login(username, password);
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error || 'Setup failed.' };
    }
  }, [login]);

  return (
    <StaffAuthContext.Provider value={{ staffUser, loading, setupRequired, login, logout, completeSetup }}>
      {children}
    </StaffAuthContext.Provider>
  );
};

export function useStaffAuth(): StaffAuthValue {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) throw new Error('useStaffAuth must be used within a StaffAuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Manual verification**

This is a context with no consumers yet — nothing renders differently. Confirm it compiles: run `npm run build:client` and check for TypeScript errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/contexts/StaffAuthContext.tsx
git commit -m "feat: add StaffAuthContext for staff login state"
```

---

### Task 8: Frontend — Login / first-run setup screen, gate the app

**Files:**
- Create: `frontend/src/pages/StaffLogin/index.tsx`
- Modify: `frontend/src/App.tsx` (wrap with `StaffAuthProvider`, render `StaffLogin` instead of the app shell when not logged in)

**Interfaces:**
- Consumes: `useStaffAuth()` from Task 7.

- [ ] **Step 1: Write the login/setup screen**

```typescript
// frontend/src/pages/StaffLogin/index.tsx
import React, { useState } from 'react';
import { useStaffAuth } from '../../contexts/StaffAuthContext';

export const StaffLogin: React.FC = () => {
  const { setupRequired, login, completeSetup } = useStaffAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = setupRequired
      ? await completeSetup(name, username, password)
      : await login(username, password);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Something went wrong.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-glass-bg border border-glass-border rounded-2xl p-6 space-y-4 shadow-2xl"
      >
        <h1 className="text-lg font-bold text-white">
          {setupRequired ? 'Create the first Admin account' : 'Staff Login'}
        </h1>
        {setupRequired && (
          <p className="text-xs text-muted">
            No staff accounts exist yet on this PC. Create the Admin account first — you can add Cashier accounts afterward from Settings.
          </p>
        )}

        {setupRequired && (
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={setupRequired ? 'new-password' : 'current-password'}
            className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
        </div>

        {error && (
          <p className="text-xs text-red bg-red/10 border border-red/20 rounded-xl px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Please wait…' : setupRequired ? 'Create Admin Account' : 'Log In'}
        </button>
      </form>
    </div>
  );
};

export default StaffLogin;
```

- [ ] **Step 2: Gate the app in App.tsx**

Read `frontend/src/App.tsx` in full before editing — locate the top-level export component that currently renders `<Routes>` (the block containing the `<Route path="/" element={<Navigate to="/pos" replace />} />` line seen at line 144). Wrap that component's returned JSX so it only renders once a staff member is logged in, and wrap the whole app in `StaffAuthProvider` at the outermost export. The exact wiring:

1. Import at the top: `import { StaffAuthProvider, useStaffAuth } from './contexts/StaffAuthContext';` and `import { StaffLogin } from './pages/StaffLogin';`
2. Find the component that is the default export (wraps everything, likely already wraps providers like `QueryClientProvider`). Add `<StaffAuthProvider>` as the innermost provider, wrapping the router/layout tree.
3. Inside the component that renders `<Routes>`, before returning the routes tree, add:
```typescript
const { staffUser, loading, setupRequired } = useStaffAuth();
if (loading) {
  return <div className="min-h-screen flex items-center justify-center bg-bg text-muted text-sm">Loading…</div>;
}
if (!staffUser || setupRequired) {
  return <StaffLogin />;
}
```
This must run in a component that is a descendant of `StaffAuthProvider` (React Context rule — `useStaffAuth` throws if called outside the provider).

- [ ] **Step 3: Manual verification**

- Start the app fresh against an empty/new database (`DB_PATH` pointing at a throwaway file, or delete the dev `data/app.db` after backing it up — confirm with the user before deleting any real data). Confirm the "Create the first Admin account" screen appears instead of the app.
- Create the admin account. Confirm you land in the normal app (POS page).
- Refresh the page. Confirm you stay logged in (per the "stay logged in all day" decision — no re-login prompt).
- Open the app in a private/incognito window (no `staff_session_token` in that browser's localStorage). Confirm it shows the login screen (not the setup screen, since setup is already done).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/StaffLogin frontend/src/App.tsx
git commit -m "feat: gate the app behind staff login, add first-run admin setup screen"
```

---

### Task 9: Frontend — Staff Management tab in Settings

**Files:**
- Modify: `frontend/src/pages/Settings/index.tsx`

**Interfaces:**
- Consumes: `api.listStaffUsers`, `api.createStaffUser`, `api.updateStaffUser` (Task 6), `useStaffAuth()` (Task 7).

- [ ] **Step 1: Read the existing Settings page tab structure**

Read `frontend/src/pages/Settings/index.tsx` in full to find its existing tab-switching pattern (a `useState` for the active tab plus a row of tab buttons — every other page in this app, e.g. the CRM page referenced during brainstorming, uses this same pattern via a `tab` query param or local state). Match that exact pattern rather than introducing a new one.

- [ ] **Step 2: Add a "Staff" tab**

Add a new tab entry alongside the existing ones, and a corresponding panel component in the same file (or a new `frontend/src/pages/Settings/StaffTab.tsx` if the existing file already splits tabs into separate files — check first). The panel:

```typescript
// Staff management tab content
const StaffManagementTab: React.FC = () => {
  const [users, setUsers] = useState<Array<{ id: number; name: string; username: string; role: string; is_active: number }>>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'cashier' as 'admin' | 'cashier' });
  const [error, setError] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      const res = await api.listStaffUsers();
      setUsers(res?.users || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load staff accounts.');
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createStaffUser(form);
      setForm({ name: '', username: '', password: '', role: 'cashier' });
      setShowCreate(false);
      loadUsers();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to create staff account.');
    }
  };

  const toggleActive = async (id: number, currentlyActive: number) => {
    await api.updateStaffUser(id, { is_active: currentlyActive ? 0 : 1 });
    loadUsers();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Staff Accounts</h3>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90"
        >
          {showCreate ? 'Cancel' : 'Add Staff Account'}
        </button>
      </div>

      {error && <p className="text-xs text-red bg-red/10 border border-red/20 rounded-xl px-3 py-2">{error}</p>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-bg2/40 border border-glass-border">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
            className="bg-bg border border-glass-border rounded-lg px-3 py-2 text-xs text-white outline-none"
          />
          <input
            placeholder="Username"
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            required
            className="bg-bg border border-glass-border rounded-lg px-3 py-2 text-xs text-white outline-none"
          />
          <input
            placeholder="Password (min 8 chars)"
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            className="bg-bg border border-glass-border rounded-lg px-3 py-2 text-xs text-white outline-none"
          />
          <select
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'cashier' })}
            className="bg-bg border border-glass-border rounded-lg px-3 py-2 text-xs text-white outline-none"
          >
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="col-span-2 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90">
            Create Account
          </button>
        </form>
      )}

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-bg2/40 border border-glass-border">
            <div>
              <span className="text-sm font-bold text-white">{u.name}</span>
              <span className="ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {u.role}
              </span>
              <p className="text-[11px] text-muted">@{u.username}</p>
            </div>
            <button
              onClick={() => toggleActive(u.id, u.is_active)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border ${
                u.is_active ? 'text-red border-red/20 bg-red/10 hover:bg-red/20' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20'
              }`}
            >
              {u.is_active ? 'Disable' : 'Re-enable'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
```

Wire it into the existing tab switcher (add `{ id: 'staff', label: 'Staff' }` to whatever array drives the tab buttons, and render `<StaffManagementTab />` when that tab is active) — match the exact conditional-render pattern already used for the other tabs in this file.

- [ ] **Step 3: Manual verification**

Log in as the Admin created in Task 8. Go to Settings → Staff. Create a Cashier account. Confirm it appears in the list. Click "Disable" and confirm it moves to the disabled state and a subsequent login attempt with that account's credentials returns "Invalid username or password" (disabled accounts are excluded by the `is_active = 1` filter in the login query from Task 4).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings/index.tsx
git commit -m "feat: add staff account management UI to Settings"
```

---

### Task 10: Frontend — lock Stock Adjustment and Purchase Bill actions for non-admin

**Files:**
- Modify: `frontend/src/pages/Investigation/index.tsx` (around `handleAdjustStock` / `saveInventoryAdjustment`, lines 338 and 366)
- Modify: `frontend/src/pages/Purchases/index.tsx` (the purchase-save submit handler)

**Interfaces:**
- Consumes: `useStaffAuth()` from Task 7.

- [ ] **Step 1: Lock the Investigation "Adjust" action**

In `frontend/src/pages/Investigation/index.tsx`, import the hook near the top:

```typescript
import { useStaffAuth } from '../../contexts/StaffAuthContext';
```

Inside the component, add:

```typescript
const { staffUser } = useStaffAuth();
const canAdjustStock = staffUser?.role === 'admin';
```

Find the "Adjust" button (around line 1696-1707, `onClick={(e) => { e.stopPropagation(); handleAdjustStock(item.inventory_id); }}`). Change it to show a locked state for non-admin instead of disappearing (per the "visible but locked" decision):

```typescript
<button
  onClick={(e) => {
    e.stopPropagation();
    if (!canAdjustStock) return;
    handleAdjustStock(item.inventory_id);
  }}
  disabled={!canAdjustStock}
  title={canAdjustStock ? 'Direct Stock Master Adjustment' : 'Admin access required to adjust stock'}
  className={`px-3 py-1 rounded-xl border transition-all text-[10px] font-extrabold ${
    canAdjustStock
      ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500 hover:text-white text-amber-500 cursor-pointer'
      : 'bg-white/5 border-glass-border text-muted cursor-not-allowed opacity-60'
  }`}
>
  {canAdjustStock ? 'Adjust' : 'Adjust 🔒'}
</button>
```

Find the "Save Stock Adjustments" button (around line 1132-1137, `onClick={saveInventoryAdjustment}`) and disable it the same way:

```typescript
<button
  onClick={saveInventoryAdjustment}
  disabled={!canAdjustStock}
  className={`px-4 py-2 rounded-xl transition-all text-xs font-bold ${
    canAdjustStock
      ? 'bg-primary text-white hover:bg-primary/95 shadow-[0_0_15px_rgba(34,197,150,0.2)] cursor-pointer'
      : 'bg-white/10 text-muted cursor-not-allowed'
  }`}
>
  {canAdjustStock ? 'Save Stock Adjustments' : 'Admin Access Required'}
</button>
```

- [ ] **Step 2: Lock the Purchases save action**

Read `frontend/src/pages/Purchases/index.tsx` to find the submit button that calls `api.createManualPurchase` / `api.updatePurchase` (Task 5 protects `POST /purchases/manual` and `PUT /purchases/:id/full` server-side; this step adds the matching client-side lock so a Cashier sees why the button is disabled rather than getting a raw 403 after filling the whole form).

Import and read the role the same way as Step 1:

```typescript
import { useStaffAuth } from '../../contexts/StaffAuthContext';
// ...
const { staffUser } = useStaffAuth();
const canManagePurchases = staffUser?.role === 'admin';
```

Locate the save/submit button for the purchase form and apply the same `disabled={!canManagePurchases}` + locked-style treatment and title tooltip as Step 1. If a banner area exists at the top of the form, also render:

```typescript
{!canManagePurchases && (
  <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
    You're viewing this page in read-only mode. Only an Admin account can enter or edit purchase bills.
  </p>
)}
```

- [ ] **Step 3: Manual verification**

- Log in as Cashier. Open Investigation, confirm the "Adjust" button and "Save Stock Adjustments" button are visibly disabled/locked, and clicking them does nothing (no request fires — check the Network tab).
- Open Purchases as Cashier, confirm the save action is locked and the read-only banner is visible.
- Log out, log in as Admin, confirm both actions work exactly as before this plan (no regression for the admin path — this was already manually exercised pre-login-system, so the check here is that it's unchanged).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Investigation/index.tsx frontend/src/pages/Purchases/index.tsx
git commit -m "feat: lock stock adjustment and purchase bill actions to the admin role in the UI"
```

---

### Task 11: Multi-PC manual verification (rollout checklist — not automated)

This task has no code changes. It validates the actual scenario this plan was built for: two PCs, one host, one shared database, role-based restriction.

- [ ] On the host PC, confirm its LAN IP (`ipconfig` → IPv4 Address) and that Windows Firewall allows inbound connections on port 5174 for private networks.
- [ ] From a second PC on the same Wi-Fi/LAN, open a browser to `http://<host-LAN-IP>:5174`. Confirm the app loads (this exercises the CORS allowlist already in `server.ts`, unchanged by this plan).
- [ ] On the second PC, log in as the Cashier account created in Task 9.
- [ ] From the second PC, make a POS sale. Confirm it appears immediately in Sales History / Reports on the host PC — no delay, no separate sync step (this is the "silently in background, host saves it" behavior the user asked about — it's synchronous by construction, not a queued relay).
- [ ] From the second PC (still logged in as Cashier), attempt to open Investigation and click "Adjust". Confirm it's locked, and confirm no `PUT /api/investigation/inventory/:id` request succeeds if attempted directly (e.g. via browser devtools) — should return 403.
- [ ] From the host PC, log in as Admin, adjust stock for the same item the Cashier PC attempted to touch. Confirm it succeeds and appears in the audit trail (`action_logs`) tagged with the Admin's name.
- [ ] Confirm the refill-reminder / WhatsApp automation (`src/services/shortageReminderService.ts`, `src/routes/automation.ts`) continues to run only on the host process — this plan does not change where background jobs run, only who can trigger the two restricted write actions from the UI.
- [ ] Close the browser tab on the second PC and reopen `http://<host-LAN-IP>:5174`. Confirm the Cashier is still logged in (per the "stay logged in all day" decision) without re-entering credentials.

- [ ] **Commit** (if any fixes were needed during verification, commit them individually per the relevant task above — this task itself produces no diff to commit if everything passes).

---

## Self-Review Notes

- **Spec coverage:** role-based (not PC-based) restriction → Tasks 5, 10. Preset role dropdown → Task 9. Username+password login → Tasks 4, 8. Stay-logged-in-all-day sessions → Task 3 (no expiry check), Task 7 (token persists in localStorage until explicit logout). Layered on top of existing license auth, not replacing it → Task 4 (`attachStaffUser` registered alongside, not instead of, `authenticateApiKey`). Visible-but-locked UI → Task 10. First-run setup screen → Tasks 4, 8. Audit trail attribution → Task 2 (`action_logs` columns) + every write in Task 4/5 tagging `staff_user_id`/`staff_name`. LAN multi-PC access → confirmed already working pre-existing (Task 11 validates, no code change needed).
- **Out of scope, deliberately:** `src/routes/security.ts` admin/login (separate legacy mechanism, not touched). Per-permission checklists (rejected in favor of role dropdown). Idle-timeout sessions (rejected in favor of all-day sessions). Any change to where WhatsApp/email/OCR background jobs run (unchanged — already host-only by construction, since only one server process exists).
