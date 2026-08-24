/**
 * scheduleResearchService — ONE-Google-search schedule discovery for NEW
 * medicines the offline classifier could not place.
 *
 * Flow (user-clicked only, one medicine per run):
 *   1. Build ONE search query from user-entered name + packing + company
 *      (`buildSearchQuery`).
 *   2. Open the Google results page in headless Chrome and take ONE screenshot.
 *   3. OCR that screenshot with Tesseract.js (word-level bounding boxes,
 *      same engine/config family as aiCameraService).
 *   4. Drop filler words (a/the/of/is/mg/strip…) — every ignored word is logged
 *      and returned so the pharmacist sees exactly what was filtered.
 *   5. Match remaining tokens against the official H1 / X / H keyword sets —
 *      exact hits plus typo-similar suggestions ("offloxocin" ≈ ofloxacin).
 *   6. Return screenshot + word boxes so the UI can HIGHLIGHT the matched API
 *      words for the human-in-the-loop confirm step. NOTHING is written to the
 *      DB here — classification is saved only via the explicit POST /classify.
 */
import { Jimp } from 'jimp';
import { createWorker } from 'tesseract.js';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { findChromePath } from '../utils/chromeBrowser.js';
import {
  buildSearchQuery, findScheduleMatches,
  STOP_WORDS, COSMETIC_MARKERS,
  type ScheduleType,
} from '../utils/drugSchedules.js';

export interface ResearchMatch {
  word: string;
  keyword: string;
  schedule: ScheduleType;
  exact: boolean;
  distance: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface ScheduleResearchResult {
  query: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  matches: ResearchMatch[];
  suggestion: 'H1' | 'H' | 'X' | null;
  ignoredWords: string[];
  ocrWordCount: number;
  likelyNonDrug: boolean;
  googleBlocked: boolean;
  engine: 'google' | 'duckduckgo';
}

// ── Lazy resident OCR worker (same pattern as aiCameraService) ──
let ocrWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng', 1, {
      langPath: process.cwd(), // local eng.traineddata at repo root
      gzip: false,
    }).then((worker) => worker);
  }
  return ocrWorkerPromise;
}

// ── Single-flight guard: a double-click must never spawn two Chromes ──
let inFlight: Promise<ScheduleResearchResult> | null = null;

const GOOGLE_SEARCH_URL = 'https://www.google.com/search?hl=en&gl=in&num=10&q=';
// Lightweight server-rendered SERP — used ONLY when Google shows its bot-check,
// and always labeled in the response so the UI stays truthful about the engine.
const DDG_SEARCH_URL = 'https://html.duckduckgo.com/html/?q=';

async function captureSerpPage(url: string, resultSelector: string[]): Promise<{ png: Buffer; blocked: boolean }> {
  const chromePath = findChromePath({ includeEdge: true });
  if (!chromePath) throw new Error('NO_CHROME');
  const puppeteer = await getPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: { width: 1280, height: 1400 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,1400',
      '--lang=en-IN',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector(resultSelector.join(', '), { timeout: 20_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200)); // let late-painted result text settle

    const pageUrl = page.url();
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '');
    const blocked =
      pageUrl.includes('/sorry') ||
      pageUrl.includes('ipv4.google.com/sorry') ||
      /unusual traffic|not a robot|enable images|verify you are/i.test(bodyText);

    const png = await page.screenshot({ encoding: 'binary', fullPage: true }) as unknown as Buffer;
    return { png, blocked };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureSearchResults(query: string): Promise<{ png: Buffer; engine: 'google' | 'duckduckgo'; blocked: boolean }> {
  // Primary: Google (owner requirement). Fallback: DuckDuckGo when bot-checked.
  const google = await captureSerpPage(GOOGLE_SEARCH_URL + encodeURIComponent(query), ['#search', '#rso']);
  if (!google.blocked) return { ...google, engine: 'google' };
  console.warn('[ScheduleResearch] Google bot-check hit — falling back to DuckDuckGo HTML results.');
  const ddg = await captureSerpPage(DDG_SEARCH_URL + encodeURIComponent(query), ['.result', '.results_links']);
  return { png: ddg.png, engine: 'duckduckgo', blocked: ddg.blocked };
}

export async function researchMedicineSchedule(medicine: {
  id: number;
  name: string;
  packaging?: string | null;
  manufacturer?: string | null;
}): Promise<ScheduleResearchResult> {
  if (inFlight) return inFlight;
  inFlight = doResearch(medicine).finally(() => { inFlight = null; });
  return inFlight;
}

async function doResearch(medicine: {
  id: number;
  name: string;
  packaging?: string | null;
  manufacturer?: string | null;
}): Promise<ScheduleResearchResult> {
  const query = buildSearchQuery(medicine);

  // ── ONE search → ONE screenshot (Google primary, labeled DDG fallback) ──
  const { png, blocked, engine } = await captureSearchResults(query);

  // ── OCR the screenshot with word boxes ──
  // tesseract.js v7 nests words under blocks → paragraphs → lines → words.
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(png, {}, { blocks: true });

  const jimpImage = await Jimp.read(png);
  const imageWidth = jimpImage.bitmap.width;
  const imageHeight = jimpImage.bitmap.height;

  type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
  const words: OcrWord[] = (data.blocks || []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) =>
        line.words.map((w) => ({
          text: String(w.text || ''),
          confidence: w.confidence,
          bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
        })),
      ),
    ),
  );

  // ── Filler-word filtering (logged) + schedule matching ──
  const keptTokens: string[] = [];
  const tokenBox = new Map<string, OcrWord>();
  const ignoredWords: string[] = [];
  const seenIgnored = new Set<string>();

  for (const w of words) {
    const token = String(w.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!token || /^\d+$/.test(token)) continue; // numbers/punctuation — not words
    if (STOP_WORDS.has(token)) {
      if (!seenIgnored.has(token)) { seenIgnored.add(token); ignoredWords.push(token); }
      continue;
    }
    if (token.length < 4) continue; // fragments like "mg" leftovers, "10", "ab"
    keptTokens.push(token);
    if (!tokenBox.has(token)) tokenBox.set(token, w);
  }

  const found = findScheduleMatches(keptTokens);
  const matches: ResearchMatch[] = found.matches.map((m) => ({ ...m }));
  for (const m of matches) {
    const box = tokenBox.get(m.word);
    if (box) m.bbox = box.bbox;
  }

  // Strictest confirmed hit wins the suggestion (X > H1 > H), else fuzzy hint.
  const exactMatches = matches.filter((m) => m.exact);
  const order: Array<'X' | 'H1' | 'H'> = ['X', 'H1', 'H'];
  let suggestion: 'H1' | 'H' | 'X' | null = null;
  for (const s of order) {
    if (exactMatches.some((m) => m.schedule === s)) { suggestion = s; break; }
  }
  if (!suggestion && matches.length > 0 && matches.every((m) => m.schedule === matches[0].schedule)) {
    suggestion = matches[0].schedule; // unanimous fuzzy-only hint
  }

  const lowerName = String(medicine.name || '').toLowerCase();
  const likelyNonDrug = [...COSMETIC_MARKERS].some((c) => lowerName.includes(c));

  console.log(
    `[ScheduleResearch] med#${medicine.id} q="${query}" engine=${engine} blocked=${blocked} ` +
    `ocrWords=${words.length} kept=${keptTokens.length} ignored=${ignoredWords.length} ` +
    `matches=${matches.map((m) => `${m.word}→${m.keyword}:${m.schedule}${m.exact ? '' : '(fuzzy)'}`).join(', ') || 'none'}`
  );

  return {
    query,
    imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    imageWidth,
    imageHeight,
    matches,
    suggestion,
    ignoredWords,
    ocrWordCount: words.length,
    likelyNonDrug,
    googleBlocked: blocked,
    engine,
  };
}
