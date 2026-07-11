// productResolver.ts — Name-only medicine resolver (saved at project root).
//
// WHY: The user wants to type JUST the unit/product name (a brand like
// "Nevanac" or a generic/API like "Nepafenac") and have the app identify the
// actual product WITHOUT entering strength / form / manufacturer / packaging.
// This module resolves a single free-text name to the real local medicines,
// handling the brand != index-name case via aliases + API-identity matching.
//
// HOW THE USER USES IT (CLI):
//   npx tsx productResolver.ts "Nevanac"
//   npx tsx productResolver.ts "Nepafenac"
//
// It can also be imported:  const { resolveProductByName } = await import('./productResolver.ts');

import { dbManager } from './src/database/connection.js';
import { isPlausibleMedicineName } from './src/services/intentKeywords.js';
import { pathToFileURL } from 'url';

export interface ResolvedProduct {
  medicineId: number;
  name: string;
  api: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  packaging: string | null;
  mrp: number | null;
  inStock: boolean;
  matchType: 'exact_name' | 'alias' | 'api_reference' | 'reference_api' | 'fuzzy' | 'none';
  score: number;
}

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lightweight similarity: exact > substring > token Jaccard.
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const sa = new Set(na.split(' ').filter(Boolean));
  const sb = new Set(nb.split(' ').filter(Boolean));
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function toProduct(r: any, matchType: ResolvedProduct['matchType'], score: number): ResolvedProduct {
  const stock = Number(r.stock) || 0;
  return {
    medicineId: r.id,
    name: r.name,
    api: r.api_reference ?? null,
    strength: r.strength ?? null,
    form: r.item_type ?? null,
    manufacturer: r.manufacturer ?? null,
    packaging: r.packaging ?? null,
    mrp: r.mrp != null ? Number(r.mrp) : null,
    inStock: stock > 0,
    matchType,
    score,
  };
}

/**
 * Resolve a medicine by NAME ONLY. The caller supplies a single product/unit
 * name; strength / form / manufacturer are NOT required and are skipped.
 * Resolution order (first hit wins per medicine):
 *   1. exact / prefix / substring on medicines.name
 *   2. medicine_aliases (brand variants, typos)
 *   3. medicines.api_reference / generic_name (user typed the API)
 *   4. seeded medicine_reference API dictionary -> local meds with that API
 *   5. fuzzy token fallback when nothing above matches
 */
export async function resolveProductByName(rawName: string): Promise<ResolvedProduct[]> {
  const db = await dbManager.getConnection();
  const q = normalize(rawName);
  if (!q) return [];
  if (!isPlausibleMedicineName(rawName)) return [];

  const results: ResolvedProduct[] = [];
  const seen = new Set<number>();

  const stockSql = `(SELECT COALESCE(SUM(quantity),0) FROM inventory_master WHERE medicine_id = m.id) AS stock`;

  // 1. name
  const byName = await db.all(
    `SELECT m.*, ${stockSql} FROM medicines m
     WHERE lower(m.name) LIKE ? OR lower(m.name) = ?
     ORDER BY length(m.name) ASC LIMIT 20`,
    [`%${q}%`, q]
  );
  for (const r of byName) {
    const score = r.name.toLowerCase() === q ? 1 : r.name.toLowerCase().startsWith(q) ? 0.95 : 0.8;
    results.push(toProduct(r, 'exact_name', score));
    seen.add(r.id);
  }

  // 2. alias
  const byAlias = await db.all(
    `SELECT m.*, ${stockSql} FROM medicines m
     JOIN medicine_aliases a ON a.medicine_id = m.id
     WHERE lower(a.alias_name) LIKE ? OR lower(a.alias_name) = ?`,
    [`%${q}%`, q]
  );
  for (const r of byAlias) {
    if (seen.has(r.id)) continue;
    results.push(toProduct(r, 'alias', 0.9));
    seen.add(r.id);
  }

  // 3. api_reference / generic_name
  const byApi = await db.all(
    `SELECT m.*, ${stockSql} FROM medicines m
     WHERE lower(m.api_reference) LIKE ? OR lower(m.generic_name) LIKE ?`,
    [`%${q}%`, `%${q}%`]
  );
  for (const r of byApi) {
    if (seen.has(r.id)) continue;
    results.push(toProduct(r, 'api_reference', 0.85));
    seen.add(r.id);
  }

  // 4. seeded API dictionary -> local meds with that API
  const ref = await db.get(
    `SELECT name, composition1 FROM medicine_reference WHERE lower(name) = ? OR lower(composition1) = ? LIMIT 1`,
    [q, q]
  );
  if (ref) {
    const refApi = normalize(ref.composition1 || ref.name);
    const byRefApi = await db.all(
      `SELECT m.*, ${stockSql} FROM medicines m
       WHERE lower(m.api_reference) LIKE ? OR lower(m.generic_name) LIKE ?
       LIMIT 20`,
      [`%${refApi}%`, `%${refApi}%`]
    );
    for (const r of byRefApi) {
      if (seen.has(r.id)) continue;
      results.push(toProduct(r, 'reference_api', 0.8));
      seen.add(r.id);
    }
  }

  // 5. fuzzy fallback
  if (results.length === 0) {
    const all = await db.all(`SELECT m.*, ${stockSql} FROM medicines m`);
    for (const r of all) {
      const s = similarity(q, r.name);
      if (s >= 0.5) results.push(toProduct(r, 'fuzzy', s));
    }
    results.sort((a, b) => b.score - a.score);
  }

  await dbManager.close();
  return results.slice(0, 10);
}

// ─── CLI ────────────────────────────────────────────────────────────────
// Lets the user type JUST the product name and see the resolved product(s),
// skipping every other field. Run:  npx tsx productResolver.ts "Nevanac"
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.log('Usage: npx tsx productResolver.ts "<medicine name>"');
    process.exit(0);
  }
  resolveProductByName(name)
    .then((res) => {
      if (res.length === 0) {
        console.log(`No product found for "${name}".`);
      } else {
        console.log(JSON.stringify(res, null, 2));
      }
    })
    .catch((e) => {
      console.error('Resolver error:', e);
      process.exit(1);
    });
}
