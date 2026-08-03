import { config as dotenvConfig } from 'dotenv';
import path, { join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node SEA (Single Executable Application) detection via the official node:sea
// API. Guarded because node:sea doesn't exist on older Node versions and isn't
// present at all in dev mode.
function isNodeSea(): boolean {
  try {
    const req = createRequire(import.meta.url);
    const sea = req('node:sea');
    return typeof sea.isSea === 'function' && sea.isSea();
  } catch {
    return false;
  }
}

/** True when running as a packaged single executable (Node SEA), not from source. */
export const isPackagedApp = (): boolean => isNodeSea();

// Load environment variables from .env file. dotenv's default behaviour reads
// `.env` from process.cwd(), which is only the app folder when launched with an
// explicit "Start in" directory (e.g. the desktop shortcut). Launched from a
// registry Run key, a taskbar pin, or `cmd /c start <path>` without a working
// directory, cwd can be System32 or the user's home folder, so `.env` silently
// fails to load and NODE_ENV/API_KEY/LICENSE_SERVER_URL stay unset. When
// packaged, load explicitly from the executable's own directory instead.
if (isPackagedApp()) {
  dotenvConfig({ path: path.join(path.dirname(process.execPath), '.env') });
} else {
  dotenvConfig();
}

function migrateLegacyPackagedDataIfNeeded(oldRoot: string, newRoot: string): void {
  const oldData = path.join(oldRoot, 'data', 'app.db');
  const newData = path.join(newRoot, 'data', 'app.db');
  if (fs.existsSync(newData) || !fs.existsSync(oldData)) return;

  for (const sub of ['data', 'uploads', 'backup']) {
    const src = path.join(oldRoot, sub);
    const dest = path.join(newRoot, sub);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      console.log(`[Config] Migrated ${sub}/ from legacy install path to ${newRoot}`);
    }
  }
}

export const getAppDataDir = (): string => {
  if (isPackagedApp()) {
    // Windows: store writable data under %LOCALAPPDATA% — not beside the exe in Program Files.
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      const newDir = path.join(process.env.LOCALAPPDATA, 'AI Pharmacy OS');
      const legacyDir = path.dirname(process.execPath);
      migrateLegacyPackagedDataIfNeeded(legacyDir, newDir);
      return newDir;
    }
    return path.dirname(process.execPath);
  }
  // In development/source mode, we resolve relative to the project root.
  // We walk up to find the root folder containing THIS project's package.json
  // (checked by name, not just existence — an unrelated package.json can
  // otherwise exist in an ancestor directory, e.g. a user's home folder).
  let current = __dirname;
  while (current && current !== path.dirname(current)) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkgJson.name === 'ai-pharmacy') return current;
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    current = path.dirname(current);
  }
  // No matching package.json found while walking up from __dirname —
  // __dirname doesn't correspond to a real project directory on disk.
  // Fall back to the directory containing the running executable.
  return path.dirname(process.execPath);
};

const appDataDir = getAppDataDir();

export interface AppConfig {
  port: number;
  dbPath: string;
  uploadDir: string;
  tempDir: string;
  backupDir: string;
  apiKey: string;
  corsOrigin: string;
  taxRate: number;
  maxUploadSize: number;
  nodeEnv: string;
  // Telegram configuration
  telegramBotToken?: string;
  telegramChatId?: string;
  // WhatsApp configuration
  whatsappToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappVerifyToken?: string;
  // Email configuration
  emailUser?: string;
  emailPass?: string;
  emailHost?: string;
  emailPort?: number;
  // OCR/AI configuration
  enableInternetFallback: boolean;
  openFdaApiKey?: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '5174', 10),
  get dbPath() { return process.env.DB_PATH || path.join(appDataDir, 'data', 'app.db'); },
  uploadDir: process.env.UPLOAD_DIR || path.join(appDataDir, 'uploads'),
  tempDir: process.env.TEMP_DIR || path.join(appDataDir, 'uploads', 'temp'),
  backupDir: process.env.BACKUP_DIR || path.join(appDataDir, 'backup'),
  apiKey: process.env.API_KEY || 'Pass@123',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5174',
  taxRate: parseFloat(process.env.TAX_RATE || '0.05'),
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || '50', 10) * 1024 * 1024, // 50MB default
  nodeEnv: process.env.NODE_ENV || 'development',
  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  // WhatsApp
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  // Email
  emailUser: process.env.EMAIL_USER,
  emailPass: process.env.EMAIL_PASS,
  emailHost: process.env.EMAIL_HOST,
  emailPort: parseInt(process.env.EMAIL_PORT || '587', 10),
  // OCR/AI
  enableInternetFallback: process.env.ENABLE_INTERNET_FALLBACK === 'true',
  openFdaApiKey: process.env.OPENFDA_API_KEY,
};