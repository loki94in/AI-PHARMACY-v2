# Medicine Name Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB‑SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task‑by‑task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid CLI + background‑worker queue that extracts medicine names and API references from PDF/CSV catalog files and stores them in a new SQLite table.

**Architecture:** A lightweight command‑line enqueuer scans a configurable `catalog/` directory and inserts each file into a SQLite `catalog_jobs` queue. A separate long‑running worker pulls pending jobs, uses the existing extractor helpers, extracts the API URL (if any), and UPSERTs the `(name, api_reference)` pair into a new `medicines` table. Idempotency is ensured by unique constraints and a `processed_files` table.

**Tech Stack:** Node 18+, TypeScript, `sqlite3` (SQLCipher), `pdf-parse`, `csv-parse/sync`, `chokidar` (optional watcher), `commander` for CLI.

---

### Task 1: Add SQLite schema tables

**Files:**
- Modify: `src/database.ts` (or create if absent) – add statements to create `medicines`, `catalog_jobs`, `processed_files` if they do not exist.

- [ ] **Step 1: Write a migration script**
```ts
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function ensureSchema(dbPath: string) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_reference TEXT
    );
    CREATE TABLE IF NOT EXISTS catalog_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      status TEXT CHECK(status IN ('pending','processing','done','failed')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS processed_files (
      file_path TEXT PRIMARY KEY,
      last_processed DATETIME
    );
  `);
  await db.close();
}
```

- [ ] **Step 2: Run test to verify tables exist**
```bash
node -e "require('./src/database').ensureSchema('test.db').then(()=>console.log('OK'))"
```
Expected output: `OK` and no error.

- [ ] **Step 3: Commit**
```bash
git add src/database.ts
git commit -m "feat: add SQLite schema for medicines and job queue"
```

---

### Task 2: Create CLI enqueuer script

**Files:**
- Create: `src/cli/enqueueCatalog.ts`

- [ ] **Step 1: Write the enqueuer**
```ts
import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../database';

const CATALOG_DIR = path.resolve(__dirname, '..', '..', 'catalog');

async function enqueue() {
  await ensureSchema(path.resolve(__dirname, '..', '..', 'data', 'app.db'));
  const db = await open({ filename: path.resolve(__dirname, '..', '..', 'data', 'app.db'), driver: sqlite3.Database });
  const files = await fs.promises.readdir(CATALOG_DIR, { withFileTypes: true });
  for (const f of files) {
    if (f.isFile() && /\.(pdf|csv)$/i.test(f.name)) {
      const fullPath = path.join(CATALOG_DIR, f.name);
      await db.run(`INSERT OR IGNORE INTO catalog_jobs (file_path) VALUES (?)`, fullPath);
    }
  }
  await db.close();
  console.log('Enqueue complete');
}

enqueue().catch(console.error);
```

- [ ] **Step 2: Add npm script** (create `package.json` if missing).
```json
{
  "name": "ai-pharmacy",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "enqueue-catalog": "node ./src/cli/enqueueCatalog.ts",
    "worker": "node ./src/worker/catalogWorker.ts"
  },
  "dependencies": {
    "sqlite3": "^5.1.6",
    "pdf-parse": "^1.1.1",
    "csv-parse": "^5.5.2",
    "chokidar": "^3.5.3"
  }
}
```

- [ ] **Step 3: Run test – ensure script exits with status 0**
```bash
npm run enqueue-catalog
```
Expected output: `Enqueue complete`

- [ ] **Step 4: Commit**
```bash
git add src/cli/enqueueCatalog.ts package.json
git commit -m "feat: add CLI to enqueue catalog files"
```

---

### Task 3: Create background worker script

**Files:**
- Create: `src/worker/catalogWorker.ts`

- [ ] **Step 1: Write the worker**
```ts
import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../database';
import { extractFromPdf, extractFromCsv } from '../extractor';

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

function findApiReference(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

async function processJob(row: any) {
  const { id, file_path } = row;
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run(`UPDATE catalog_jobs SET status='processing' WHERE id=?`, id);
  try {
    const ext = path.extname(file_path).toLowerCase();
    const names = ext === '.pdf' ? await extractFromPdf(file_path) : await extractFromCsv(file_path);
    const apiRef = findApiReference(fs.readFileSync(file_path, 'utf-8'));
    for (const n of names) {
      await db.run(
        `INSERT INTO medicines (name, api_reference)
         SELECT ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM medicines WHERE lower(name)=lower(?))`,
        n, apiRef, n
      );
    }
    await db.run(`INSERT OR REPLACE INTO processed_files (file_path, last_processed) VALUES (?, CURRENT_TIMESTAMP)`, file_path);
    await db.run(`UPDATE catalog_jobs SET status='done' WHERE id=?`, id);
  } catch (e) {
    console.error('Job failed', e);
    await db.run(`UPDATE catalog_jobs SET status='failed' WHERE id=?`, id);
  } finally {
    await db.close();
  }
}

async function workerLoop() {
  await ensureSchema(DB_PATH);
  while (true) {
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    const job = await db.get(`SELECT * FROM catalog_jobs WHERE status='pending' ORDER BY created_at LIMIT 1`);
    await db.close();
    if (!job) {
      // no pending jobs – sleep briefly
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    await processJob(job);
  }
}

workerLoop().catch(console.error);
```

- [ ] **Step 2: Run a quick sanity test** (create a tiny CSV in `catalog/test.csv` with a header `name,api` and a row).
```bash
npm run enqueue-catalog
npm run worker &
# wait a few seconds, then check DB content
node -e "(async()=>{const {open}=require('sqlite');const sqlite3=require('sqlite3');const db=await open({filename:'data/app.db',driver:sqlite3.Database});const rows=await db.all('SELECT * FROM medicines');console.log(rows);await db.close();})()"
```
Expected: an array with the extracted name and API.

- [ ] **Step 3: Commit**
```bash
git add src/worker/catalogWorker.ts
git commit -m "feat: add background worker to process catalog jobs"
```

---

### Task 4: (Optional) Add file‑system watcher for live enqueuing

**Files:**
- Create: `src/cli/watchCatalog.ts`

- [ ] **Step 1: Write watcher**
```ts
import chokidar from 'chokidar';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const CATALOG_DIR = path.resolve(__dirname, '..', '..', 'catalog');
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

const watcher = chokidar.watch(`${CATALOG_DIR}/**/*.@(pdf|csv)`, { ignoreInitial: true });

watcher.on('add', async (filePath) => {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run(`INSERT OR IGNORE INTO catalog_jobs (file_path) VALUES (?)`, filePath);
  await db.close();
  console.log('Enqueued', filePath);
});

console.log('Watching catalog folder...');
```

- [ ] **Step 2: Add npm script** `"watch-catalog": "node ./src/cli/watchCatalog.ts"`

- [ ] **Step 3: Commit**
```bash
git add src/cli/watchCatalog.ts package.json
git commit -m "feat: optional watcher to auto‑enqueue new catalog files"
```

---

### Task 5: Write tests for the whole pipeline

**Files:**
- Create: `tests/catalogPipeline.test.ts`

- [ ] **Step 1: Test enqueuer adds a job**
```ts
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { execSync } from 'child_process';

test('enqueue adds job', async () => {
  execSync('npm run enqueue-catalog');
  const db = await open({ filename: 'data/app.db', driver: sqlite3.Database });
  const count = await db.get('SELECT COUNT(*) as c FROM catalog_jobs');
  expect(count.c).toBeGreaterThan(0);
  await db.close();
});
```

- [ ] **Step 2: Test worker processes a known CSV** (prepare a temporary CSV in `catalog/tmp.csv`).
```ts
test('worker extracts and stores', async () => {
  // ensure job exists
  execSync('npm run enqueue-catalog');
  // run worker for a short time then kill
  const worker = execSync('node ./src/worker/catalogWorker.js', { timeout: 5000 });
  const db = await open({ filename: 'data/app.db', driver: sqlite3.Database });
  const meds = await db.all('SELECT * FROM medicines');
  expect(meds.length).toBeGreaterThan(0);
  await db.close();
});
```

- [ ] **Step 3: Run tests**
```bash
npm install jest ts-jest @types/jest --save-dev
npx jest
```
All tests should pass.

- [ ] **Step 4: Commit tests**
```bash
git add tests/catalogPipeline.test.ts
git commit -m "test: add pipeline integration tests"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-24-medicine-name-extraction-design.md` – add a short “How to run” section linking to the CLI commands.

- [ ] **Step 1: Add run instructions**
```markdown
## Running the pipeline
1. Place PDF/CSV files under `catalog/`.
2. Enqueue jobs: `npm run enqueue-catalog`.
3. Start the worker (or the optional watcher): `npm run worker`.
4. Verify results in the SQLite DB (`data/app.db`).
```

- [ ] **Step 2: Commit documentation**
```bash
git add docs/superpowers/specs/2026-05-24-medicine-name-extraction-design.md
git commit -m "docs: add run instructions for medicine extraction pipeline"
```

---

### Task 7: Final commit and push (if remote exists)

- [ ] **Step 1: Pull latest changes, rebase if needed**
```bash
git pull --rebase origin main
```
- [ ] **Step 2: Push new feature branch** (create `feature/medicine-extraction` if desired).
```bash
git checkout -b feature/medicine-extraction
git push -u origin feature/medicine-extraction
```

---

**Plan complete.**

The plan file has been saved at `docs/superpowers/plans/2026-05-24-medicine-name-extraction-plan.md`. Let me know which execution mode you prefer:

1. **Subagent‑Driven Development** (dispatch a fresh subagent per task, review after each).
2. **Inline Execution** (run the tasks directly in this session).
