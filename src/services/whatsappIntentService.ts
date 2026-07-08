// WhatsApp Intent Service — central orchestrator for inbound messages.
// Routes messages through: ignore check → customer lookup → text parse → OCR → smart match.
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { parseMessage, isRepeatRequest } from './intentKeywords.js';
import { ocrScanQueue } from './ocrScanQueue.js';
import { productNameFilterService } from './productNameFilterService.js';
import { searchCatalog } from './pharmarackCatalogCache.js';
import { waAdminEscalationService } from './waAdminEscalationService.js';

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
 * Get recent purchase/refill history for a customer.
 */
async function getCustomerHistory(customerId: number): Promise<any[]> {
  const db = await dbManager.getConnection();
  const rows = await db.all(
    `SELECT medicine_name, frequency_days, last_dispensed, next_due
     FROM patient_refills WHERE customer_id = ? ORDER BY last_dispensed DESC LIMIT 10`,
    [customerId]
  );
  return rows;
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
      const history = await getCustomerHistory(customer.id);
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
      await searchAndBroadcast({
        medicineName: parsed.medicineName,
        quantity: parsed.quantity,
        unit: parsed.unit,
        customer,
        isNewCustomer,
        messageBody: body,
        source: hasMedia ? 'both' : 'text',
        msgId,
        phone,
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
  hasIntentWords?: boolean;
}): Promise<void> {
  const { medicineName, quantity, unit, customer, isNewCustomer, messageBody, source, dosageForm, mrp, msgId, phone } = opts;

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
    filterResult = { matches: [], sources: { local: false, internet: false, catalog: false }, confidence: 0, fallbackUsed: false, processingTimeMs: 0 };
  }

  // If no local match, also try direct Pharmarack catalog search
  let catalogResults = filterResult.catalogResults || null;
  if (filterResult.matches.length === 0 && !catalogResults) {
    try {
      catalogResults = await searchCatalog(medicineName, dosageForm, mrp);
    } catch (catErr) {
      console.warn('[Intent Service] Catalog search failed:', catErr);
    }
  }

  // Discard as noise if no intent keywords were used and no matches are found in local DB or catalog cache
  const hasIntent = opts.hasIntentWords || opts.source === 'ocr' || opts.source === 'both';
  if (!hasIntent && filterResult.matches.length === 0 && (!catalogResults || (catalogResults.mapped.length === 0 && catalogResults.nonMapped.length === 0))) {
    console.log(`[Intent Service] No intent words and no local/catalog matches for "${medicineName}". Discarding as noise.`);
    return;
  }

  // Live Pharmarack search as last resort (if nothing found locally or in catalog)
  let livePharmarackResults: any[] | null = null;
  if (filterResult.matches.length === 0 && (!catalogResults || (catalogResults.mapped.length === 0 && catalogResults.nonMapped.length === 0))) {
    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/pharmarack/search?q=${encodeURIComponent(medicineName)}`, {
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          livePharmarackResults = data;
          // Split into mapped/non-mapped
          catalogResults = {
            mapped: data.filter((p: any) => p.mapped),
            nonMapped: data.filter((p: any) => !p.mapped)
          };
        }
      }
    } catch (liveErr) {
      console.warn('[Intent Service] Live Pharmarack search failed:', liveErr);
    }
  }

  // Get customer history if available
  let history: any[] = [];
  if (customer) {
    history = await getCustomerHistory(customer.id);
  }

  // Broadcast to admin UI
  eventService.broadcast('wa_medicine_match', {
    customer,
    isNewCustomer,
    medicineName,
    quantity,
    unit,
    localMatches: filterResult.matches,
    catalogResults,
    confidence: filterResult.confidence,
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
    localMatches: filterResult.matches,
    catalogResults,
    confidence: filterResult.confidence,
    isRepeat: false,
    source,
    messageBody,
    history,
    msgId,
    phone
  }).catch(err => console.error('[Intent Service] Admin escalation failed:', err));

  console.log(`[Intent Service] Match result for "${medicineName}": ${filterResult.matches.length} local, ${catalogResults?.mapped?.length || 0} mapped, ${catalogResults?.nonMapped?.length || 0} non-mapped`);
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

  // Use OCR medicine name, but prefer text-parsed name if OCR is weak
  const finalName = medicineName || textParsed.medicineName;
  if (!finalName) return;

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
      phone
    }).catch(err => console.error('[Intent Service] OCR post-search failed:', err));
  });
}

export const whatsappIntentService = { handleInbound, handleOcrComplete };
