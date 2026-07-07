// Build medicine_reference from existing api_reference values in medicines table
// This uses the 200k+ medicines that already have compositions as the reference source
import Database from 'better-sqlite3';
import { createWriteStream } from 'fs';

const db = new Database('./data/app.db');

// Get medicines that already have composition data
const rows = db.prepare(`
  SELECT name, manufacturer, api_reference 
  FROM medicines 
  WHERE api_reference IS NOT NULL AND api_reference != ''
  ORDER BY name
`).all();

console.log(`Found ${rows.length} medicines with existing api_reference data`);
console.log('Sample:');
rows.slice(0, 5).forEach(r => console.log(` ${r.name.slice(0,40).padEnd(40)} | ${(r.api_reference||'').slice(0,50)}`));

// Write as reference CSV
const out = createWriteStream('./data/reference_medicines.csv');
out.write('name,short_composition1,short_composition2,manufacturer_name\n');

let written = 0;
for (const r of rows) {
  const escapeCsv = (v) => {
    if (!v) return '';
    const s = String(v).replace(/"/g, '""');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
  };
  // Split api_reference on ' + ' to get composition1 and composition2
  const parts = (r.api_reference || '').split(' + ');
  const comp1 = parts[0] || '';
  const comp2 = parts.slice(1).join(' + ') || '';
  out.write(`${escapeCsv(r.name)},${escapeCsv(comp1)},${escapeCsv(comp2)},${escapeCsv(r.manufacturer)}\n`);
  written++;
}

await new Promise(resolve => out.end(resolve));
console.log(`\nWritten ${written} rows to data/reference_medicines.csv`);
db.close();
