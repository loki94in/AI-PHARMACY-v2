import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');
const BACKUP_DIR = path.resolve(__dirname, '..', 'backup');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.resolve(BACKUP_DIR, `app-${timestamp}.db`);

try {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at: ${DB_PATH}`);
    process.exit(1);
  }
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`Successfully backed up database to: ${backupPath}`);
} catch (error) {
  console.error('Failed to backup database:', error);
  process.exit(1);
}
