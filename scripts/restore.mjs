import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');
const backupFile = process.argv[2];

if (!backupFile) {
  console.error('Usage: node restore.mjs <path-to-backup-file>');
  process.exit(1);
}

const backupPath = path.resolve(backupFile);

if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found at: ${backupPath}`);
  process.exit(1);
}

try {
  // Option: backup current db before restoring
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempBackup = path.resolve(__dirname, '..', 'backup', `pre-restore-${timestamp}.db`);
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, tempBackup);
    console.log(`Created pre-restore backup at: ${tempBackup}`);
  }

  fs.copyFileSync(backupPath, DB_PATH);
  console.log(`Successfully restored database from: ${backupPath}`);
} catch (error) {
  console.error('Failed to restore database:', error);
  process.exit(1);
}
