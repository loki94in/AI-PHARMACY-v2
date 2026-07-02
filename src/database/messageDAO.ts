import Database from 'better-sqlite3';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database('./data/app.db', { readonly: false });
  }
  return db;
}

/** Close the messageDAO connection so the DB file can be deleted (used by reset). */
export function closeMessageDAO(): void {
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
}

export function getTemplate(locale: string, key: string): string | null {
  const row = getDb().prepare('SELECT value FROM message_templates WHERE locale = ? AND key = ?').get(locale, key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setTemplate(locale: string, key: string, value: string): void {
  const stmt = getDb().prepare(`
    INSERT INTO message_templates (locale, key, value) VALUES (?, ?, ?)
    ON CONFLICT(locale, key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(locale, key, value);
}

export function deleteTemplate(locale: string, key: string): void {
  getDb().prepare('DELETE FROM message_templates WHERE locale = ? AND key = ?').run(locale, key);
}

export function listTemplates(locale: string): Array<{key: string; value: string}> {
  const rows = getDb().prepare('SELECT key, value FROM message_templates WHERE locale = ?').all(locale);
  return rows as {key: string; value: string}[];
}