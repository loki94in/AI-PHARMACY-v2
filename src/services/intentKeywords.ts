// Intent keywords and text parser for WhatsApp medicine requests.
// Pure data + small functions. No network calls.
import { dbManager } from '../database/connection.js';

// --- Intent words: is the message a medicine order request? ---

const INTENT_WORDS_EN = new Set([
  'send', 'order', 'need', 'want', 'give', 'refill', 'same', 'required',
  'chahiye', 'bhej', 'do', 'dena', 'lao', 'mangta'
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
  'delivery', 'deliver', 'asap'
]);

export interface ParsedMessage {
  isMedicineRequest: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  rawIntentWords: string[];
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

  // If we found a medicine name, treat it as a request even without explicit intent words
  const hasIntent = foundIntentWords.length > 0 || medicineName.length > 0;

  return {
    isMedicineRequest: hasIntent,
    medicineName,
    quantity: quantity || 1, // default to 1 if not specified
    unit: unit || (quantity > 0 ? 'unit' : ''),
    rawIntentWords: foundIntentWords
  };
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
