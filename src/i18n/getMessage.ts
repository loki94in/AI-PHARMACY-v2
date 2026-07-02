import { readFileSync } from 'fs';
import { join } from 'path';
import { getTemplate } from '../database/messageDAO.js';

// Load the whole JSON once at module init
const messagesPath = join(process.cwd(), 'src', 'i18n', 'messages.json');
const raw = readFileSync(messagesPath, 'utf8');
const ALL_MESSAGES: Record<string, Record<string, Record<string, string>>> = JSON.parse(raw);

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