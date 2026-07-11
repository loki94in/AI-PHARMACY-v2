// scanGateAlgorithms.ts — different "skip vs identify" algorithms for the
// WhatsApp medicine-image scan gate. Each variant is a pure, offline
// decision function: given OCR text + the extracted potential name, decide
// 'skip' (not a medicine — don't scan/escalate) or 'identify'.
//
// The variants form a spectrum from permissive (few skips) to strict
// (many skips). Run scan_benchmark.ts to compare them on a
// labelled set + real scans from the test-image folder.
//
// NO LLM is used — only app logic (string heuristics + the seeded
// medicine_reference API dictionary when a knownApi set is supplied).

import { isPlausibleMedicineName } from './src/services/intentKeywords.js';

export type GateDecision = 'skip' | 'identify';
export interface GateCtx {
  // Set of known API strings (lowercased) from medicine_reference.
  knownApis?: Set<string>;
}
export interface GateVariant {
  id: string;          // e.g. 'V1'
  name: string;        // e.g. 'Conservative'
  description: string; // what it skips / what it adds
  decide(ocrText: string, potentialName: string, ctx?: GateCtx): GateDecision;
}

// ─── Shared heuristics ───────────────────────────────────────────────

const DOC_SIGNS = [
  'invoice', 'bill no', 'booking', 'ticket', 'train', 'flight', 'pnr',
  'rail', 'journey', 'boarding', 'passenger', 'fare', 'seat', 'berth', 'airline',
  'bank', 'payment', 'receipt', 'statement', 'aadhaar', 'aadhar', 'pan card',
  'gst', 'tax invoice', 'salary', 'payslip', 'order id', 'tracking', 'courier',
  'transaction', 'upi', 'neft', 'imps', 'shipment', 'waybill', 'consignment',
  'biscuit', 'chocolate', 'snack', 'shampoo', 'soap', 'detergent',
  'namkeen', 'chips', 'restaurant', 'menu', 'hotel', 'wb.', 'wb ', 'pnr no',
];

const STRONG_DOC_SIGNS = [
  'invoice', 'booking', 'ticket', 'train', 'flight', 'pnr', 'rail',
  'boarding', 'passenger', 'fare', 'berth', 'airline', 'bank', 'payment',
  'receipt', 'statement', 'aadhaar', 'aadhar', 'gst', 'tax invoice',
  'salary', 'payslip', 'tracking', 'courier', 'transaction', 'upi', 'neft',
  'imps', 'shipment', 'waybill', 'consignment',
];

const DOSE_FORMS = [
  'tablet', 'tablets', 'tab', 'capsule', 'capsules', 'cap', 'syrup', 'syp',
  'suspension', 'susp', 'injection', 'inj', 'drops', 'drop', 'eye drop',
  'ear drop', 'ointment', 'oint', 'cream', 'gel', 'lotion', 'powder', 'spray',
  'inhaler', 'sachet', 'solution', 'tonic',
];

const STRENGTH_RE = /\b\d+\s?(mg|mcg|g|ml|iu|%|w\/v|wv|gm)\b/i;

function countDocSigns(t: string): number {
  let n = 0;
  for (const s of DOC_SIGNS) if (t.includes(s)) n++;
  return n;
}
function hasStrongDoc(t: string): boolean {
  return STRONG_DOC_SIGNS.some(s => t.includes(s));
}
function hasDoseForm(t: string): boolean {
  return DOSE_FORMS.some(f => t.includes(f));
}
function hasStrength(t: string): boolean {
  return STRENGTH_RE.test(t);
}
function hasKnownApi(t: string, ctx?: GateCtx): boolean {
  const set = ctx?.knownApis;
  if (!set || set.size === 0) return false;
  const tl = t.toLowerCase();
  for (const a of set) {
    if (a && tl.includes(a.toLowerCase())) return true;
  }
  return false;
}

// ─── Variants ───────────────────────────────────────────────────────

export const GATE_VARIANTS: GateVariant[] = [
  {
    id: 'V1',
    name: 'Conservative',
    description: 'Adds: any plausible name. Skips: only when a plausible name is missing AND >=2 weak doc signs. Fewest skips.',
    decide(ocrText, potentialName, ctx) {
      const name = (potentialName || '').trim();
      if (!name || !isPlausibleMedicineName(name)) return 'skip';
      if (countDocSigns(ocrText.toLowerCase()) >= 2) return 'skip';
      return 'identify';
    },
  },
  {
    id: 'V2',
    name: 'Signal-Required',
    description: 'Adds: only when OCR shows a dose-form OR strength OR known API. Skips: plausible name without any medicine signal (aggressive skip).',
    decide(ocrText, potentialName, ctx) {
      const name = (potentialName || '').trim();
      if (!name || !isPlausibleMedicineName(name)) return 'skip';
      const t = ocrText.toLowerCase();
      const hasSignal = hasDoseForm(t) || hasStrength(t) || hasKnownApi(t, ctx);
      return hasSignal ? 'identify' : 'skip';
    },
  },
  {
    id: 'V3',
    name: 'Doc-Strict',
    description: 'Adds: any plausible name. Skips: if ANY strong document sign present (invoice/booking/train/bank/...).',
    decide(ocrText, potentialName, ctx) {
      const name = (potentialName || '').trim();
      if (!name || !isPlausibleMedicineName(name)) return 'skip';
      if (hasStrongDoc(ocrText.toLowerCase())) return 'skip';
      return 'identify';
    },
  },
  {
    id: 'V4',
    name: 'Hybrid-Balanced',
    description: 'Adds: any plausible name. Skips: if >=1 doc sign (any). Middle ground between V1 and V3.',
    decide(ocrText, potentialName, ctx) {
      const name = (potentialName || '').trim();
      if (!name || !isPlausibleMedicineName(name)) return 'skip';
      if (countDocSigns(ocrText.toLowerCase()) >= 1) return 'skip';
      return 'identify';
    },
  },
  {
    id: 'V5',
    name: 'Dictionary-First',
    description: 'Adds: only when OCR contains a known API (from medicine_reference) OR both dose-form AND strength. Skips: everything else. Most strict.',
    decide(ocrText, potentialName, ctx) {
      const name = (potentialName || '').trim();
      if (!name || !isPlausibleMedicineName(name)) return 'skip';
      const t = ocrText.toLowerCase();
      const ok = hasKnownApi(t, ctx) || (hasDoseForm(t) && hasStrength(t));
      return ok ? 'identify' : 'skip';
    },
  },
];
