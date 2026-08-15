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
          'SELECT name, phone FROM delivery_boys WHERE id = ? AND is_active = 1 LIMIT 1',
          [Number(assignedIdentifier)]
        );
      }
      if (!boyRow && typeof assignedIdentifier === 'string' && assignedIdentifier.trim() !== 'Not assigned yet') {
        boyRow = await db.get(
          'SELECT name, phone FROM delivery_boys WHERE name LIKE ? AND is_active = 1 LIMIT 1',
          [`%${assignedIdentifier.trim()}%`]
        );
      }
    }

    // 2. If no specific boy found or assignedIdentifier was empty / "Not assigned yet", pick first active delivery boy
    if (!boyRow) {
      boyRow = await db.get(
        'SELECT name, phone FROM delivery_boys WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
      );
    }

    if (boyRow && boyRow.name && boyRow.phone) {
      return {
        name: boyRow.name.trim(),
        phone: formatPhoneWithCountryCode(boyRow.phone),
        rawPhone: boyRow.phone.replace(/\D/g, '')
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

/**
 * Builds standardized WhatsApp Order Notification template with resolved delivery boy.
 */
export async function buildWhatsAppOrderNotification(params: {
  productName: string;
  qty: number | string;
  distributorName?: string;
  assignedBoy?: string | number | null;
  dbInstance?: any;
}): Promise<string> {
  const db = params.dbInstance || (await dbManager.getConnection());
  const storeName = await getStoreMedicalName(db);
  const deliveryBoy = await resolveActiveDeliveryBoy(db, params.assignedBoy);

  let msg = `📦 *ORDER NOTIFICATION* - ${storeName}\n\n`;
  msg += `• *Product*: ${params.productName}\n`;
  msg += `• *Quantity*: ${params.qty}\n`;
  if (params.distributorName) {
    msg += `• *Distributor*: ${params.distributorName}\n`;
  }
  msg += `\n🚚 *Delivery Details*:\n`;
  msg += `• *Assigned Boy*: ${deliveryBoy.name}\n`;
  msg += `• *Contact*: ${deliveryBoy.phone}\n`;

  return msg;
}
