import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';

interface EscalationPayload {
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
  history?: any[];
  msgId?: string;
  phone?: string;
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

    // Resolve a human-readable phone number from raw WA IDs (@c.us or @lid)
    const resolveDisplayPhone = (raw: string): string => {
      // Strip known WA suffixes
      const stripped = raw.replace(/@c\.us$/i, '').replace(/@lid$/i, '').replace(/@s\.whatsapp\.net$/i, '');
      // If it looks like a pure numeric WA ID (not a real phone), try the DB-stored phone
      if (/^\d{10,}$/.test(stripped) && stripped.length > 12) {
        return payload.customer?.phone || stripped;
      }
      return stripped || raw;
    };
    const displayPhone = resolveDisplayPhone(customerPhoneRaw);

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
        [bestMatch.name?.toLowerCase().trim() || bestMatch.productName?.toLowerCase().trim() || '']
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
        reviewId = stagedResult.lastID;
      }

      // Update escalation with review_id
      await db.run(
        `UPDATE wa_admin_escalations SET review_id = ? WHERE id = ?`,
        [reviewId, escalationId]
      );
    }

    // 5. Construct message template
    let messageText = '';
    const custName = payload.customer?.name || 'New Customer';
    const sourceLabel = payload.source === 'ocr' ? ' (from image OCR)' : payload.source === 'both' ? ' (from text & OCR)' : '';

    if (outcome === 'found_local') {
      messageText = `🔔 *Prescription Medicine Extracted*

👤 *Customer*: ${custName} (${displayPhone})
📝 *Original Text*: "${payload.messageBody || 'N/A'}"${sourceLabel}

💊 *Extracted Medicine*: ${payload.medicineName}
📦 *Quantity*: ${payload.quantity} ${payload.unit}
⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
✅ *In Stock (local)*: ${payload.localMatches.slice(0, 3).join(', ')}`;
    } else {
      // PharmaRack outcome - list top 5 matches
      const matchLines = allMatches.slice(0, 5).map((p, idx) => {
        const name = p.name || p.productName || 'Unknown';
        const pkg = p.packaging || p.package || '-';
        const mrp = p.mrp ?? p.MRP ?? '-';
        const dist = p.distributor || p.storeName || 'Unknown';
        const mappedStr = (p.isMapped ?? p.mapped) ? 'Mapped' : 'Non-mapped';
        return `${idx + 1}. ${name} | ${pkg} | MRP ₹${mrp} | ${dist} | ${mappedStr}`;
      }).join('\n');

      messageText = `⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*

👤 *Customer*: ${custName} (${displayPhone})
📝 *Original Text*: "${payload.messageBody || 'N/A'}"${sourceLabel}
🔍 *Searched*: ${payload.medicineName}

${matchLines}

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
