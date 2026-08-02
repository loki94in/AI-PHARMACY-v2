const CUTOVER_KEY = 'migration_report_cutover_date';

export async function getReportCutoverDate(db: { get: Function }): Promise<string | null> {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [CUTOVER_KEY]);
  const val = row?.value;
  return val && String(val).trim() ? String(val).trim().slice(0, 10) : null;
}

export async function setReportCutoverDate(db: { run: Function }, date: string): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [CUTOVER_KEY, date.slice(0, 10)]);
}

/** Use the requested from-date. Cutover is only used if requestedFrom is empty. */
export function effectiveReportFromDate(requestedFrom: string, cutover: string | null): string {
  if (requestedFrom && requestedFrom.trim()) return requestedFrom.trim();
  return cutover || '1970-01-01';
}
