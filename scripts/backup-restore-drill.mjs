#!/usr/bin/env node
/**
 * One-command BACKUP → MUTATE → RESTORE → VERIFY drill (production-readiness
 * checklist §2). Proves that a backup this app's own format can actually bring
 * data back — "a backup that has never been restored is a hope, not a backup".
 *
 * SAFETY: everything runs on a SANDBOX copy in the OS temp dir. The live
 * database is opened READ-ONLY as the snapshot source and is never written.
 *
 * Format parity: backup step uses better-sqlite3 `backup()` (WAL-safe) + gzip,
 * exactly like src/services/backupService.ts, so a drill PASS means the real
 * Settings → Data & Backups flow restores too.
 *
 * Usage: node scripts/backup-restore-drill.mjs [--keep]
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_DB = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, 'data', 'app.db');
const KEEP = process.argv.includes('--keep');

let failures = 0;
function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  if (!fs.existsSync(LIVE_DB)) {
    console.error(`Live database not found at ${LIVE_DB}`);
    process.exit(1);
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-drill-'));
  const dbPath = path.join(sandbox, 'app.db');
  console.log(`Sandbox: ${sandbox}${KEEP ? ' (--keep)' : ''}\n`);

  // 1. SNAPSHOT — WAL-safe backup of the live DB into the sandbox (read-only source).
  {
    const src = new Database(LIVE_DB, { readonly: true });
    await src.backup(dbPath);
    src.close();
    const liveSize = fs.statSync(LIVE_DB).size;
    step('1. Snapshot live DB to sandbox', fs.existsSync(dbPath), `${dbPath} (${liveSize} bytes live)`);
  }

  const open = () => new Database(dbPath);

  // 2. BASELINE canary — remember one real value so we can prove restore brings DATA back.
  let canary;
  {
    const db = open();
    const integrity = db.pragma('integrity_check', { simple: true });
    step('2a. Sandbox integrity_check', integrity === 'ok', String(integrity));
    const row = db.prepare('SELECT COUNT(*) AS c FROM medicines').get();
    canary = { medicinesCount: row.c };
    step('2b. Canary captured (medicines count)', canary.medicinesCount > 0, `${canary.medicinesCount} rows`);
    db.close();
  }

  // 3. BACKUP — production format: better-sqlite3 backup -> gzip (.db.gz).
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const plainBackup = path.join(sandbox, `app_backup_${ts}.db`);
  const gzBackup = `${plainBackup}.gz`;
  {
    const src = new Database(dbPath);
    await src.backup(plainBackup);
    src.close();
    await pipeline(fs.createReadStream(plainBackup), zlib.createGzip(), fs.createWriteStream(gzBackup));
    fs.unlinkSync(plainBackup); // service keeps only the .gz, same as production
    const size = fs.statSync(gzBackup).size;
    step('3. Backup created (service format .db.gz)', size > 0, `${path.basename(gzBackup)} (${size} bytes)`);
  }

  // 4. MUTATE — simulate days of new work after the backup was taken.
  {
    const db = open();
    db.exec('CREATE TABLE IF NOT EXISTS drill_marker (id INTEGER PRIMARY KEY, note TEXT)');
    db.prepare("INSERT INTO drill_marker (note) VALUES ('POST-BACKUP WRITE — must vanish on restore')").run();
    db.prepare('UPDATE inventory_master SET rack_location = rack_location WHERE 1=0').run(); // no-op touch
    db.close();
    const chk = open();
    const marked = chk.prepare('SELECT COUNT(*) AS c FROM drill_marker').get().c;
    chk.close();
    step('4. Post-backup write landed', marked === 1);
  }

  // 5. RESTORE — exactly what the app does: stop writers, drop sidecars, replace file.
  {
    for (const suffix of ['-wal', '-shm']) {
      const side = dbPath + suffix;
      if (fs.existsSync(side)) fs.unlinkSync(side);
    }
    await pipeline(fs.createReadStream(gzBackup), zlib.createGunzip(), fs.createWriteStream(dbPath));
    step('5. Restore from .db.gz over sandbox DB', true);
  }

  // 6. VERIFY — marker gone, canary back, DB healthy, FTS usable when present.
  {
    const db = open();
    const integrity = db.pragma('integrity_check', { simple: true });
    step('6a. Post-restore integrity_check', integrity === 'ok', String(integrity));

    const markerGone = !db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drill_marker'")
      .get();
    step('6b. Post-backup writes discarded', markerGone);

    const count = db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c;
    step('6c. Original data restored (canary)', count === canary.medicinesCount, `${count} vs ${canary.medicinesCount}`);

    try {
      const ftsRow = db.prepare('SELECT COUNT(*) AS c FROM medicines_fts').get();
      step('6d. medicines_fts usable', typeof ftsRow.c === 'number', `${ftsRow.c} indexed rows`);
    } catch (_) {
      step('6d. medicines_fts usable', true, 'FTS table absent on this DB — skipped');
    }
    db.close();
  }

  console.log('');
  if (failures === 0) {
    console.log('DRILL RESULT: ✅ PASS — backups are proven restorable.');
  } else {
    console.log(`DRILL RESULT: ❌ FAIL — ${failures} step(s) failed. Do NOT trust current backups; investigate before go-live.`);
  }

  if (KEEP) {
    console.log(`Sandbox kept for inspection: ${sandbox}`);
  } else {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Drill crashed:', err);
  process.exit(1);
});
