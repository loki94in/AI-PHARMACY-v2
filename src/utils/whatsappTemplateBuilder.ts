import { dbManager } from '../database/connection.js';
import { getStoreMedicalName, getStorePhone } from '../services/storeSettingsService.js';

export interface DeliveryBoyInfo {
  name: string;
  phone: string; // Formatted +91 XXXXX XXXXX
  rawPhone: string;
}

/**
 * Format raw 10-digit or 12-digit phone string to '+91 XXXXX XXXXX'
 */
export function formatPhoneWithCountryCode(rawPhone: string | null | undefined): string {
  if (!rawPhone || !rawPhone.trim()) return '';
  let digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.substring(2);
  }
  if (digits.length === 10) {
    return `+91 ${digits.substring(0, 5)} ${digits.substring(5)}`;
  }
  return rawPhone.trim().startsWith('+') ? rawPhone.trim() : `+91 ${rawPhone.trim()}`;
}

/**
 * Resolves active delivery boy from delivery_boys DB table per system contract.
 * Fallbacks to store owner/admin if no active delivery boy found.
 */
export async function resolveActiveDeliveryBoy(
  dbInstance?: any,
  assignedIdentifier?: string | number | null
): Promise<DeliveryBoyInfo> {
  const db = dbInstance || (await dbManager.getConnection());

  try {
    let boyRow: any = null;

    // 1. If assignedIdentifier provided, search by id or name
    if (assignedIdentifier) {
      if (typeof assignedIdentifier === 'number' || !isNaN(Number(assignedIdentifier))) {
        boyRow = await db.get(
          'SELECT name, whatsapp_number FROM delivery_boys WHERE id = ? AND is_active = 1 LIMIT 1',
          [Number(assignedIdentifier)]
        );
      }
      if (!boyRow && typeof assignedIdentifier === 'string' && assignedIdentifier.trim() !== 'Not assigned yet') {
        boyRow = await db.get(
          'SELECT name, whatsapp_number FROM delivery_boys WHERE name LIKE ? AND is_active = 1 LIMIT 1',
          [`%${assignedIdentifier.trim()}%`]
        );
      }
    }

    // 2. If no specific boy found or assignedIdentifier was empty / "Not assigned yet", pick first active delivery boy
    if (!boyRow) {
      boyRow = await db.get(
        "SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != '' ORDER BY id ASC LIMIT 1"
      );
    }

    if (boyRow && boyRow.name && boyRow.whatsapp_number) {
      return {
        name: boyRow.name.trim(),
        phone: formatPhoneWithCountryCode(boyRow.whatsapp_number),
        rawPhone: String(boyRow.whatsapp_number).replace(/\D/g, '')
      };
    }
  } catch (err) {
    console.warn('[WhatsAppTemplateBuilder] Error resolving delivery boy:', err);
  }

  // 3. Fallback to Store Admin / Owner details from app_settings
  const storePhone = await getStorePhone(db);
  return {
    name: '👤 Admin / Store Owner',
    phone: storePhone ? formatPhoneWithCountryCode(storePhone) : '📞 Contact Store',
    rawPhone: storePhone ? storePhone.replace(/\D/g, '') : ''
  };
}

export interface FormattedItemUnit {
  packLabel: string;
  unitQtyStr: string;
  totalUnitsNote: string;
}

/**
 * Formats medicine packaging and quantity into human-readable pack labels and unit descriptors
 * (e.g., '10 Strips (150 Tablets)', '5 Bottles', '2 Vials') for order messages and invoices.
 */
export function formatPackagingAndUnit(
  packaging?: string | null,
  qty: number | string = 1
): FormattedItemUnit {
  const numericQty = Math.max(1, Number(qty) || 1);
  const rawPack = (packaging || '').trim();

  if (!rawPack) {
    return {
      packLabel: '',
      unitQtyStr: `${numericQty} ${numericQty === 1 ? 'Unit' : 'Units'}`,
      totalUnitsNote: ''
    };
  }

  const lower = rawPack.toLowerCase();
  let unitsCount: number | null = null;
  let hasVolume = false;
  let hasWeight = false;

  if (/\b\d+(?:\.\d+)?\s*(?:ml|milliliter|millilitre|l|ltr|liter|litre)\b/i.test(lower)) {
    hasVolume = true;
  }
  if (/\b\d+(?:\.\d+)?\s*(?:gm|gram|grams|g|kg|kilogram)\b/i.test(lower)) {
    hasWeight = true;
  }

  const multiTabMatch = lower.match(/\b(\d+)\s*x\s*(\d+)\b/);
  if (multiTabMatch) {
    unitsCount = parseInt(multiTabMatch[1], 10) * parseInt(multiTabMatch[2], 10);
  } else {
    const tabMatch = lower.match(/\b(\d+)\s*(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|'s|s\b)/);
    if (tabMatch) {
      unitsCount = parseInt(tabMatch[1], 10);
    } else {
      const parenMatch = lower.match(/\((\d+)\s*(?:tabs?|caps?|units?)?\)/);
      if (parenMatch) {
        unitsCount = parseInt(parenMatch[1], 10);
      }
    }
  }

  let unitType = numericQty === 1 ? 'Pack' : 'Packs';
  let totalUnitsNote = '';

  if (hasVolume || /ml|syrup|susp|drop|lotion|liquid|bottle/i.test(lower)) {
    unitType = numericQty === 1 ? 'Bottle' : 'Bottles';
  } else if (hasWeight || /tube|gel|oint|cream/i.test(lower)) {
    unitType = numericQty === 1 ? 'Tube' : 'Tubes';
  } else if (/inj|vial|amp/i.test(lower)) {
    unitType = numericQty === 1 ? 'Vial' : 'Vials';
  } else if (/sachet|pouch/i.test(lower)) {
    unitType = numericQty === 1 ? 'Sachet' : 'Sachets';
  } else if (/box|carton/i.test(lower)) {
    unitType = numericQty === 1 ? 'Box' : 'Boxes';
    if (unitsCount && unitsCount > 1) {
      const isCap = /cap/i.test(lower);
      totalUnitsNote = ` (${numericQty * unitsCount} ${isCap ? 'Capsules' : 'Tablets'})`;
    }
  } else if (unitsCount !== null || /strip|tab|cap/i.test(lower)) {
    unitType = numericQty === 1 ? 'Strip' : 'Strips';
    if (unitsCount && unitsCount > 1) {
      const isCap = /cap/i.test(lower);
      totalUnitsNote = ` (${numericQty * unitsCount} ${isCap ? 'Capsules' : 'Tablets'})`;
    }
  }

  return {
    packLabel: `Pack: ${rawPack}`,
    unitQtyStr: `${numericQty} ${unitType}`,
    totalUnitsNote
  };
}

export interface DistributorOrderMessageItem {
  name: string;
  qty: number | string;
  packaging?: string | null;
}

export interface DistributorOrderMessageParams {
  distributorName: string;
  distributorPhone?: string | null;
  items: DistributorOrderMessageItem[];
  deliveryBoyName?: string | null;
  deliveryBoyPhone?: string | null;
  preferredFileFormat?: string | null;
  pharmacyEmail?: string | null;
  dateLabel?: string;
  isLate?: boolean;
}

/**
 * Builds the unified 'TODAY DISTRIBUTOR ORDER' WhatsApp notification message.
 */
export function buildStandardDistributorOrderMessage(params: DistributorOrderMessageParams): string {
  const dateLabel = params.dateLabel || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const prefix = params.isLate ? `📅 TODAY ORDER (LATE ADDITION) — ` : `📅 TODAY DISTRIBUTOR ORDER — `;

  let msg = `${prefix}${dateLabel}\n\n`;
  msg += `🏬 *${(params.distributorName || 'DISTRIBUTOR').toUpperCase()}*\n`;
  if (params.distributorPhone && params.distributorPhone.trim()) {
    msg += `📞 Contact: ${params.distributorPhone.trim()}\n`;
  }

  const boyName = params.deliveryBoyName || 'Delivery Staff';
  const boyPhone = params.deliveryBoyPhone || 'N/A';
  msg += `🚚 *Delivery Boy / Pickup Person:* ${boyName} (${boyPhone})\n\n`;

  msg += `📦 *Medicines List:*\n`;
  const items = params.items || [];
  if (items.length > 0) {
    items.forEach((item, idx) => {
      const name = item.name || 'Medicine Item';
      const qty = item.qty || 1;
      const packInfo = formatPackagingAndUnit(item.packaging, qty);
      const packLine = packInfo.packLabel ? `   📦 *${packInfo.packLabel}*\n` : '';
      msg += `${idx + 1}. *${name}*\n${packLine}   🔢 Order Qty: *${packInfo.unitQtyStr}*\n`;
    });
  } else {
    msg += `  • Standard Pharmacy Order Items\n`;
  }

  msg += `\n📊 *Total Items:* ${items.length}\n`;
  const format = (params.preferredFileFormat || 'CSV').trim();
  msg += `📄 *Preferred Email Invoice Format:* ${format}`;
  if (params.pharmacyEmail && params.pharmacyEmail.trim()) {
    msg += `\n📩 *Please email bill copies to:* ${params.pharmacyEmail.trim()}`;
  }

  return msg.trim();
}

/**
 * Builds standardized WhatsApp Order Notification template with resolved delivery boy.
 */
export async function buildWhatsAppOrderNotification(params: {
  productName: string;
  qty: number | string;
  packaging?: string;
  distributorName?: string;
  assignedBoy?: string | number | null;
  dbInstance?: any;
}): Promise<string> {
  const db = params.dbInstance || (await dbManager.getConnection());
  const deliveryBoy = await resolveActiveDeliveryBoy(db, params.assignedBoy);

  return buildStandardDistributorOrderMessage({
    distributorName: params.distributorName || 'Distributor',
    items: [{
      name: params.productName,
      qty: params.qty,
      packaging: params.packaging
    }],
    deliveryBoyName: deliveryBoy.name,
    deliveryBoyPhone: deliveryBoy.phone
  });
}
