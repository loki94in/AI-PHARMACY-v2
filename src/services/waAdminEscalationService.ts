import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';

interface EscalationPayload {
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  dosageForm?: string;
  localMatches: string[];
  catalogResults: { mapped: any[]; nonMapped: any[] } | null;
  confidence: number;
  isRepeat: boolean;
  source: 'text' | 'ocr' | 'both';
  messageBody: string;
  history?: any[];
  msgId?: string;
  phone?: string;
  chatId?: string;
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
  const strip = (p: string) => p.replace(/@c\.us$/i, '').replace(/@lid$/i, '').replace(/@s\.whatsapp\.net$/i, '');
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
  else if ((digits.length === 11 || digits.length === 12) && digits.startsWith('91')) waDigits = digits;

  const display = waDigits ? `+${waDigits}` : (candidate || stripped || raw);
  return { display, waDigits };
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

    const adminWhatsapp = await getSetting('admin_whatsapp', '');
    if (!adminWhatsapp || adminWhatsapp.trim() === '') {
      console.warn('[Admin Escalation] wa_auto_share_admin is enabled, but admin_whatsapp is empty. Skipping.');
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
            payload.medicineName || bestMatch.name || bestMatch.productName,
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

    if (outcome === 'found_local') {
      messageText = `🔔 *Prescription Medicine Extracted*

${customerBlock}

 💊 *Extracted Medicine*: ${payload.medicineName}
 📦 *Quantity*: ${payload.quantity} ${payload.unit}${formLine}
 ⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
✅ *In Stock (local)*: ${payload.localMatches.slice(0, 3).join(', ')}${contextBlock}`;
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

${matchBlock}${contextBlock}

📋 Added to approval queue (Review #${reviewId}). Approve in the app to add to inventory.`;
    }

    // 6. Send WhatsApp message
    try {
      await sendMessage(adminWhatsapp, undefined, messageText);
      await db.run(`UPDATE wa_admin_escalations SET status = 'sent' WHERE id = ?`, [escalationId]);
      console.log(`[Admin Escalation] Escalated query for "${payload.medicineName}" to admin ${adminWhatsapp}.`);
    } catch (sendErr: any) {
      console.error(`[Admin Escalation] Failed to send message via whatsappClient:`, sendErr);
      await db.run(`UPDATE wa_admin_escalations SET status = 'failed' WHERE id = ?`, [escalationId]);
    }

  } catch (err) {
    console.error('[Admin Escalation] Error in maybeEscalate:', err);
  }
}

export const waAdminEscalationService = { maybeEscalate };
