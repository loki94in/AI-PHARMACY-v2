// Diagnostic: check what runEnrichment() would find
import Database from 'better-sqlite3';

// Try opening with shared cache / WAL to avoid lock conflicts
let db;
try {
  db = new Database('./data/app.db', { readonly: true, fileMustExist: true });
} catch (e) {
  console.error('Cannot open DB (probably locked):', e.message);
  process.exit(1);
}

try {
  const refCount = db.prepare('SELECT COUNT(*) as c FROM medicine_reference').get();
  console.log('medicine_reference rows:', refCount.c);

  const eligible = db.prepare(`
    SELECT COUNT(*) as c FROM medicines 
    WHERE (api_reference IS NULL OR api_reference = '') AND enrichment_status IS NULL
  `).get();
  console.log('Eligible for enrichment:', eligible.c);

  // Sample of eligible rows
  const sample = db.prepare(`
    SELECT id, name, enrichment_status, SUBSTR(COALESCE(api_reference,'NULL'),1,30) as api_ref
    FROM medicines 
    WHERE (api_reference IS NULL OR api_reference = '') AND enrichment_status IS NULL
    LIMIT 5
  `).all();
  console.log('Sample eligible:');
  sample.forEach(r => console.log(` id=${r.id} status=${r.enrichment_status} api_ref=${r.api_ref} name=${r.name.slice(0,40)}`));

  // Check if there are medicines with empty string (not null) api_reference
  const emptyStr = db.prepare(`SELECT COUNT(*) as c FROM medicines WHERE api_reference = ''`).get();
  console.log("Medicines with api_reference = '' (empty string):", emptyStr.c);

  // Check suggested_composition column exists
  try {
    const sc = db.prepare(`SELECT COUNT(*) as c FROM medicines WHERE suggested_composition IS NOT NULL`).get();
    console.log('Medicines with suggested_composition:', sc.c);
  } catch(e) {
    console.log('suggested_composition column does NOT exist yet:', e.message);
  }

} finally {
  db.close();
}
