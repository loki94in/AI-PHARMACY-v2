import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getTemplate } from '../database/messageDAO.js';

const require = createRequire(import.meta.url);

// Load the JSON at module init (bundled by esbuild via require)
let ALL_MESSAGES: Record<string, Record<string, Record<string, string>>> = {};
try {
  ALL_MESSAGES = require('./messages.json');
} catch (_) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const messagesPath = join(__dirname, 'messages.json');
    if (existsSync(messagesPath)) {
      ALL_MESSAGES = JSON.parse(readFileSync(messagesPath, 'utf8'));
    }
  } catch (err) {
    console.error('[i18n] Failed to load messages.json:', err);
  }
}

/**
 * Get a localized string.
 * @param lang   Language code – e.g. 'en', 'hi', 'mr'
 * @param path   Dot‑separated key, e.g. "whatsapp.expiryAlert"
 * @param values Object of placeholder → replacement (e.g. {patientName: 'John'})
 */
export function getMessage(
  lang: keyof typeof ALL_MESSAGES,
  path: string,
  values: Record<string, string> = {}
): string {
  // Try DB override first
  const dbValue = getTemplate(lang, path);
  let template = '';
  if (dbValue !== null) {
    template = dbValue;
  } else {
    // Fallback to JSON
    const keys = path.split('.');
    let segment: any = ALL_MESSAGES[lang];
    for (const k of keys) {
      if (segment == null) return `[Missing: ${path}]`;
      segment = segment[k];
    }
    if (typeof segment !== 'string') return `[Not a string: ${path}]`;
    template = segment;
  }
  // Simple {{placeholder}} replacement
  return template.replace(/\{\{(\w+)\}\}/g, (_, placeholder) => {
    return values[placeholder] ?? `{{${placeholder}}}`;
  });
}