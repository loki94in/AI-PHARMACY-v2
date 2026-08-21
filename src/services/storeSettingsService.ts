import { dbManager } from '../database/connection.js';

/**
 * Resolves the user-configured pharmacy name from app_settings.
 * Returns null if no valid pharmacy name is configured.
 * Strictly blocks placeholder/dummy pharmacy identities.
 */
export async function getConfiguredPharmacyName(dbInstance?: any): Promise<string | null> {
  try {
    const db = dbInstance || (await dbManager.getConnection());

    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'shop_name' THEN 1 
         WHEN 'store_name' THEN 2 
         WHEN 'pharmacy_name' THEN 3 
         WHEN 'medical_name' THEN 4 
         ELSE 5 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      const val = row.value.trim();
      const lower = val.toLowerCase();
      if (
        lower === 'xyz medical' ||
        lower === 'xyz pharmacy' ||
        lower === 'xyz'
      ) {
        return null;
      }
      return val;
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving configured pharmacy name:', err);
  }
  return null;
}

/**
 * Resolves the configured pharmacy store / medical name from app_settings dynamically.
 * Prioritizes user-configured shop_name / store_name / pharmacy_name over legacy 'XYZ MEDICAL' placeholder.
 */
export async function getStoreMedicalName(dbInstance?: any): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());

    // Primary lookup: shop_name, store_name, pharmacy_name, medical_name (excluding legacy placeholders)
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
         AND TRIM(value) != 'XYZ MEDICAL' 
         AND TRIM(value) != 'XYZ Pharmacy'
       ORDER BY CASE key 
         WHEN 'shop_name' THEN 1 
         WHEN 'store_name' THEN 2 
         WHEN 'pharmacy_name' THEN 3 
         ELSE 4 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }

    // Secondary lookup: any non-empty value
    const fallbackRow = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       LIMIT 1`
    );

    if (fallbackRow && fallbackRow.value && fallbackRow.value.trim()) {
      const val = fallbackRow.value.trim();
      if (val !== 'XYZ MEDICAL' && val !== 'XYZ Pharmacy') {
        return val;
      }
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving store medical name:', err);
  }
  return 'AI PHARMACY';
}

/**
 * Resolves the configured store phone / contact number from app_settings dynamically.
 */
export async function getStorePhone(dbInstance?: any): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_phone', 'store_phone', 'pharmacy_phone', 'phone', 'contact_number', 'phone_number', 'owner_whatsapp_number', 'whatsapp_connected_number') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'shop_phone' THEN 1 
         WHEN 'store_phone' THEN 2 
         WHEN 'owner_whatsapp_number' THEN 3
         WHEN 'whatsapp_connected_number' THEN 4
         WHEN 'pharmacy_phone' THEN 5 
         WHEN 'phone' THEN 6
         ELSE 7 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving store phone:', err);
  }
  return '';
}

/**
 * Resolves the Pharmacy / Owner WhatsApp & phone number strictly for major system reports
 * (Monthly, Expiry, Bounced Alert, Shortage/Admin Order Reminders, Non-Moving, etc.).
 * Strictly guarantees ZERO fallback to delivery boys, patients, or distributors.
 */
export async function getPharmacyOwnerPhone(dbInstance?: any): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('owner_whatsapp_number', 'admin_whatsapp_number', 'admin_whatsapp', 'shop_phone', 'store_phone', 'pharmacy_phone', 'phone') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'owner_whatsapp_number' THEN 1
         WHEN 'admin_whatsapp_number' THEN 2
         WHEN 'admin_whatsapp' THEN 3
         WHEN 'shop_phone' THEN 4 
         WHEN 'store_phone' THEN 5 
         WHEN 'pharmacy_phone' THEN 6
         ELSE 7 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving pharmacy owner phone:', err);
  }
  return '';
}

/**
 * Resolves the recipient phone number(s) for email arrival & invoice notifications based on user setting:
 * 'both' | 'store' | 'owner' | 'none'
 */
export async function getInvoiceWhatsAppRecipients(dbInstance?: any): Promise<string[]> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    
    // Check if notifications are disabled overall
    const toggleRow = await db.get("SELECT value FROM app_settings WHERE key = 'notify_owner_on_email_whatsapp'");
    if (toggleRow && (toggleRow.value === '0' || toggleRow.value === 'false')) {
      return [];
    }

    const recipientRow = await db.get("SELECT value FROM app_settings WHERE key = 'email_invoice_whatsapp_recipient'");
    const mode = (recipientRow?.value || 'both').toLowerCase().trim();

    if (mode === 'none') {
      return [];
    }

    const storePhone = await getStorePhone(db);
    const ownerPhone = await getPharmacyOwnerPhone(db);

    const recipients: string[] = [];

    if (mode === 'store' || mode === 'pharmacy') {
      if (storePhone) recipients.push(storePhone);
    } else if (mode === 'owner') {
      if (ownerPhone) recipients.push(ownerPhone);
    } else {
      // 'both' (default)
      if (storePhone) recipients.push(storePhone);
      if (ownerPhone && !recipients.includes(ownerPhone)) {
        recipients.push(ownerPhone);
      }
    }

    // Safeguard fallback: If the chosen specific recipient is not configured in DB, try the other phone
    if (recipients.length === 0) {
      if (storePhone) recipients.push(storePhone);
      else if (ownerPhone) recipients.push(ownerPhone);
    }

    return recipients;
  } catch (err) {
    console.warn('[StoreSettings] Error resolving invoice WhatsApp recipients:', err);
    return [];
  }
}


/**
 * Returns formatted store name with phone if available (e.g. "TANMANY MEDICAL (Ph: 9876543210)" or "TANMANY MEDICAL").
 */
export async function getStoreMedicalNameAndPhone(dbInstance?: any): Promise<string> {
  const name = await getStoreMedicalName(dbInstance);
  const phone = await getStorePhone(dbInstance);
  if (phone) {
    return `${name} (Ph: ${phone})`;
  }
  return name;
}

/**
 * Resolves the configured email retention limit from app_settings (default: 15).
 */
export async function getEmailRetentionLimit(dbInstance?: any): Promise<number> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'email_retention_limit'");
    if (row && row.value && !isNaN(parseInt(row.value, 10))) {
      const val = parseInt(row.value, 10);
      if (val > 0) return val;
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving email retention limit:', err);
  }
  return 15;
}

/**
 * Formats standard customer notification message for ready/fulfilled special order.
 */
export async function buildOrderReadyNotificationMessage(
  requesterName: string,
  productName: string,
  qty: number | string = 1,
  dbInstance?: any,
  lang: string = 'en'
): Promise<string> {
  const storeName = await getStoreMedicalName(dbInstance);
  const storePhone = await getStorePhone(dbInstance);
  const name = (requesterName || 'Customer').trim();
  const phone = storePhone ? storePhone.trim() : '';

  if (lang === 'hi') {
    let msg = `नमस्ते ${name}, 👋\n\nखुशखबरी! 🎉 आपकी मांगी गई दवाई ${storeName} पर लेने के लिए तैयार है।\n\nआपका ऑर्डर:\n• ${productName} × ${qty || 1}\n\n📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर अपनी दवाई प्राप्त करें।`;
    if (phone) {
      msg += `\n\n📞 सहायता के लिए, हमें ${phone} पर कॉल करें।`;
    }
    msg += `\n\n${storeName} को चुनने के लिए धन्यवाद!`;
    return msg;
  }

  if (lang === 'mr') {
    let msg = `नमस्कार ${name}, 👋\n\nआनंदाची बातमी! 🎉 आपली मागवलेली औषध ${storeName} येथे मिळण्यास तयार आहे.\n\nआपली ऑर्डर:\n• ${productName} × ${qty || 1}\n\n📍 कृपया आपल्या सोयीनुसार आमच्या दुकानाला भेट देऊन औषध घेऊन जावे।`;
    if (phone) {
      msg += `\n\n📞 मदतीसाठी, आम्हाला ${phone} वर कॉल करा.`;
    }
    msg += `\n\n${storeName} ची निवड केल्याबद्दल धन्यवाद!`;
    return msg;
  }

  let msg = `Hi ${name}, 👋\n\nGreat news! 🎉 Your requested medicine is now ready for pickup at ${storeName}.\n\nYour Order:\n• ${productName} × ${qty || 1}\n\n📍 Please visit our store at your convenience to collect your medicine.`;
  
  if (phone) {
    msg += `\n\n📞 For any assistance, call us at ${phone}.`;
  }
  
  msg += `\n\nThank you for choosing ${storeName}. We look forward to serving you!`;
  return msg;
}



