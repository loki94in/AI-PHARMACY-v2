// scan_benchmark.ts — compare the skip/identify gate variants on a
// labelled set + real scans from the WhatsApp test-image folder.
//
// NO LLM used — pure app logic (scanGateAlgorithms + real OCR via
// aiCameraService, and the seeded medicine_reference API dictionary).
//
// Run:  npx tsx scan_benchmark.ts

import { GATE_VARIANTS, GateVariant } from './scanGateAlgorithms.js';
import { aiCameraService } from './src/services/aiCameraService.js';
import { dbManager } from './src/database/connection.js';
import fs from 'fs';
import path from 'path';

interface Case {
  id: string;          // unique "login" per sample
  name: string;        // the medicine / item name (shared for review)
  truth: 'medicine' | 'nonmed';
  ocr: string;        // representative OCR text
  potential: string;    // extracted potential name
  real?: boolean;     // came from a real folder scan
}

// ─── 10 medicine names (mini labelled set) ───────────────────────
const MEDICINES: Case[] = [
  { id: 'M01', name: 'NEVANAC',     truth: 'medicine', ocr: 'Nevanac Nepafenac Ophthalmic Suspension 0.1% w/v 5ml Alcon',            potential: 'Nevanac' },
  { id: 'M02', name: 'AUGMENTIN',   truth: 'medicine', ocr: 'Augmentin 625 Duo Tablet Amoxycillin Clavulanic Acid 10 tablets', potential: 'Augmentin 625' },
  { id: 'M03', name: 'PARACETAMOL',  truth: 'medicine', ocr: 'Crocin Paracetamol 500mg Tablet 15\'s',                          potential: 'Crocin' },
  { id: 'M04', name: 'AZITHROMYCIN',truth: 'medicine', ocr: 'Azithral 500 Azithromycin 500mg Tablet',                              potential: 'Azithral 500' },
  { id: 'M05', name: 'CETIRIZINE',  truth: 'medicine', ocr: 'Cetzine Cetirizine 10mg Tablet',                                    potential: 'Cetzine' },
  { id: 'M06', name: 'PAN',          truth: 'medicine', ocr: 'PAN 40mg Tablet Pantoprazole',                                   potential: 'PAN 40mg' },
  { id: 'M07', name: 'MOXIFLOXACIN',truth: 'medicine', ocr: 'Vigamox Moxifloxacin 0.5% w/v Eye Drops',                            potential: 'Vigamox' },
  { id: 'M08', name: 'MONTELUKAST', truth: 'medicine', ocr: 'Montair Montelukast 10mg Tablet',                                    potential: 'Montair' },
  { id: 'M09', name: 'IBUPROFEN',   truth: 'medicine', ocr: 'Brufen Ibuprofen 400mg Tablet',                                       potential: 'Brufen' },
  { id: 'M10', name: 'ONDANSETRON', truth: 'medicine', ocr: 'Emeset Ondansetron 4mg Tablet',                                        potential: 'Emeset' },
];

// ─── negative (non-medicine) samples ───────────────────────────────
const NONMED: Case[] = [
  { id: 'N01', name: 'BOOKING', truth: 'nonmed', ocr: 'Invoice No INV123 Date 07/07/2026 Train PNR 223344 Booking Journey Passenger Fare Sleeper Class Cancellat', potential: 'CANCELLED ITEM' },
  { id: 'N02', name: 'BISCUITS', truth: 'nonmed', ocr: 'Good Day Biscuits 250g Butter Flavour', potential: 'Good Day' },
  { id: 'N03', name: 'CHATTER', truth: 'nonmed', ocr: 'Happy Birthday! Party at 7pm',            potential: 'Happy Birthday' },
  { id: 'N04', name: 'BANK STMT', truth: 'nonmed', ocr: 'Bank Statement SB A/C XXXX UPI collected INR 500', potential: 'Bank Statement' },
];

async function loadKnownApis(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT name, composition1 FROM medicine_reference');
    await dbManager.close();
    for (const r of rows) {
      if (r.name) set.add(String(r.name).toLowerCase());
      if (r.composition1) set.add(String(r.composition1).toLowerCase());
    }
  } catch (e) {
    console.warn('Could not load medicine_reference for dictionary variant:', e);
  }
  return set;
}

async function runRealFolderScans(folder: string): Promise<Case[]> {
  const out: Case[] = [];
  if (!fs.existsSync(folder)) return out;
  const files = fs.readdirSync(folder).filter(f => /\.(jpe?g|png)$/i.test(f));
  for (let i = 0; i < files.length; i++) {
    const fp = path.join(folder, files[i]);
    let ocr = '';
    let potential = '';
    try {
      const buf = fs.readFileSync(fp);
      const to = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('OCR timeout 25s')), 25000));
      const res = await Promise.race([aiCameraService.processImage(buf, true), to]);
      ocr = (res.text || '').trim();
      potential = res.medicineInfo?.potentialName || '';
    } catch (e: any) {
      ocr = `[OCR FAILED: ${e?.message || e}]`;
    }
    out.push({
      id: `R${String(i + 1).padStart(2, '0')}`,
      name: files[i],
      truth: 'medicine', // unknown until reviewed; shown for variant decisions only
      ocr,
      potential,
      real: true,
    });
  }
  return out;
}

function evaluate(cases: Case[], known: Set<string>) {
  const ctx = { knownApis: known };
  const rows = cases.map(c => {
    const row: Record<string, string> = {
      id: c.id,
      name: c.name.length > 16 ? c.name.slice(0, 15) + '…' : c.name,
      truth: c.truth,
    };
    for (const v of GATE_VARIANTS) {
      row[v.id] = v.decide(c.ocr, c.potential, ctx);
    }
    return row;
  });

  const metrics = GATE_VARIANTS.map(v => {
    let TP = 0, FP = 0, FN = 0, TN = 0;
    for (const c of cases) {
      const exp = c.truth === 'medicine' ? 'identify' : 'skip';
      const got = (rows.find(r => r.id === c.id) as any)[v.id];
      if (exp === 'identify') got === 'identify' ? TP++ : FN++;
      else got === 'skip' ? TN++ : FP++;
    }
    return { v, TP, FP, FN, TN, acc: (TP + TN) / cases.length, total: cases.length };
  });

  return { rows, metrics };
}

function printTable(title: string, rows: Record<string, string>[]) {
  console.log(`\n### ${title}`);
  const cols = ['id', 'name', 'truth', ...GATE_VARIANTS.map(v => v.id)];
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => (r[c] || '').length)));
  const line = cols.map((c, i) => (c || '').padEnd(widths[i])).join(' | ');
  console.log(line);
  console.log(cols.map((_, i) => '-'.repeat(widths[i])).join(' | '));
  for (const r of rows) {
    console.log(cols.map((c, i) => (r[c] || '').padEnd(widths[i])).join(' | '));
  }
}

(async () => {
  const known = await loadKnownApis();
  const folder = process.env.SCAN_REAL ? 'E:\\CURRENT PROJECT ON WORKING\\ai cameats whasaap test' : '';
  const real = folder ? await runRealFolderScans(folder) : [];

  const labelled = [...MEDICINES, ...NONMED];
  const { rows, metrics } = evaluate(labelled, known);

  console.log('=== 10 MEDICINE NAMES (mini labelled set) ===');
  for (const m of MEDICINES) console.log(`  ${m.id}: ${m.name}`);

  console.log(`\n=== Dictionary size (medicine_reference APIs): ${known.size} ===`);

  printTable('Labelled set — decision per variant (truth = expected)', rows);

  console.log('\n### Variant summary (labelled: 10 medicine + 4 non-med)');
  console.log('id | name            | TP | FP | FN | TN | accuracy');
  console.log('---|-------------|----|----|----|----|---------');
  let best = metrics[0];
  for (const m of metrics) {
    if (m.acc > best.acc) best = m;
    console.log(
      `${m.v.id} | ${m.v.name.padEnd(14)} | ${String(m.TP).padStart(2)} | ${String(m.FP).padStart(2)} | ${String(m.FN).padStart(2)} | ${String(m.TN).padStart(2)} | ${(m.acc * 100).toFixed(1)}%`
    );
  }
  console.log(`\n>>> BEST VARIANT: ${best.v.id} (${best.v.name}) @ ${(best.acc * 100).toFixed(1)}%`);

  if (!real.length) {
    console.log('\n(Real folder scan skipped — set SCAN_REAL=1 to include it.)');
    return;
  }
  if (real.length) {
    const rrows = real.map(c => {
      const row: Record<string, string> = { id: c.id, name: c.name.slice(0, 14), truth: 'real' };
      for (const v of GATE_VARIANTS) row[v.id] = v.decide(c.ocr, c.potential, { knownApis: known });
      return row;
    });
    printTable('REAL folder scans — variant decisions (no ground truth; review manually)', rrows);
    console.log('\n--- real OCR texts ---');
    for (const c of real) console.log(`[${c.id}] potential="${c.potential}"\n    ocr="${c.ocr.slice(0, 120)}"`);
  }
})().catch(e => { console.error(e); process.exit(1); });
