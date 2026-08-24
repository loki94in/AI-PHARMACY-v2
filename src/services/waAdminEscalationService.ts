import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';

interface RelatedMedicineInfo { name: string; registered: boolean; inventoryStock: number }

interface EscalationPayload {
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  dosageForm?: string;
  localMatches: string[];
  inventoryStock?: Record<string, number>;
  availability?: 'IN_STOCK' | 'REGISTERED_NO_STOCK' | 'EXTERNAL_ONLY';
  catalogResults: { mapped: any[]; nonMapped: any[] } | null;
  confidence: number;
  isRepeat: boolean;
  source: 'text' | 'ocr' | 'both';
  messageBody: string;
  history?: any[];
  msgId?: string;
  phone?: string;
  chatId?: string;
  // One-photo-one-result (owner rule): extra medicines seen on the shared
  // strip / caption, resolved LOCAL-ONLY by whatsappIntentService — no
  // network was spent on them and they ride along on the primary card.
  relatedMedicines?: RelatedMedicineInfo[];
  // Saved inbound photo (data/inbound_media/<msgId>.jpg) — attached to the
  // owner's WhatsApp message when present so the human sees the real strip.
  imagePath?: string;
  context?: {
    purchases: Array<{ date: string; name: string; quantity: number }>;
    refills: Array<{ medicine_name: string; next_refill_date: string | null; last_refill_date: string | null }>;
    lastMessages: Array<{ body: string }>;
  };
}

/**
 * Resolve a human-readable phone from raw WA IDs (@c.us or @lid).
 * Falls back to whatsapp_chats.resolved_number (populated at message receipt)
 * and then the stored customer phone. waDigits is a normalized 91XXXXXXXXXX
 * string usable in a wa.me link, or null when the number could not be resolved
 * (never show a wrong tap-to-chat link).
 */
async function resolvePhone(
  db: any,
  raw: string,
  chatId: string | undefined,
  customerPhone: string | undefined
): Promise<{ display: string; waDigits: string | null }> {
  const strip = (p: string) => {
    let s = String(p || '').trim();
    while (s.includes('@')) {
      s = s.split('@')[0];
    }
    return s;
  };
  const stripped = strip(raw);
  const isLid = /@lid$/i.test(raw) || (/^\d+$/.test(stripped) && stripped.length > 12);

  let candidate = stripped;
  if (isLid) {
    candidate = '';
    try {
      const row = chatId ? await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [chatId]) : null;
      const resolved = row?.resolved_number ? strip(String(row.resolved_number)).replace(/\D/g, '') : '';
      if (resolved.length >= 10 && resolved.length <= 12) candidate = resolved;
    } catch { /* table may not exist in some test DBs */ }
    if (!candidate && customerPhone) {
      const custDigits = strip(customerPhone).replace(/\D/g, '');
      if (custDigits.length >= 10 && custDigits.length <= 12) candidate = custDigits;
    }
  }

  const digits = candidate.replace(/\D/g, '');
  let waDigits: string | null = null;
  if (digits.length === 10) waDigits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) waDigits = `91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith('91')) waDigits = digits;
  else if (digits.length >= 10) waDigits = digits;

  const display = waDigits 
    ? (waDigits.length === 12 && waDigits.startsWith('91') ? `+91 ${waDigits.slice(2, 7)} ${waDigits.slice(7)}` : `+${waDigits}`)
    : (candidate || stripped || raw);
  return { display, waDigits };
}

// Priority order of app_settings keys that may hold the pharmacy's admin
// WhatsApp number. The visible Settings page saves 'owner_whatsapp_number';
// bouncedAlertService/shortageReminderService read 'admin_whatsapp_number';
// only 'admin_whatsapp' was ever checked here, so a number saved through the
// normal Settings UI was silently ignored and escalations never sent.
const ADMIN_PHONE_SETTING_KEYS = ['admin_whatsapp', 'owner_whatsapp_number', 'admin_whatsapp_number', 'shop_phone', 'store_phone'];

/**
 * Resolve the pharmacy's admin WhatsApp number from whichever settings key
 * actually holds it. Returns '' if none are set. Exported for unit testing.
 */
export async function resolveAdminWhatsappNumber(db: any): Promise<string> {
  for (const key of ADMIN_PHONE_SETTING_KEYS) {
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (row?.value && row.value.trim() !== '') {
      return row.value.trim();
    }
  }
  return '';
}

/**
 * Shared escalation guards: wa_auto_share_admin toggle + admin number
 * resolution + self-send guard (a request from the owner's own number must
 * never loop back to itself). Returns null when the note must not be sent.
 */
async function escalateGuard(
  db: any,
  senderPhone: string | undefined,
  customerPhoneFallback?: string
): Promise<{ adminWhatsapp: string } | null> {
  try {
    const toggle = await db.get('SELECT value FROM app_settings WHERE key = ?', ['wa_auto_share_admin']);
    if (toggle && toggle.value === 'false') return null;
  } catch { /* settings table always exists; defensive only */ }

  const adminWhatsapp = await resolveAdminWhatsappNumber(db);
  if (!adminWhatsapp) return null;

  const sender = String(senderPhone || customerPhoneFallback || '');
  const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-10);
  if (sender && cleanPhone(sender) === cleanPhone(adminWhatsapp)) return null;

  return { adminWhatsapp };
}

/** Truthful "also seen on this strip" lines for extra photo candidates. */
function buildRelatedBlock(related: RelatedMedicineInfo[] | undefined): string {
  if (!related || related.length === 0) return '';
  const fmt = (r: RelatedMedicineInfo) => r.registered
    ? `${r.name} — ${r.inventoryStock > 0 ? `✅ ${r.inventoryStock} in stock` : '🗄️ DB · 0 on shelf'}`
    : `${r.name} — ❔ not registered`;
  return `\n🧩 *Also on this strip*:\n${related.map(fmt).join('\n')}`;
}

/**
 * Notify the pharmacy about an inbound WhatsApp image that couldn't be
 * turned into a confident medicine match — either the download failed after
 * retries (no imagePath, text-only alert) or OCR ran but the result was too
 * uncertain to auto-escalate (imagePath set, forwards the actual photo so a
 * human can look at it instead of the message silently vanishing).
 * Returns false (and sends nothing) if no admin number is configured.
 */
export async function notifyAdminOfUnprocessedMedia(
  db: any,
  opts: { phone: string; chatId?: string; imagePath?: string; reason: string }
): Promise<boolean> {
  const adminWhatsapp = await resolveAdminWhatsappNumber(db);
  if (!adminWhatsapp) return false;

  const { display: displayPhone, waDigits } = await resolvePhone(db, opts.phone, opts.chatId, undefined);

  let caption = `⚠️ *Unprocessed WhatsApp Image*\n`;
  caption += `📞 *Customer:* ${displayPhone}\n`;
  if (waDigits) {
    caption += `🔗 *Quick Chat:* https://wa.me/${waDigits}\n`;
  }
  caption += `\n📝 ${opts.reason}\n`;
  caption += `Please check this chat manually.`;

  await whatsappQueueWorker.enqueue(adminWhatsapp, caption, 'admin_escalation_image', 'Admin / Store Owner', undefined, opts.imagePath);
  return true;
}

export async function maybeEscalate(payload: EscalationPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();

    // 1. Get Settings
    const getSetting = async (key: string, defaultValue: string): Promise<string> => {
      try {
        const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
        return row ? row.value : defaultValue;
      } catch {
        return defaultValue;
      }
    };

    const autoShare = await getSetting('wa_auto_share_admin', 'true');
    if (autoShare === 'false') {
      return;
    }

    const adminWhatsapp = await resolveAdminWhatsappNumber(db);
    if (!adminWhatsapp) {
      console.warn(`[Admin Escalation] wa_auto_share_admin is enabled, but no admin WhatsApp number is configured (checked ${ADMIN_PHONE_SETTING_KEYS.join(', ')}). Skipping.`);
      return;
    }

    const customerPhoneRaw = payload.phone || payload.customer?.phone || '';
    if (!customerPhoneRaw) {
      console.warn('[Admin Escalation] Customer phone is empty. Skipping.');
      return;
    }

    const { display: displayPhone, waDigits } = await resolvePhone(db, customerPhoneRaw, payload.chatId, payload.customer?.phone);

    // Self-send guard: normalize numbers and check if they are the same
    const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-10);
    if (cleanPhone(customerPhoneRaw) === cleanPhone(adminWhatsapp)) {
      console.log('[Admin Escalation] Self-send detected (customer is admin). Skipping escalation.');
      return;
    }

    // 2. Classify outcome
    let outcome: 'found_local' | 'pharmarack' | null = null;
    let bestMatch: any = null;
    let allMatches: any[] = [];

    if (payload.localMatches && payload.localMatches.length > 0) {
      outcome = 'found_local';
    } else {
      const mapped = payload.catalogResults?.mapped || [];
      const nonMapped = payload.catalogResults?.nonMapped || [];
      allMatches = [...mapped, ...nonMapped];

      if (allMatches.length > 0) {
        outcome = 'pharmarack';
        // Pick best match: mapped first
        bestMatch = mapped.length > 0 ? mapped[0] : nonMapped[0];
      }
    }

    if (!outcome) {
      // Nothing found local, and no catalog matches found
      return;
    }

    // 3. Deduplication Check
    const msgId = payload.msgId || '';
    const medicineKey = payload.medicineName.toLowerCase().trim();

    const dup = await db.get(
      `SELECT 1 FROM wa_admin_escalations
       WHERE status != 'failed' AND medicine_key = ?
         AND ( (msg_id = ? AND msg_id != '')
            OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )
       LIMIT 1`,
      [medicineKey, msgId, customerPhoneRaw]
    );

    if (dup) {
      console.log(`[Admin Escalation] Duplicate query for "${medicineKey}" from ${customerPhoneRaw} (msgId: ${msgId}). Skipping.`);
      return;
    }

    // 4. Insert initial pending record
    const insertResult = await db.run(
      `INSERT INTO wa_admin_escalations (msg_id, customer_phone, medicine_key, outcome, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [msgId, customerPhoneRaw, medicineKey, outcome]
    );
    const escalationId = insertResult.lastID;

    let reviewId: number | null = null;

    if (outcome === 'pharmarack' && bestMatch) {
      // Find existing pending WhatsApp review or create a new one
        const existingReview = await db.get(
          `SELECT id FROM staged_medicine_reviews
           WHERE lower(medicine_name) = ? AND status = 'pending' AND source = 'whatsapp'`,
          [payload.medicineName?.toLowerCase().trim() || bestMatch.name?.toLowerCase().trim() || bestMatch.productName?.toLowerCase().trim() || '']
        );

      if (existingReview) {
        reviewId = existingReview.id;
      } else {
        const original_row_data = {
          source: 'whatsapp',
          msgId,
          customerPhone: customerPhoneRaw,
          customerName: payload.customer?.name || 'New Customer',
          messageBody: payload.messageBody,
          mrp: bestMatch.mrp ?? bestMatch.MRP ?? null,
          topMatches: allMatches.slice(0, 5).map(p => ({
            name: p.name || p.productName || '',
            mrp: p.mrp ?? p.MRP ?? null,
            packaging: p.packaging || p.package || '',
            distributor: p.distributor || p.storeName || '',
            manufacturer: p.manufacturer || p.company || '',
            score: typeof p.score === 'number' ? p.score : null,
            isMapped: p.isMapped ?? p.mapped ?? false
          }))
        };

        const stagedResult = await db.run(
          `INSERT INTO staged_medicine_reviews (job_id, medicine_name, status, source, search_query, original_row_data)
           VALUES (NULL, ?, 'pending', 'whatsapp', ?, ?)`,
          [
            bestMatch.name || bestMatch.productName || payload.medicineName,
            payload.medicineName,
            JSON.stringify(original_row_data)
          ]
        );
        reviewId = stagedResult.lastID ?? null;
      }

      // Update escalation with review_id
      await db.run(
        `UPDATE wa_admin_escalations SET review_id = ? WHERE id = ?`,
        [reviewId, escalationId]
      );
    }

    // 5. Construct message template
    let messageText = '';
    const isOld = !!payload.customer && !payload.isNewCustomer;
    const custLabel = isOld ? 'Old Customer' : 'New Customer';
    const custName = payload.customer?.name || '';
    const sourceLabel = payload.source === 'ocr' ? ' (from image OCR)' : payload.source === 'both' ? ' (from text & OCR)' : '';

    // Shared customer header: label + name, real phone with tap-to-chat link
    const phoneLine = waDigits
      ? `📞 ${displayPhone} — https://wa.me/${waDigits}`
      : `📞 ${displayPhone}`;
    const customerBlock = `👤 *${custLabel}*${custName ? `: ${custName}` : ''}
${phoneLine}
📝 *Original*: "${payload.messageBody || 'N/A'}"${sourceLabel}`;

    // Old-customer context: recent purchases, refills, last messages (skip empty sections)
    const contextLines: string[] = [];
    if (isOld && payload.context) {
      const fmtDate = (d: any) => {
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      };
      const { purchases, refills, lastMessages } = payload.context;
      if (purchases?.length) {
        contextLines.push(`🧾 *Recent purchases*: ${purchases.map(p => `${p.name}${p.quantity > 1 ? ` x${p.quantity}` : ''}${fmtDate(p.date) ? ` (${fmtDate(p.date)})` : ''}`).join(', ')}`);
      }
      if (refills?.length) {
        contextLines.push(`🔁 *Refills*: ${refills.map(r => `${r.medicine_name}${r.next_refill_date && fmtDate(r.next_refill_date) ? ` (due ${fmtDate(r.next_refill_date)})` : ''}`).join(', ')}`);
      }
      if (lastMessages?.length) {
        contextLines.push(`💬 *Recent msgs*: ${lastMessages.map(m => `"${String(m.body).slice(0, 60)}"`).join(' / ')}`);
      }
    }
    const contextBlock = contextLines.length > 0 ? `\n\n${contextLines.join('\n')}` : '';
    const formLine = payload.dosageForm ? `\n🩹 *Form*: ${payload.dosageForm}` : '';
    const relatedBlock = buildRelatedBlock(payload.relatedMedicines);

    if (outcome === 'found_local') {
      // Truthful stock reporting — a medicines-master match is NOT shelf
      // presence. Show per-name active stock; when the master has the name but
      // the shelf is empty, say so and surface distributor matches instead.
      const inStock = payload.availability !== 'REGISTERED_NO_STOCK';
      const fmtStock = (name: string) => {
        const units = payload.inventoryStock?.[String(name).toLowerCase()];
        return units === undefined ? name : `${name} — ${units} unit${units === 1 ? '' : 's'}`;
      };
      if (inStock) {
        messageText = `🔔 *Prescription Medicine Extracted*

${customerBlock}

 💊 *Extracted Medicine*: ${payload.medicineName}
 📦 *Quantity*: ${payload.quantity} ${payload.unit}${formLine}
 ⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
✅ *In Stock*: ${payload.localMatches.slice(0, 3).map(fmtStock).join(', ')}${relatedBlock}${contextBlock}`;
      } else {
        const mappedTop = (payload.catalogResults?.mapped || []).slice(0, 3);
        const nonMappedTop = (payload.catalogResults?.nonMapped || []).slice(0, mappedTop.length > 0 ? 2 : 5);
        const distLines = [...mappedTop, ...nonMappedTop]
          .map((p: any, i: number) => `${i + 1}. ${p.name || p.productName || 'Unknown'} | MRP ₹${p.mrp ?? p.MRP ?? '-'} | ${p.distributor || p.storeName || 'Unknown'}`)
          .join('\n');
        messageText = `⚠️ *Medicine Registered in DB but NOT in Physical Stock*

${customerBlock}

 💊 *Extracted Medicine*: ${payload.medicineName}
 📦 *Quantity*: ${payload.quantity} ${payload.unit}${formLine}
 ⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
 🗄️ *DB match (0 on shelf)*: ${payload.localMatches.slice(0, 3).join(', ')}
${distLines ? `\n🚚 *Distributor options*:\n${distLines}\n` : ''}${relatedBlock}
👉 Needs a purchase order before confirming to the customer.${contextBlock}`;
      }
    } else {
      // PharmaRack outcome — mapped distributors first, then non-mapped,
      // each line: name | company | pack | MRP | distributor | match%
      const fmtMatch = (p: any, idx: number) => {
        const name = p.name || p.productName || 'Unknown';
        const company = p.manufacturer || p.company || '';
        const pkg = p.packaging || p.package || '-';
        const mrp = p.mrp ?? p.MRP ?? '-';
        const dist = p.distributor || p.storeName || 'Unknown';
        const scoreStr = typeof p.score === 'number' ? ` | ${Math.round(p.score * 100)}%` : '';
        return `${idx}. ${name}${company ? ` | ${company}` : ''} | ${pkg} | MRP ₹${mrp} | ${dist}${scoreStr}`;
      };

      const mappedTop = (payload.catalogResults?.mapped || []).slice(0, 3);
      const nonMappedTop = (payload.catalogResults?.nonMapped || []).slice(0, mappedTop.length > 0 ? 2 : 5);
      const sections: string[] = [];
      let idx = 1;
      if (mappedTop.length > 0) {
        sections.push(`✅ *Mapped distributors*\n${mappedTop.map(p => fmtMatch(p, idx++)).join('\n')}`);
      }
      if (nonMappedTop.length > 0) {
        sections.push(`📦 *Other distributors*\n${nonMappedTop.map(p => fmtMatch(p, idx++)).join('\n')}`);
      }
      const matchBlock = sections.join('\n');

      messageText = `⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*

${customerBlock}
 🔍 *Searched*: ${payload.medicineName}${payload.dosageForm ? ` (${payload.dosageForm})` : ''}${payload.confidence ? ` — best match ${Math.round(payload.confidence)}%` : ''}

${matchBlock}${relatedBlock}${contextBlock}

📋 Added to approval queue (Review #${reviewId}). Approve in the app to add to inventory.`;
    }

    // 6. Enqueue WhatsApp message in centralized queue — attach the actual
    // shared photo when we have it, so the owner sees the real strip.
    try {
      await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation', 'Admin / Store Owner', undefined, payload.imagePath);
      await db.run(`UPDATE wa_admin_escalations SET status = 'sent' WHERE id = ?`, [escalationId]);
      console.log(`[Admin Escalation] Enqueued escalation for "${payload.medicineName}" to admin ${adminWhatsapp}.`);
    } catch (sendErr: any) {
      console.error(`[Admin Escalation] Failed to enqueue message:`, sendErr);
      await db.run(`UPDATE wa_admin_escalations SET status = 'failed' WHERE id = ?`, [escalationId]);
    }

  } catch (err) {
    console.error('[Admin Escalation] Error in maybeEscalate:', err);
  }
}

interface NonAllopathicNotePayload {
  customer: { id: number; name: string; phone: string } | null;
  medicineName: string;
  productKind: string;
  quantity?: number;
  unit?: string;
  messageBody?: string;
  source: 'text' | 'ocr' | 'both';
  msgId?: string;
  phone?: string;
  chatId?: string;
  imagePath?: string;
}

/**
 * Short one-line owner note for cosmetic / ayurvedic / homeopathy requests
 * (owner decision 2026-08): the pipeline deliberately skipped Pharmarack
 * searches for these — the note keeps every request visible on WhatsApp
 * without burning search budget or shortage tracking. Same guards as
 * maybeEscalate: wa_auto_share_admin toggle, admin-number resolution,
 * self-send guard and the 24h per-customer+medicine dedupe.
 */
export async function notifyAdminOfNonAllopathic(payload: NonAllopathicNotePayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.phone || payload.customer?.phone, payload.customer?.phone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    const customerPhoneRaw = payload.phone || payload.customer?.phone || '';
    if (!customerPhoneRaw) return;

    // Same dedupe key space as real escalations so a repeat ask within 24h
    // never re-pings the owner.
    const medicineKey = payload.medicineName.toLowerCase().trim();
    const msgId = payload.msgId || '';
    const dup = await db.get(
      `SELECT 1 FROM wa_admin_escalations
       WHERE status != 'failed' AND medicine_key = ?
         AND ( (msg_id = ? AND msg_id != '')
            OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )
       LIMIT 1`,
      [medicineKey, msgId, customerPhoneRaw]
    );
    if (dup) return;

    await db.run(
      `INSERT INTO wa_admin_escalations (msg_id, customer_phone, medicine_key, outcome, status)
       VALUES (?, ?, ?, 'non_allopathic', 'pending')`,
      [msgId, customerPhoneRaw, medicineKey]
    );

    const { display: displayPhone, waDigits } = await resolvePhone(db, customerPhoneRaw, payload.chatId, payload.customer?.phone);
    const phoneLine = waDigits ? `${displayPhone} — https://wa.me/${waDigits}` : displayPhone;
    const kindLabel = String(payload.productKind || 'non-allopathic').toUpperCase();
    const kindEmoji = kindLabel === 'AYURVEDIC' ? '🌿' : kindLabel === 'HOMEOPATHY' ? '💧' : '🧴';

    const messageText = `${kindEmoji} *Non-Allopathic Request* (${kindLabel})

👤 ${payload.customer?.name || 'Customer'}
📞 ${phoneLine}
📝 *Original*: "${payload.messageBody || 'N/A'}"

💊 *Asked for*: ${payload.medicineName}${payload.quantity ? ` × ${payload.quantity}${payload.unit ? ` ${payload.unit}` : ''}` : ''}
ℹ️ Pharmarack search skipped — not an allopathic medicine.`;

    try {
      await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation_non_allopathic', 'Admin / Store Owner', undefined, payload.imagePath);
      console.log(`[Admin Escalation] Non-allopathic note sent for "${payload.medicineName}" (${kindLabel}).`);
    } catch (sendErr: any) {
      console.error('[Admin Escalation] Failed to enqueue non-allopathic note:', sendErr);
    }
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfNonAllopathic:', err);
  }
}

export const waAdminEscalationService = { maybeEscalate, notifyAdminOfUnprocessedMedia, resolveAdminWhatsappNumber, notifyAdminOfNonAllopathic };
