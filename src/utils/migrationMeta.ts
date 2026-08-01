const STAGED_MODULES_KEY = 'migration_staged_modules';
const IMPORT_STATS_KEY = 'migration_last_import_stats';

const RECOMMENDED_ORDER = ['inventory', 'purchases', 'sales', 'returns', 'customers'];

export async function recordStagedModule(db: { run: Function; get: Function }, moduleType: string): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [STAGED_MODULES_KEY]);
  let modules: string[] = [];
  try {
    modules = row?.value ? JSON.parse(row.value) : [];
  } catch {
    modules = [];
  }
  if (!modules.includes(moduleType)) {
    modules.push(moduleType);
    await db.run(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
      [STAGED_MODULES_KEY, JSON.stringify(modules)]
    );
  }
}

export async function getStagedModules(db: { get: Function }): Promise<string[]> {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [STAGED_MODULES_KEY]);
  try {
    return row?.value ? JSON.parse(row.value) : [];
  } catch {
    return [];
  }
}

export function getImportOrderWarnings(stagedModules: string[]): string[] {
  const warnings: string[] = [];
  const has = (m: string) => stagedModules.includes(m);

  if (has('sales') && !has('inventory')) {
    warnings.push('Sales were imported without inventory — sale items may link to placeholder batches with zero stock.');
  }
  if (has('returns') && !has('inventory') && !has('purchases')) {
    warnings.push('Returns were imported without inventory or purchases — stock levels were not adjusted.');
  }
  if (has('purchases') && !has('inventory')) {
    warnings.push('Purchases were imported without a separate inventory file — stock was created from purchase lines.');
  }

  const orderIdx = (m: string) => RECOMMENDED_ORDER.indexOf(m);
  for (let i = 0; i < stagedModules.length; i++) {
    for (let j = i + 1; j < stagedModules.length; j++) {
      const a = stagedModules[i];
      const b = stagedModules[j];
      if (orderIdx(a) >= 0 && orderIdx(b) >= 0 && orderIdx(a) > orderIdx(b)) {
        warnings.push(`Import order note: "${b}" was staged before "${a}". Recommended order: ${RECOMMENDED_ORDER.join(' → ')}.`);
        return [...new Set(warnings)];
      }
    }
  }

  return warnings;
}

export async function saveImportStats(
  db: { run: Function },
  stats: { module: string; totalRows: number; errorRows: number; validRows: number }
): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  await db.run(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [IMPORT_STATS_KEY, JSON.stringify({ ...stats, savedAt: new Date().toISOString() })]
  );
}

export async function getImportStats(db: { get: Function }): Promise<{
  module: string;
  totalRows: number;
  errorRows: number;
  validRows: number;
  savedAt?: string;
} | null> {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [IMPORT_STATS_KEY]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export async function clearStagedModuleTracking(db: { run: Function }): Promise<void> {
  await db.run('DELETE FROM app_settings WHERE key IN (?, ?)', [STAGED_MODULES_KEY, IMPORT_STATS_KEY]);
}
