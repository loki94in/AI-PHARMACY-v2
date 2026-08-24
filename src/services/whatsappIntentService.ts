// WhatsApp Intent Service — central orchestrator for inbound messages.
// Routes messages through: ignore check → customer lookup → text parse → OCR → smart match.
import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { parseMessage, isRepeatRequest, isPlausibleMedicineName, detectDosageForm, isMedicineLikely, extractMedicineCandidates, detectNonAllopathicKind } from './intentKeywords.js';
import { ocrScanQueue } from './ocrScanQueue.js';
import { productNameFilterService } from './productNameFilterService.js';
import { searchCatalog, scoreProductName } from './pharmarackCatalogCache.js';
import { waAdminEscalationService } from './waAdminEscalationService.js';
import { startupSyncCoordinator } from './startupSyncCoordinator.js';
import { GATE_VARIANTS, type GateDecision } from '../../scanGateAlgorithms.js';

// Confidence gate: below these similarity scores a message is discarded as
// chit-chat instead of being broadcast/escalated. Tune here; every discard is
// logged with its score for calibration.
const GATE_WITH_INTENT = 0.60; // explicit intent words, or image (OCR) source
const GATE_IMPLICIT = 0.72;    // bare text with no intent words

/**
 * Does the best match score clear the escalation gate?
 * Exported for unit testing.
 */
export function passesGate(bestScore: number, hasIntentWords: boolean, source: 'text' | 'ocr' | 'both'): boolean {
  const threshold = (hasIntentWords || source !== 'text') ? GATE_WITH_INTENT : GATE_IMPLICIT;
  return bestScore >= threshold;
}

export interface DownloadRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Retry a WhatsApp media download. whatsapp-web.js's downloadMedia() is
 * commonly not ready the instant a message event fires (decryption keys not
 * yet available, especially for @lid-addressed chats) — a single failed or
 * empty attempt must not drop the image silently. Exported for unit testing.
 */
export async function downloadMediaWithRetry(
  downloadFn: () => Promise<{ data?: string } | undefined>,
  options: DownloadRetryOptions = {}
): Promise<{ data?: string } | undefined> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await downloadFn();
      if (result?.data) return result;
      lastErr = new Error('downloadMedia returned no data');
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

const INBOUND_MEDIA_DIR = path.resolve(process.cwd(), 'data', 'inbound_media');

/**
 * Persist a downloaded WhatsApp image to disk immediately after download,
 * before OCR runs — regardless of match outcome, so a customer's photo is
 * never processed and then lost with no trace. Exported for unit testing.
 */
export async function saveInboundMedia(msgId: string, buffer: Buffer): Promise<string> {
  await fs.promises.mkdir(INBOUND_MEDIA_DIR, { recursive: true });
  const safeId = String(msgId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(INBOUND_MEDIA_DIR, `${safeId}.jpg`);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Decide whether an OCR'd image should be treated as a medicine scan.
 * Always runs the structural V2 gate (dose-form / strength / known-API), even
 * when the api_substances dictionary is empty. An empty dictionary narrows
 * the gate to dose-form/strength heuristics only — it must never bypass the
 * gate entirely, or every image (tickets, bills, food packets) gets scanned
 * and escalated to the admin. Exported for unit testing.
 */
export function resolveOcrGateDecision(ocrRaw: string, finalName: string, knownApis: Set<string>): GateDecision {
  const v2Gate = GATE_VARIANTS.find(v => v.id === 'V2');
  if (!v2Gate) return 'skip';
  if (knownApis.size === 0) {
    console.warn('[Intent Service] api_substances is empty; scan gate relying on dose-form/strength heuristics only.');
  }
  return v2Gate.decide(ocrRaw, finalName, { knownApis });
}

interface MatchResult {
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  localMatches: string[];
  catalogResults: { mapped: any[]; nonMapped: any[] } | null;
  confidence: number;
  isRepeat: boolean;
  source: 'text' | 'ocr' | 'both';
  messageBody: string;
}

async function isIgnored(phone: string): Promise<boolean> {
  const db = await dbManager.getConnection();
  const row = await db.get('SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ?', [phone]);
  if (row) {
    return row.reason !== 'unignored';
  }
  const isGroupOrBroadcast = phone.endsWith('@g.us') || phone.endsWith('@broadcast') || phone.includes('broadcast') || phone === 'status@broadcast' || phone.includes('-');
  if (isGroupOrBroadcast) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
        [phone, phone.endsWith('@g.us') ? 'group' : 'broadcast']
      );
    } catch (e) {
      console.warn('[WhatsApp Intent] Failed to auto-insert ignored phone:', e);
    }
  }
  return isGroupOrBroadcast;
}

/**
 * Look up customer by phone number. Returns null if not found (new customer).
 */
async function lookupCustomer(phone: string): Promise<{ id: number; name: string; phone: string } | null> {
  const db = await dbManager.getConnection();
  // Strip country code prefixes and @c.us suffix for matching
  const cleanPhone = phone.replace(/@c\.us$/, '').replace(/^91/, '');
  const row = await db.get(
    `SELECT id, name, phone FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1`,
    [`%${cleanPhone}`, `%${cleanPhone.slice(-10)}`]
  );
  return row || null;
}

/**
 * Get recent refill history for a customer.
 * patient_refills has no customer_id — it is keyed by patient_phone, so we
 * join by the customer's last-10-digit phone (same trick as lookupCustomer).
 */
async function getCustomerHistory(customer: { id: number; phone: string }): Promise<any[]> {
  const db = await dbManager.getConnection();
  const last10 = (customer.phone || '').replace(/\D/g, '').slice(-10);
  if (!last10) return [];
  const rows = await db.all(
    `SELECT m.name AS medicine_name, pr.refill_interval_days, pr.last_refill_date, pr.next_refill_date
     FROM patient_refills pr JOIN medicines m ON m.id = pr.medicine_id
     WHERE pr.patient_phone LIKE ?
     ORDER BY pr.last_refill_date DESC LIMIT 10`,
    [`%${last10}`]
  );
  return rows;
}

export interface CustomerContext {
  purchases: Array<{ date: string; name: string; quantity: number }>;
  refills: Array<{ medicine_name: string; next_refill_date: string | null; last_refill_date: string | null }>;
  lastMessages: Array<{ body: string }>;
}

/**
 * Fetch brief context for an OLD customer so the admin escalation can show
 * what they previously bought and what they were just talking about.
 */
async function getCustomerContext(
  customer: { id: number; phone: string } | null,
  chatId: string | undefined,
  currentMsgId: string | undefined
): Promise<CustomerContext> {
  const context: CustomerContext = { purchases: [], refills: [], lastMessages: [] };
  const db = await dbManager.getConnection();

  if (customer) {
    try {
      context.purchases = await db.all(
        `SELECT si.date, m.name, s.quantity
         FROM sales_invoices si
         JOIN sale_items s ON s.invoice_id = si.id
         JOIN inventory_master im ON im.id = s.inventory_id
         JOIN medicines m ON m.id = im.medicine_id
         WHERE si.customer_id = ?
         ORDER BY si.date DESC LIMIT 5`,
        [customer.id]
      );
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch purchase context:', err);
    }
    try {
      context.refills = (await getCustomerHistory(customer)).slice(0, 3);
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch refill context:', err);
    }
  }

  if (chatId) {
    try {
      context.lastMessages = await db.all(
        `SELECT body FROM whatsapp_messages
         WHERE chat_id = ? AND from_me = 0 AND id != ? AND body != ''
         ORDER BY timestamp DESC LIMIT 2`,
        [chatId, currentMsgId || '']
      );
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch recent messages context:', err);
    }
  }

  return context;
}

/**
 * Main entry point: process an inbound WhatsApp message.
 * Called from whatsappClient.ts message_create handler.
 */
export async function handleInbound(msg: any): Promise<void> {
  try {
    let phone = msg.from || '';
    const chatId = msg.from || msg.to || '';
    const body = msg.body || '';
    const msgId = msg.id?._serialized || msg.id || '';
    const hasMedia = !!msg.hasMedia;

    // Resolve standard phone number if sender is an LID
    if (phone.endsWith('@lid')) {
      try {
        if (msg.client && typeof msg.client.getContactLidAndPhone === 'function') {
          const mapping = await msg.client.getContactLidAndPhone([phone]);
          if (mapping && mapping[0] && mapping[0].pn) {
            phone = `${mapping[0].pn}@c.us`;
          }
        }
        if (phone.endsWith('@lid') && typeof msg.getContact === 'function') {
          const contact = await msg.getContact();
          if (contact && contact.number) {
            phone = `${contact.number}@c.us`;
          }
        }
      } catch (e) {
        console.warn('[Intent Service] Non-fatal LID resolution skipped:', e);
      }
    }

    // 1. IGNORE CHECK
    if (await isIgnored(chatId)) return;

    // Await startup cart synchronization window so existing cart items are loaded
    await startupSyncCoordinator.waitForCartSync();

    // 2. CUSTOMER LOOKUP
    const customer = await lookupCustomer(phone);
    const isNewCustomer = !customer;

    // 3. TEXT PARSE
    const parsed = parseMessage(body);

    // 3b. SCISPACY NLP — run in parallel on the raw message body (fire-and-forget, 1.5s timeout)
    // This catches medicine names that regex/keyword parsing misses (e.g. "do you have azithromycin?")
    // EVERY chemical entity is collected — mixed messages may name several drugs.
    let scispacyNames: string[] = [];
    if (body.trim().length > 3) {
      try {
        const { queryScispacy } = await import('./scispacyClient.js');
        const nlp = await queryScispacy(body);
        if (nlp && nlp.entities) {
          for (const ent of nlp.entities) {
            if (ent.label === 'CHEMICAL' && isPlausibleMedicineName(ent.text)) {
              scispacyNames.push(ent.text);
            }
          }
          // Also check features.drug array
          if (scispacyNames.length === 0 && nlp.features?.drug?.length) {
            scispacyNames = nlp.features.drug.filter((c: string) => isPlausibleMedicineName(c));
          }
        }
      } catch {
        // fail silently — never block message handling
      }
    }

    // 4. REPEAT CHECK — "same", "wahi", etc.
    if (isRepeatRequest(body) && customer) {
      let history: any[] = [];
      try {
        history = await getCustomerHistory(customer);
      } catch (histErr) {
        console.warn('[Intent Service] Refill history lookup failed:', histErr);
      }
      if (history.length > 0) {
        eventService.broadcast('wa_medicine_match', {
          customer,
          isNewCustomer: false,
          medicineName: history[0].medicine_name,
          quantity: 1,
          unit: '',
          localMatches: history.map((h: any) => h.medicine_name),
          catalogResults: null,
          confidence: 95,
          isRepeat: true,
          source: 'text',
          messageBody: body,
          history
        });
        return;
      }
    }

    // 5. MEDIA CHECK — if has image, queue for OCR
    if (hasMedia) {
      try {
        // whatsapp-web.js's downloadMedia() is commonly not ready the instant
        // the event fires (decryption keys not yet available, especially for
        // @lid-addressed chats) — retry before giving up.
        const media = await downloadMediaWithRetry(() => msg.downloadMedia());
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          let imagePath: string | undefined;
          try {
            imagePath = await saveInboundMedia(msgId, buffer);
          } catch (saveErr) {
            console.error('[Intent Service] Failed to persist inbound media to disk:', saveErr);
          }
          ocrScanQueue.enqueue(msgId, buffer, { phone, chatId, messageBody: body, imagePath });
          // OCR result will be handled by ocrScanComplete listener (registered below)
        }
      } catch (mediaErr) {
        console.error('[Intent Service] Failed to download media after retries:', mediaErr);
        try {
          const db = await dbManager.getConnection();
          await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
            phone,
            chatId,
            reason: 'Received an image from this customer but could not download it after 3 attempts.'
          });
        } catch (notifyErr) {
          console.error('[Intent Service] Failed to notify admin of media download failure:', notifyErr);
        }
      }
    }

    // 6. TEXT-BASED SEARCH — MULTI-CANDIDATE. Mixed conversational messages
    // ("bhai kal aa raha hu, dolo 650 aur telma 40 chahiye") must yield EVERY
    // medicine, not one joined garbage query. Candidates come from segment
    // parsing, then scispaCy entities the regex pass missed. Each candidate is
    // independently gated inside searchAndBroadcast (confidence + plausibility),
    // so chit-chat can still never become a false match.
    const seenCandidateNames = new Set<string>();
    const candidates: Array<{ name: string; quantity: number; unit: string; fromScispacy: boolean }> = [];
    const pushCandidate = (name: string | null | undefined, quantity?: number, unit?: string, fromScispacy = false) => {
      const clean = (name || '').trim();
      if (!clean || !isPlausibleMedicineName(clean)) return;
      const key = clean.toLowerCase().replace(/\s+/g, ' ');
      if (seenCandidateNames.has(key)) return;
      seenCandidateNames.add(key);
      candidates.push({ name: clean, quantity: quantity || 1, unit: unit || '', fromScispacy });
    };

    for (const c of extractMedicineCandidates(body)) {
      pushCandidate(c.medicineName, c.quantity, c.unit);
    }
    // Legacy single-parse fallback covers names segmenting would split apart
    // (e.g. a brand containing a conjunction word).
    if (candidates.length === 0 && parsed.isMedicineRequest && parsed.medicineName) {
      pushCandidate(parsed.medicineName, parsed.quantity, parsed.unit);
    }

    // scispaCy rescue — every chemical entity not already covered above.
    for (const chem of scispacyNames) {
      pushCandidate(chem, undefined, undefined, true);
    }

    if (candidates.length > 0) {
      const textForm = detectDosageForm(body);
      if (candidates.some(c => c.fromScispacy)) {
        console.log(`[Intent Service] scispaCy rescued medicine name(s): ${candidates.filter(c => c.fromScispacy).map(c => `"${c.name}"`).join(', ')} (regex missed them)`);
      }
      for (const cand of candidates) {
        await searchAndBroadcast({
          medicineName: cand.name,
          quantity: cand.quantity,
          unit: cand.unit,
          customer,
          isNewCustomer,
          messageBody: body,
          source: hasMedia ? 'both' : 'text',
          dosageForm: textForm || undefined,
          msgId,
          phone,
          chatId,
          hasIntentWords: parsed.rawIntentWords.length > 0 || cand.fromScispacy
        });
      }
    }

  } catch (err) {
    console.error('[Intent Service] Error handling inbound message:', err);
  }
}

/**
 * Resolve REAL active inventory stock for matched master names — a name in the
 * medicines master table (291k imported reference rows) does NOT mean the strip
 * is on the shelf. ONE batched indexed query per message; missing rows simply
 * stay absent from the map. Exported for unit testing.
 */
export async function resolveInventoryStock(
  matchNames: string[],
  db: any
): Promise<Record<string, number>> {
  const stock: Record<string, number> = {};
  const names = [...new Set(matchNames.map(n => String(n).trim()).filter(Boolean))].slice(0, 10);
  if (names.length === 0) return stock;
  try {
    const placeholders = names.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT m.name,
              COALESCE(SUM(CASE WHEN im.is_active = 1
                           THEN (im.quantity + COALESCE(im.loose_quantity, 0))
                           ELSE 0 END), 0) AS total_stock
       FROM medicines m
       LEFT JOIN inventory_master im ON im.medicine_id = m.id
       WHERE LOWER(m.name) IN (${placeholders})
       GROUP BY m.id`,
      names.map(n => n.toLowerCase())
    );
    for (const row of rows || []) {
      if (row?.name) stock[String(row.name).toLowerCase()] = Number(row.total_stock) || 0;
    }
  } catch (err) {
    console.warn('[Intent Service] Inventory stock lookup failed:', err);
  }
  return stock;
}

type Availability = 'IN_STOCK' | 'REGISTERED_NO_STOCK' | 'EXTERNAL_ONLY';

/**
 * Classify where a requested medicine actually lives:
 * IN_STOCK = master match AND active shelf stock; REGISTERED_NO_STOCK =
 * master name only (must order); EXTERNAL_ONLY = found via image/catalog.
 * Exported for unit testing.
 */
export function classifyAvailability(localMatches: string[], inventoryStock: Record<string, number>): Availability {
  if (localMatches.length === 0) return 'EXTERNAL_ONLY';
  const bestStock = Math.max(0, ...localMatches.map(m => inventoryStock[String(m).toLowerCase()] ?? 0));
  return bestStock > 0 ? 'IN_STOCK' : 'REGISTERED_NO_STOCK';
}

/**
 * Search local DB + catalog + Pharmarack for a medicine name and broadcast result to admin.
 */
async function searchAndBroadcast(opts: {
  medicineName: string;
  quantity: number;
  unit: string;
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  messageBody: string;
  source: 'text' | 'ocr' | 'both';
  dosageForm?: string;
  mrp?: number;
  msgId?: string;
  phone?: string;
  chatId?: string;
  hasIntentWords?: boolean;
  imagePath?: string;
}): Promise<void> {
  const { medicineName, quantity, unit, customer, isNewCustomer, messageBody, source, dosageForm, mrp, msgId, phone, chatId, imagePath } = opts;
  const hasIntentWords = !!opts.hasIntentWords;

  // Search local medicines DB (FTS5 + fuzzy match)
  let filterResult;
  try {
    filterResult = await productNameFilterService.filterProductNames(medicineName, {
      minConfidenceThreshold: 0.6,
      dosageForm,
      mrp
    });
  } catch (err) {
    console.error('[Intent Service] Filter service failed:', err);
    filterResult = { matches: [], sources: { local: false, internet: false, catalog: false }, confidence: 0, fallbackUsed: false, processingTimeMs: 0, scoredMatches: [], topScore: 0 };
  }

  // REAL STOCK CHECK — a medicines-master match is not shelf presence.
  // Distinguish IN_STOCK (sellable now) from REGISTERED_NO_STOCK (must order)
  // so neither admin nor customer is ever told "available" wrongly.
  let inventoryStock: Record<string, number> = {};
  try {
    const db = await dbManager.getConnection();
    inventoryStock = await resolveInventoryStock(filterResult.matches, db);
  } catch (dbErr) {
    console.warn('[Intent Service] Inventory stock resolution failed:', dbErr);
  }
  const availability: Availability = classifyAvailability(filterResult.matches, inventoryStock);
  const isExactLocal = (filterResult.topScore ?? 0) >= 0.95;

  // NON-ALLOPATHIC SKIP (owner rule): cosmetic / ayurvedic / homeopathy
  // products must not burn the Pharmarack catalog or live search budget. The
  // request is still broadcast to the admin feed truthfully labeled
  // NON_ALLOPATHIC with its kind; no escalation / shortage tracking fires.
  // Only an EXACT registered local name that is physically IN STOCK takes the
  // normal flow, so a sellable shelf item is never hidden by the label.
  const nonAllopathicKind = detectNonAllopathicKind(medicineName);
  if (nonAllopathicKind && !(isExactLocal && availability === 'IN_STOCK')) {
    console.log(`[Intent Service] Non-allopathic (${nonAllopathicKind}) product "${medicineName}" — external searches skipped`);
    eventService.broadcast('wa_medicine_match', {
      customer,
      isNewCustomer,
      medicineName,
      quantity,
      unit,
      dosageForm,
      localMatches: filterResult.matches,
      inventoryStock,
      availability: 'NON_ALLOPATHIC',
      productKind: nonAllopathicKind,
      catalogResults: null,
      confidence: Math.round((filterResult.topScore ?? 0) * 100),
      source,
      messageBody,
    });
    return;
  }

  // If no local match, also try direct Pharmarack catalog search
  let catalogResults = filterResult.catalogResults || null;
  // Consult Pharmarack whenever there is NO exact local brand match (near-match
  // or no-match), not only when local is completely empty — so admin always sees
  // real distributor availability instead of a possibly-wrong local name.
  if ((filterResult.matches.length === 0 || !isExactLocal || availability === 'REGISTERED_NO_STOCK') && !catalogResults) {
    try {
      catalogResults = await searchCatalog(medicineName, dosageForm, mrp);
    } catch (catErr) {
      console.warn('[Intent Service] Catalog search failed:', catErr);
    }
  }

  const catalogTopScore = () => Math.max(
    catalogResults?.mapped?.[0]?.score ?? 0,
    catalogResults?.nonMapped?.[0]?.score ?? 0
  );

  // Live Pharmarack search as last resort — only with explicit intent (or a
  // photo); a conversational word must never trigger a live API search.
  let livePharmarackResults: any[] | null = null;
  const nothingFound = filterResult.matches.length === 0 &&
    (!catalogResults || (catalogResults.mapped.length === 0 && catalogResults.nonMapped.length === 0));
  if ((nothingFound || !isExactLocal || availability === 'REGISTERED_NO_STOCK') && (hasIntentWords || source !== 'text')) {
    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/pharmarack/search?q=${encodeURIComponent(medicineName)}`, {
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          // Score + filter live results the same way as the offline catalog
          const scored = data
            .map((p: any) => ({ ...p, score: scoreProductName(medicineName, p.name || p.productName || '') }))
            .filter((p: any) => p.score >= 0.6)
            .sort((a: any, b: any) => b.score - a.score);
          if (scored.length > 0) {
            livePharmarackResults = scored;
            catalogResults = {
              mapped: scored.filter((p: any) => p.mapped || p.isMapped),
              nonMapped: scored.filter((p: any) => !(p.mapped || p.isMapped))
            };
          }
        }
      }
    } catch (liveErr) {
      console.warn('[Intent Service] Live Pharmarack search failed:', liveErr);
    }
  }

  // CONFIDENCE GATE — best similarity across local + catalog must clear the
  // threshold, otherwise the message is chit-chat and is silently discarded.
  const bestScore = Math.max(filterResult.topScore ?? 0, catalogTopScore());
  if (!passesGate(bestScore, hasIntentWords, source)) {
    console.log(`[Intent Service] Gate: discarding "${medicineName}" (bestScore=${bestScore.toFixed(2)}, intent=${hasIntentWords}, source=${source}). Not a medicine.`);
    // Forward the actual photo to the pharmacy when the app is unsure — an
    // image with real OCR text that still can't clear the confidence gate
    // is exactly the "not sure" case, so a human should see it, not a log line.
    if (source !== 'text' && imagePath) {
      try {
        const db = await dbManager.getConnection();
        await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
          phone: phone || customer?.phone || '',
          chatId,
          imagePath,
          reason: `Found "${medicineName}" in this photo but the match confidence was too low to auto-identify (score ${Math.round(bestScore * 100)}%).`
        });
      } catch (notifyErr) {
        console.error('[Intent Service] Failed to notify admin of uncertain scan:', notifyErr);
      }
    }
    return;
  }
  const confidence = Math.round(bestScore * 100);

  // Get customer history + context (old customers only) — must never break the flow
  let history: any[] = [];
  if (customer) {
    try {
      history = await getCustomerHistory(customer);
    } catch (histErr) {
      console.warn('[Intent Service] Refill history lookup failed:', histErr);
    }
  }
  let context: CustomerContext | undefined;
  try {
    context = await getCustomerContext(customer, chatId, msgId);
  } catch (ctxErr) {
    console.warn('[Intent Service] Customer context lookup failed:', ctxErr);
  }

  // Broadcast to admin UI
  eventService.broadcast('wa_medicine_match', {
    customer,
    isNewCustomer,
    medicineName,
    quantity,
    unit,
    dosageForm,
    localMatches: filterResult.matches,
    inventoryStock,
    availability,
    catalogResults,
    confidence,
    isRepeat: false,
    source,
    messageBody,
    history,
    livePharmarackResults
  });

  // Fire-and-forget escalation logic
  waAdminEscalationService.maybeEscalate({
    customer,
    isNewCustomer,
    medicineName,
    quantity,
    unit,
    dosageForm,
    localMatches: filterResult.matches,
    inventoryStock,
    availability,
    catalogResults,
    confidence,
    isRepeat: false,
    source,
    messageBody,
    history,
    msgId,
    phone,
    chatId,
    context
  }).catch(err => console.error('[Intent Service] Admin escalation failed:', err));

  // Track pending shortage request for >23 hour admin reminder if local stock
  // is missing — includes master-registered names with zero shelf stock.
  if (medicineName && (filterResult.matches.length === 0 || confidence < 80 || availability === 'REGISTERED_NO_STOCK')) {
    try {
      const { trackMedicineRequest } = await import('./shortageReminderService.js');
      const distName = catalogResults?.mapped?.[0]?.supplier_name || catalogResults?.nonMapped?.[0]?.distributor_name || 'Standard Distributor';
      trackMedicineRequest({
        medicine_name: medicineName,
        distributor_name: distName,
        quantity: quantity || 1,
        customer_phone: customer?.phone || phone || '',
        customer_name: customer?.name || '',
        source: 'whatsapp'
      }).catch(err => console.warn('[Intent Service] Shortage tracking failed:', err));
    } catch (trackErr) {
      console.warn('[Intent Service] Failed to import shortageReminderService:', trackErr);
    }
  }

  console.log(`[Intent Service] Match result for "${medicineName}": ${filterResult.matches.length} local, ${catalogResults?.mapped?.length || 0} mapped, ${catalogResults?.nonMapped?.length || 0} non-mapped (bestScore=${bestScore.toFixed(2)}, availability=${availability})`);
}

/**
 * Handle OCR scan completion — called when ocrScanQueue finishes processing an image.
 * Registered as an event listener in server.ts startup.
 */
export function handleOcrComplete(data: any): void {
  const { phone, chatId, messageBody, ocrResult, msgId, imagePath } = data;
  if (!ocrResult) return;

  let medicineName = ocrResult.medicineInfo?.potentialName;
  const dosageForm = ocrResult.medicineInfo?.dosageForm;
  const mrp = ocrResult.medicineInfo?.mrp;

  // Parse any text from the message body too
  const textParsed = parseMessage(messageBody || '');

  // Fallback: If OCR potentialName is empty, attempt to extract candidate medicine lines from raw OCR text
  if (!medicineName && ocrResult.text) {
    const lines = String(ocrResult.text)
      .split(/[\r\n]+/)
      .map(l => l.trim())
      .filter(l => l.length >= 3);
    const candidate = lines.find(l => isPlausibleMedicineName(l)) || lines[0] || '';
    if (candidate) {
      medicineName = candidate;
    }
  }

  // Use OCR medicine name, but prefer text-parsed name if OCR is weak.
  // The OCR fallback can be a raw first line (batch number, price) — apply the
  // same plausibility rules as the text path before any search runs.
  let finalName = medicineName || textParsed.medicineName;
  if (finalName && !isPlausibleMedicineName(finalName)) {
    if (textParsed.medicineName && isPlausibleMedicineName(textParsed.medicineName)) {
      finalName = textParsed.medicineName;
    } else {
      console.log(`[Intent Service] OCR name "${finalName}" failed plausibility check. Discarding.`);
      return;
    }
  }
  if (!finalName) {
    // App genuinely could not read anything usable from this image — this is
    // the clearest "not sure" case, so a human should see the actual photo.
    if (imagePath) {
      (async () => {
        try {
          const db = await dbManager.getConnection();
          await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
            phone: phone || '',
            chatId,
            imagePath,
            reason: 'Could not extract any readable medicine name from this photo.'
          });
        } catch (notifyErr) {
          console.error('[Intent Service] Failed to notify admin of unreadable scan:', notifyErr);
        }
      })();
    }
    return;
  }

  // EXTRA IMAGE CANDIDATES — a photo (or photo+caption) can carry more than
  // one medicine. Collect every distinct plausible name beyond the primary:
  // DB fuzzy matches[], generic/API names, other plausible OCR lines, and
  // caption-text segments. Every candidate still passes the V2 scan gate +
  // confidence gate below, so extras can never become wrong entries.
  const extraCandidates: string[] = [];
  const seenExtra = new Set<string>(
    [finalName].map(n => n.toLowerCase().replace(/\s+/g, ' '))
  );
  const pushExtra = (v: any) => {
    const s = String(v || '').trim();
    if (!s || !isPlausibleMedicineName(s)) return;
    const key = s.toLowerCase().replace(/\s+/g, ' ');
    if (seenExtra.has(key)) return;
    seenExtra.add(key);
    extraCandidates.push(s);
  };
  pushExtra(ocrResult.medicineInfo?.genericName);
  pushExtra(ocrResult.medicineInfo?.apiName);
  for (const m of Array.isArray(ocrResult.matches) ? ocrResult.matches : []) {
    pushExtra(m);
  }
  for (const c of extractMedicineCandidates(messageBody || '')) {
    pushExtra(c.medicineName);
  }
  // Line-level fallback: plausible standalone OCR lines (capped).
  if (ocrResult.text) {
    const lines = String(ocrResult.text)
      .split(/[\r\n]+/)
      .map(l => l.trim())
      .filter(l => l.length >= 3);
    for (const line of lines) {
      if (extraCandidates.length >= 4) break;
      pushExtra(line);
    }
  }
  const cappedExtras = extraCandidates.slice(0, 4);

  // Stage 0 Scan Gate: skip images that are clearly NOT medicines
  // (booking/ticket/bill/finance docs, food packets, random photos).
  // Without this, every image triggers a search + admin escalation even
  // when it is a train ticket or a biscuit packet.
  const ocrRaw = [
    ocrResult?.text,
    ocrResult?.rawText,
    ocrResult?.medicineInfo?.rawOcrText,
    typeof ocrResult?.cloudDetails === 'string' ? ocrResult.cloudDetails : ocrResult?.cloudDetails?.text,
  ].filter(Boolean).join(' ');

  // Fetch known API substances dynamically and run V2 Signal-Required Gate
  Promise.all([
    lookupCustomer(phone),
    dbManager.getConnection().then(db => db.all('SELECT api FROM api_substances'))
  ]).then(([customer, rows]) => {
    const knownApis = new Set(rows.map(r => (r.api || '').toLowerCase()));
    // Primary name first, then extra image/caption candidates — every one
    // independently through the V2 gate so a second product on a strip or a
    // caption medicine is found, while tickets/bills still get skipped whole.
    const allNames = [finalName, ...cappedExtras];
    const captionCandidates = extractMedicineCandidates(messageBody || '');
    let anyIdentified = false;
    for (const candName of allNames) {
      const decision = resolveOcrGateDecision(ocrRaw, candName, knownApis);
      if (decision === 'skip') continue;
      if (candName !== finalName) {
        console.log(`[Intent Service] OCR extra candidate identified: "${candName}" (chat=${chatId})`);
      }
      anyIdentified = true;
      const isPrimary = candName === finalName;
      const captionHit = captionCandidates
        .find(c => c.medicineName.toLowerCase() === candName.toLowerCase());
      searchAndBroadcast({
        medicineName: candName,
        quantity: (isPrimary ? textParsed.quantity : captionHit?.quantity) || 1,
        unit: (isPrimary ? textParsed.unit : captionHit?.unit) || '',
        customer,
        isNewCustomer: !customer,
        messageBody: messageBody || '',
        source: textParsed.medicineName ? 'both' : 'ocr',
        dosageForm,
        mrp: isPrimary ? mrp : undefined,
        msgId,
        phone,
        chatId,
        imagePath: isPrimary ? imagePath : undefined,
        hasIntentWords: textParsed.rawIntentWords.length > 0
      }).catch(err => console.error('[Intent Service] OCR post-search failed:', err));
    }
    if (!anyIdentified) {
      console.log(`[Intent Service] Scan gate (V2): skipped non-medicine image (name="${finalName}", chat=${chatId}).`);
    }
  }).catch(err => {
    console.error('[Intent Service] Error in handleOcrComplete lookup:', err);
  });
}

export const whatsappIntentService = { handleInbound, handleOcrComplete, searchAndBroadcast };
export default whatsappIntentService;
