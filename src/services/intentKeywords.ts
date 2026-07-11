// Intent keywords and text parser for WhatsApp medicine requests.
// Pure data + small functions. No network calls.
import { dbManager } from '../database/connection.js';

// --- Intent words: is the message a medicine order request? ---

const INTENT_WORDS_EN = new Set([
  'send', 'order', 'need', 'want', 'give', 'refill', 'same', 'required',
  'chahiye', 'bhej', 'dena', 'dedo', 'lao', 'mangta', 'pathva', 'pathav'
]);

const INTENT_WORDS_HI = new Set([
  'भेज', 'भेजो', 'दो', 'दे', 'देना', 'चाहिए', 'हवं', 'दवा', 'दवाई',
  'गोली', 'ऑर्डर', 'मंगवाओ', 'लाओ', 'लगता'
]);

const INTENT_WORDS_MR = new Set([
  'पाठवा', 'द्या', 'दया', 'औषध', 'लागतं', 'करा', 'हवं', 'गोळी',
  'ऑर्डर', 'पाठवून'
]);

// --- Quantity unit words (Hindi/English informal) ---

const QUANTITY_UNITS: Record<string, string> = {
  // English
  packet: 'packet', packets: 'packet', pack: 'packet', packs: 'packet',
  strip: 'strip', strips: 'strip',
  box: 'box', boxes: 'box',
  bottle: 'bottle', bottles: 'bottle',
  tablet: 'tablet', tablets: 'tablet', tab: 'tablet', tabs: 'tablet',
  capsule: 'capsule', capsules: 'capsule', cap: 'capsule', caps: 'capsule',
  // Hindi/informal
  pakite: 'packet', pakit: 'packet', pkt: 'packet',
  dabba: 'box', dabba_: 'box',
  peti: 'box',
  goli: 'tablet', goliyan: 'tablet',
  shishi: 'bottle',
  patti: 'strip'
};

// --- Noise words to filter out from medicine name extraction ---

const NOISE_WORDS = new Set([
  'please', 'plz', 'pls', 'bhai', 'sir', 'ji', 'health', 'medical',
  'pharmacy', 'store', 'shop', 'the', 'and', 'or', 'of', 'for', 'is',
  'me', 'mujhe', 'mera', 'mere', 'ko', 'ka', 'ki', 'ke', 'se', 'hai',
  'hain', 'ho', 'ek', 'do_', 'teen', 'char', 'aur', 'ya', 'bhi',
  'hello', 'hi', 'hey', 'good', 'morning', 'evening', 'night',
  'thank', 'thanks', 'thankyou', 'ok', 'okay', 'yes', 'no', 'urgently',
  'urgent', 'jaldi', 'abhi', 'aaj', 'kal', 'today', 'tomorrow',
  'delivery', 'deliver', 'asap',
  // Greetings / Conversational English/Hinglish
  'hii', 'hiii', 'heyy', 'heyya', 'helloo', 'yoo', 'ola', 'namaste', 'namaskar',
  'ram', 'shubh', 'pranam', 'gm', 'gn', 'tc', 'bye', 'gd', 'mrng', 'evng',
  // Marathi / Hindi conversational and question words
  'aahe', 'ahe', 'ahae', 'na', 're', 'pan', 'pn', 'ca', 'cha', 'ta', 'te', 'ti', 'to',
  'nhi', 'nahi', 'nahy', 'nakot', 'navhate', 'havey', 'have', 'pahije', 'pahijey',
  'kya', 'kab', 'kaha', 'kaise', 'kon', 'koni', 'kona', 'konala', 'kasa', 'kashi', 'kase', 'kasala',
  'yevo', 'yeu', 'yeto', 'yete', 'yetat', 'gheu', 'gheto', 'ghete', 'ghetat', 'havat', 'hvae', 'haye',
  'kahi', 'kahich', 'pun', 'var', 'war', 'ch', 'c', 'sathi', 'sathy', 'sobat', 'nko', 'nako',
  'parva', 'ata', 'atta', 'nantar', 'karan', 'mag', 'vel', 'wele', 'time', 'date', 'month', 'year',
  'divas', 'diwas', 'roj', 'roji', 'daily', 'weekly', 'monthly',
  'mi', 'majhe', 'maza', 'mazi', 'mazya', 'tuzhe', 'tuza', 'tuzi', 'tuzya', 'aamhi', 'amhi', 'aamche',
  'tumhi', 'tumche', 'te', 'tya', 'tyanche', 'tyacha', 'tyachi', 'tyachya', 'hye', 'he', 'ha', 'hi', 'he',
  'ya', 'hyanchi', 'hyancha',
  // More Marathi/Hindi conversational leaks observed in production
  'asudet', 'asu', 'asel', 'aslel', 'aahet', 'ahet', 'hote', 'hota', 'hoti', 'zale', 'zala', 'zali',
  'baki', 'bakiche', 'bakichya', 'urlele', 'shillak',
  'milel', 'milte', 'milto', 'milali', 'milala', 'bhetel', 'bhetla', 'bhetli',
  'kadhi', 'kevha', 'udya', 'udhya', 'sandhyakali', 'sakali', 'dupari', 'ratri',
  'thik', 'theek', 'thike', 'barobar', 'hoy', 'chalel', 'chala', 'done', 'accha', 'acha', 'bara', 'bar',
  'madam', 'tai', 'dada', 'kaka', 'anna', 'bhau', 'saheb',
  // Common Devanagari chatter (greetings/particles/questions)
  'ना', 'नाही', 'आहे', 'आहेत', 'का', 'हो', 'हा', 'नको', 'ठीक', 'बाकी', 'आज', 'उद्या',
  'कधी', 'केव्हा', 'कसे', 'कसा', 'काय', 'क्या', 'कब', 'कहा', 'कैसे', 'हां', 'हाँ', 'जी',
  'नमस्ते', 'नमस्कार', 'धन्यवाद'
]);

export interface ParsedMessage {
  isMedicineRequest: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  rawIntentWords: string[];
}

/**
 * Is this extracted string plausibly a medicine name?
 * Used by BOTH the text-parse path and the OCR path before any search runs.
 * Rules: length >= 3, not pure numbers/punctuation (blocks "118", "118 2"),
 * at least 3 Latin letters (catalog/medicine names are Latin — blocks
 * Devanagari-only chatter and emoji), and not made up entirely of noise words.
 */
export function isPlausibleMedicineName(name: string): boolean {
  const trimmed = (name || '').trim();
  if (trimmed.length < 3) return false;
  if (/^[\d\s.,/\-]+$/.test(trimmed)) return false;
  const latinLetters = trimmed.match(/[a-zA-Z]/g);
  if (!latinLetters || latinLetters.length < 3) return false;
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every(t => NOISE_WORDS.has(t))) return false;
  return true;
}

/**
 * Check if text contains medicine-order intent words (EN/HI/MR).
 */
export function isMedicineRequest(text: string): boolean {
  if (!text) return false;
  const words = text.toLowerCase().trim().split(/\s+/);
  for (const w of words) {
    if (INTENT_WORDS_EN.has(w) || INTENT_WORDS_HI.has(w) || INTENT_WORDS_MR.has(w)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a WhatsApp message to extract medicine name, quantity, and intent.
 * Example: "4 pakite health novastat 20" → { medicineName: "novastat 20", qty: 4, unit: "packet" }
 */
export function parseMessage(text: string): ParsedMessage {
  if (!text || !text.trim()) {
    return { isMedicineRequest: false, medicineName: '', quantity: 0, unit: '', rawIntentWords: [] };
  }

  const words = text.trim().split(/\s+/);
  const lowerWords = words.map(w => w.toLowerCase());

  // Detect intent
  const foundIntentWords: string[] = [];
  for (const w of lowerWords) {
    if (INTENT_WORDS_EN.has(w) || INTENT_WORDS_HI.has(w) || INTENT_WORDS_MR.has(w)) {
      foundIntentWords.push(w);
    }
  }

  // Extract quantity + unit: look for pattern "NUMBER UNIT_WORD"
  let quantity = 0;
  let unit = '';
  const quantityIndices = new Set<number>();

  for (let i = 0; i < lowerWords.length; i++) {
    const num = parseInt(lowerWords[i], 10);
    if (!isNaN(num) && num > 0 && num <= 999) {
      // Check if next word is a unit
      if (i + 1 < lowerWords.length && QUANTITY_UNITS[lowerWords[i + 1]]) {
        quantity = num;
        unit = QUANTITY_UNITS[lowerWords[i + 1]];
        quantityIndices.add(i);
        quantityIndices.add(i + 1);
      } else if (quantity === 0) {
        // Standalone number — could be quantity or part of medicine name (e.g., "novastat 20")
        // Only treat as quantity if it's the first word and small (<=10)
        if (i === 0 && num <= 10) {
          quantity = num;
          quantityIndices.add(i);
        }
        // Otherwise, keep it as part of medicine name (e.g., "20" in "novastat 20")
      }
    }
    // Check for unit word without preceding number (e.g., "strip novastat")
    if (QUANTITY_UNITS[lowerWords[i]] && quantity === 0 && !quantityIndices.has(i)) {
      // Skip — unit without number is just noise
    }
  }

  // Extract medicine name: everything that's NOT a quantity, unit, intent, or noise word
  const medicineWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (quantityIndices.has(i)) continue;
    const lower = lowerWords[i];
    if (INTENT_WORDS_EN.has(lower) || INTENT_WORDS_HI.has(lower) || INTENT_WORDS_MR.has(lower)) continue;
    if (QUANTITY_UNITS[lower]) continue;
    if (NOISE_WORDS.has(lower)) continue;
    // Keep the original case for the medicine name
    medicineWords.push(words[i]);
  }

  const medicineName = medicineWords.join(' ').trim();

  // A residual is only a medicine name if it survives the plausibility rules.
  // Intent words alone can NEVER resurrect an invalid name (e.g. "send 118"
  // must not search "118" — 'do'/'send' + number was a production leak).
  const isValidMedicineName = isPlausibleMedicineName(medicineName);

  // Intent words still mark the message as a request (useful downstream signal),
  // but the searched name must independently be plausible.
  const hasIntent = foundIntentWords.length > 0 || isValidMedicineName;

  const finalMedicineName = isValidMedicineName ? medicineName : '';

  return {
    isMedicineRequest: hasIntent,
    medicineName: finalMedicineName,
    quantity: quantity || 1, // default to 1 if not specified
    unit: unit || (quantity > 0 ? 'unit' : ''),
    rawIntentWords: foundIntentWords
  };
}

/**
 * Detect dosage form (Tablet / Capsule / Syrup / Suspension / Drops / Injection…)
 * from free text — used for text-only WhatsApp messages (the image path already
 * detects form via aiCameraService.detectDosageForm). Keeps the same pattern set
 * so text and OCR agree on the form label.
 */
export function detectDosageForm(text: string): string | null {
  if (!text) return null;
  const patterns: [RegExp, string][] = [
    [/\b(?:tab(?:let)?s?)\b/i, 'Tablet'],
    [/\b(?:cap(?:sule)?s?)\b/i, 'Capsule'],
    [/\b(?:syp|syrup)\b/i, 'Syrup'],
    [/\b(?:susp(?:ension)?)\b/i, 'Suspension'],
    [/\b(?:inj(?:ection)?)\b/i, 'Injection'],
    [/\b(?:gel)\b/i, 'Gel'],
    [/\b(?:cream)\b/i, 'Cream'],
    [/\b(?:drops?|eye\s*drops?|ear\s*drops?)\b/i, 'Drops'],
    [/\b(?:oint(?:ment)?)\b/i, 'Ointment'],
    [/\b(?:lotion)\b/i, 'Lotion'],
    [/\b(?:powder)\b/i, 'Powder'],
    [/\b(?:spray)\b/i, 'Spray'],
    [/\b(?:inh(?:aler)?)\b/i, 'Inhaler'],
    [/\b(?:sachet)\b/i, 'Sachet'],
    [/\b(?:solution)\b/i, 'Solution'],
  ];
  for (const [regex, form] of patterns) {
    if (regex.test(text)) return form;
  }
  return null;
}

/**
 * Quick check if text looks like "same" / "repeat" / "wahi" — meaning repeat last order.
 */
export function isRepeatRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const repeatWords = ['same', 'wahi', 'wohi', 'repeat', 'fir se', 'phir se', 'same order', 'last wala'];
  return repeatWords.some(w => lower.includes(w));
}

// ─── Scan Gate: is an OCR'd image actually a medicine? ──────────────────
// Runs on EVERY OCR result BEFORE any search/escalation, so booking
// screenshots, tickets, bank/finance docs, food packets and random photos
// are skipped instead of triggering pointless scans + admin escalations.
// Pure + offline (no DB/network) so it is cheap to call per image.

const NON_MEDIA_DOC_SIGNS = [
  // Travel / tickets
  'invoice', 'bill no', 'booking', 'ticket', 'train', 'flight', 'pnr',
  'rail', 'journey', 'boarding', 'passenger', 'fare', 'seat', 'berth', 'airline',
  // Finance / documents
  'bank', 'payment', 'receipt', 'statement', 'aadhaar', 'aadhar', 'pan card',
  'gst', 'tax invoice', 'salary', 'payslip', 'order id', 'tracking', 'courier',
  'transaction', 'upi', 'neft', 'imps', 'shipment', 'waybill', 'consignment',
  // Food / non-pharma retail
  'biscuit', 'chocolate', 'snack', 'shampoo', 'soap', 'detergent',
  'namkeen', 'chips', 'restaurant', 'menu', 'hotel',
];

/**
 * Decide whether an OCR'd image is plausibly a medicine (strip/pack/label)
 * rather than a non-medicine document or random photo.
 *
 * Logic: a plausible Latin medicine name must already have been extracted
 * (isPlausibleMedicineName). Then we only BLOCK when the OCR text carries
 * >= 2 non-medicine document signatures (booking/ticket/bill/food). This is
 * conservative: real medicine strips rarely contain those words, so they pass;
 * train tickets / invoices / biscuits get skipped. A single stray word never
 * blocks a real medicine.
 */
export function isMedicineLikely(ocrText: string, potentialName?: string): boolean {
  const name = (potentialName || '').trim();
  if (!name || !isPlausibleMedicineName(name)) return false;

  const text = (ocrText || '').toLowerCase();
  let docHits = 0;
  for (const sign of NON_MEDIA_DOC_SIGNS) {
    if (text.includes(sign)) {
      docHits++;
      if (docHits >= 2) return false;
    }
  }
  return true;
}
