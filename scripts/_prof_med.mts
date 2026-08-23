import { performance } from 'node:perf_hooks';
import { dbManager } from '../src/database/connection.js';

const t = async (label: string, fn: () => Promise<unknown>) => {
  const s = performance.now();
  try {
    const r = await fn();
    console.log(`${label}: ${(performance.now() - s).toFixed(1)}ms`);
    return r;
  } catch (e) {
    console.log(`${label} FAILED: ${(e as Error).message}`);
    throw e;
  }
};

const db = await t('1. getConnection', () => dbManager.getConnection());
await t('2. health SELECT 1', () => db.get('SELECT 1'));

const t0 = performance.now();
await import('../src/utils/nameNormalizer.js');
console.log(`3. dynamic import nameNormalizer: ${(performance.now() - t0).toFixed(1)}ms`);

// Rolled-back INSERT profiling on the real table (no data persists)
await db.run('BEGIN IMMEDIATE TRANSACTION');
try {
  await t('4. INSERT medicines (rolled back)', () => db.run(
    'INSERT INTO medicines (name, generic_name, manufacturer, marketed_by, pack_unit, pack_size, cgst_per, sgst_per, igst_per, hsn_code, category, packaging, mrp, rate, sell_price, schedule_type, allow_loose_sale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['ZZZ_PROFILING_DUMMY_ROLLBACK', 'x', 'x', '', '', null, 6, 6, 0, '', '', '', 0, 0, 0, 'None', 1]
  ));
} finally {
  await t('5. ROLLBACK', () => db.run('ROLLBACK'));
}
const check = await db.get("SELECT COUNT(*) c FROM medicines WHERE name LIKE 'ZZZ_PROFILING%'");
console.log(`6. rows persisted after rollback: ${check.c}`);
process.exit(0);
