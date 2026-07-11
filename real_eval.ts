// real_eval.ts — run the 5 gate variants on REAL OCR from the test folder.
import fs from 'fs';
import { GATE_VARIANTS as VARIANTS } from './scanGateAlgorithms.js';

function loadApis(): Set<string> {
  const s = new Set<string>();
  for (const p of ['data/apiDictionary.json', 'data/medicine_reference_seed.json']) {
    try {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const e of arr) {
        const a = typeof e === 'string' ? e : (e.api || e.name || e.ingredient || '');
        if (a && typeof a === 'string') s.add(a.trim().toLowerCase());
      }
    } catch {}
  }
  return s;
}

const apis = loadApis();
const ctx = { knownApis: apis };

const real: { id: string; ocr: string; potential: string }[] = [
  {
    id: 'R01',
    ocr: 'ithromycin Tablets IP 500 mg\nzicip S500 Bil\npla',
    potential: 'ithromycin',
  },
  {
    id: 'R02',
    ocr: 'NM X es\nwh La md ik fo -\nSE a\nak Yin\nTAR ak -\nFER as LE J d\ny A F Fe a i od\n7 WEEER Hit P -\nENT I 1 -\ner Be oy .\nCob Loy BE ITT\nZF Elina iret\n- peed\nERT Fishin ger HL\nEE i RN CO\nEs eto arene Cnr de J\nfh dd i Fan Pls IRZETE iil 2\nUa Geta anti te\nBl i Em Tl ft 1\nI He Ton ed by the nica il i\nzg ii ET\nFR\nhi Ji IR TT A ih\nI THIN kta nova oud Hon Git. he\n7 he J i otra. vie ll ne UR 14 woz TC\nSSE 11 Re Sel EY 8\nol ge if SP lI8',
    potential: 'elina iret',
  },
];

console.log('=== REAL FOLDER OCR — decision per variant ===');
console.log('id | potential    | V1          | V2          | V3          | V4          | V5');
for (const r of real) {
  const d = VARIANTS.map((v) => v.decide(r.ocr, r.potential, ctx).padEnd(11));
  console.log(`${r.id} | ${r.potential.padEnd(12)} | ${d.join(' | ')}`);
}
console.log('\n(V1 Conservative, V2 Signal-Required, V3 Doc-Strict, V4 Hybrid-Balanced, V5 Dictionary-First)');
