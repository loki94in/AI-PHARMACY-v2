// WhatsApp Intent Service — central orchestrator for inbound messages.
// Routes messages through: ignore check → customer lookup → text parse → OCR → smart match.
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { parseMessage, isRepeatRequest, isPlausibleMedicineName, detectDosageForm, isMedicineLikely } from './intentKeywords.js';
import { ocrScanQueue } from './ocrScanQueue.js';
import { productNameFilterService } from './productNameFilterService.js';
import { searchCatalog, scoreProductName } from './pharmarackCatalogCache.js';
import { waAdminEscalationService } from './waAdminEscalationService.js';

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
        const mapping = await msg.client.getContactLidAndPhone([phone]);
        if (mapping && mapping[0] && mapping[0].pn) {
          phone = `${mapping[0].pn}@c.us`;
        } else {
          const contact = await msg.getContact();
          if (contact && contact.number) {
            phone = `${contact.number}@c.us`;
          }
        }
      } catch (e) {
        console.error('[Intent Service] Failed to get contact for LID:', e);
      }
    }

    // 1. IGNORE CHECK
    if (await isIgnored(chatId)) return;

    // 2. CUSTOMER LOOKUP
    const customer = await lookupCustomer(phone);
    const isNewCustomer = !customer;

    // 3. TEXT PARSE
    const parsed = parseMessage(body);

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
        const media = await msg.downloadMedia();
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          ocrScanQueue.enqueue(msgId, buffer, { phone, chatId, messageBody: body });
          // OCR result will be handled by ocrScanComplete listener (registered below)
        }
      } catch (mediaErr) {
        console.error('[Intent Service] Failed to download media:', mediaErr);
      }
    }

    // 6. TEXT-BASED SEARCH — if we parsed a medicine name from text
    if (parsed.isMedicineRequest && parsed.medicineName) {
      // Detect dosage form from the text itself so the search and admin report
      // know what presentation was requested (tab/cap/susp/drops/…).
      const textForm = detectDosageForm(body);
      await searchAndBroadcast({
        medicineName: parsed.medicineName,
        quantity: parsed.quantity,
        unit: parsed.unit,
        customer,
        isNewCustomer,
        messageBody: body,
        source: hasMedia ? 'both' : 'text',
        dosageForm: textForm || undefined,
        msgId,
        phone,
        chatId,
        hasIntentWords: parsed.rawIntentWords.length > 0
      });
    }
  } catch (err) {
    console.error('[Intent Service] Error handling inbound message:', err);
  }
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
}): Promise<void> {
  const { medicineName, quantity, unit, customer, isNewCustomer, messageBody, source, dosageForm, mrp, msgId, phone, chatId } = opts;
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

  // If no local match, also try direct Pharmarack catalog search
  let catalogResults = filterResult.catalogResults || null;
  // Consult Pharmarack whenever there is NO exact local brand match (near-match
  // or no-match), not only when local is completely empty — so admin always sees
  // real distributor availability instead of a possibly-wrong local name.
  const isExactLocal = (filterResult.topScore ?? 0) >= 0.95;
  if ((filterResult.matches.length === 0 || !isExactLocal) && !catalogResults) {
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
  if ((nothingFound || !isExactLocal) && (hasIntentWords || source !== 'text')) {
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

  console.log(`[Intent Service] Match result for "${medicineName}": ${filterResult.matches.length} local, ${catalogResults?.mapped?.length || 0} mapped, ${catalogResults?.nonMapped?.length || 0} non-mapped (bestScore=${bestScore.toFixed(2)})`);
}

/**
 * Handle OCR scan completion — called when ocrScanQueue finishes processing an image.
 * Registered as an event listener in server.ts startup.
 */
export function handleOcrComplete(data: any): void {
  const { phone, chatId, messageBody, ocrResult, msgId } = data;
  if (!ocrResult?.medicineInfo?.potentialName) return;

  const medicineName = ocrResult.medicineInfo.potentialName;
  const dosageForm = ocrResult.medicineInfo.dosageForm;
  const mrp = ocrResult.medicineInfo.mrp;

  // Parse any text from the message body too
  const textParsed = parseMessage(messageBody || '');

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
  if (!finalName) return;

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
  if (!isMedicineLikely(ocrRaw, finalName)) {
    console.log(`[Intent Service] Scan gate: skipped non-medicine image (name="${finalName}", chat=${chatId}).`);
    return;
  }

  lookupCustomer(phone).then(customer => {
    searchAndBroadcast({
      medicineName: finalName,
      quantity: textParsed.quantity || 1,
      unit: textParsed.unit || '',
      customer,
      isNewCustomer: !customer,
      messageBody: messageBody || '',
      source: textParsed.medicineName ? 'both' : 'ocr',
      dosageForm,
      mrp,
      msgId,
      phone,
      chatId,
      hasIntentWords: textParsed.rawIntentWords.length > 0
    }).catch(err => console.error('[Intent Service] OCR post-search failed:', err));
  });
}

export const whatsappIntentService = { handleInbound, handleOcrComplete };
