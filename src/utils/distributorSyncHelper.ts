import { extractCleanEmail } from './emailSanitizer.js';

export interface SyncDistributorParams {
  id?: number;
  name?: string;
  store_name?: string;
  phone?: string | number;
  contact?: string | number;
  whatsapp?: string | number;
  email?: string;
  address?: string;
  gstin?: string;
  state_code?: string;
  preferred_file_format?: string;
  notes?: string;
}

/**
 * Ensures distributor phone/contact changes are permanently saved and synchronized 
 * across distributors, pharmarack_distributor_mappings, and contacts tables in SQLite.
 */
export async function syncDistributorPhoneAcrossTables(db: any, params: SyncDistributorParams) {
  const distName = (params.name || params.store_name || '').trim();
  const phoneInput = params.phone !== undefined && params.phone !== null && String(params.phone).trim() !== ''
    ? params.phone
    : (params.contact !== undefined && params.contact !== null && String(params.contact).trim() !== ''
        ? params.contact
        : params.whatsapp);

  const rawPhone = phoneInput !== undefined && phoneInput !== null ? String(phoneInput).trim() : '';
  let cleanPhone = (rawPhone && !rawPhone.includes('@') && !rawPhone.includes('<'))
    ? rawPhone.replace(/\D/g, '')
    : '';
  if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
    cleanPhone = cleanPhone.slice(2);
  }

  const cleanEmail = extractCleanEmail(params.email);

  let targetId: number | null = params.id && !isNaN(Number(params.id)) ? Number(params.id) : null;
  let existingDist: any = null;

  if (targetId) {
    existingDist = await db.get('SELECT * FROM distributors WHERE id = ?', [targetId]);
  }

  if (!existingDist && distName) {
    existingDist = await db.get('SELECT * FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [distName]);
    if (existingDist) {
      targetId = existingDist.id;
    }
  }

  // 1. Update or Insert into 'distributors' table
  if (existingDist) {
    let nameToUpdate = distName;
    if (distName && distName.toLowerCase().trim() !== (existingDist.name || '').toLowerCase().trim()) {
      const duplicate = await db.get(
        'SELECT id FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?',
        [distName, existingDist.id]
      );
      if (duplicate) {
        // Name collides with another distributor record — preserve target distributor's name to prevent UNIQUE constraint failure
        nameToUpdate = existingDist.name;
      }
    }

    try {
      await db.run(
        `UPDATE distributors 
         SET name = CASE WHEN ? != '' THEN ? ELSE name END,
             phone = CASE WHEN ? != '' THEN ? ELSE phone END,
             contact = CASE WHEN ? != '' THEN ? ELSE contact END,
             email = CASE WHEN ? != '' THEN ? ELSE email END,
             address = CASE WHEN ? != '' THEN ? ELSE address END,
             gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
             state_code = CASE WHEN ? != '' THEN ? ELSE state_code END,
             preferred_file_format = CASE WHEN ? != '' THEN ? ELSE preferred_file_format END
         WHERE id = ?`,
        [
          nameToUpdate, nameToUpdate,
          cleanPhone, cleanPhone,
          cleanPhone, cleanPhone,
          cleanEmail, cleanEmail,
          params.address || '', params.address || '',
          params.gstin || '', params.gstin || '',
          params.state_code || '', params.state_code || '',
          params.preferred_file_format || '', params.preferred_file_format || '',
          existingDist.id
        ]
      );
    } catch (updateErr: any) {
      if (updateErr?.message?.includes('UNIQUE') || updateErr?.code === 'SQLITE_CONSTRAINT') {
        await db.run(
          `UPDATE distributors 
           SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
               contact = CASE WHEN ? != '' THEN ? ELSE contact END,
               email = CASE WHEN ? != '' THEN ? ELSE email END,
               address = CASE WHEN ? != '' THEN ? ELSE address END,
               gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
               state_code = CASE WHEN ? != '' THEN ? ELSE state_code END,
               preferred_file_format = CASE WHEN ? != '' THEN ? ELSE preferred_file_format END
           WHERE id = ?`,
          [
            cleanPhone, cleanPhone,
            cleanPhone, cleanPhone,
            cleanEmail, cleanEmail,
            params.address || '', params.address || '',
            params.gstin || '', params.gstin || '',
            params.state_code || '', params.state_code || '',
            params.preferred_file_format || '', params.preferred_file_format || '',
            existingDist.id
          ]
        );
      } else {
        throw updateErr;
      }
    }
    targetId = existingDist.id;
  } else if (distName) {
    try {
      const result = await db.run(
        `INSERT INTO distributors (name, phone, contact, email, address, gstin, state_code, preferred_file_format)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          distName,
          cleanPhone,
          cleanPhone,
          cleanEmail,
          params.address || '',
          params.gstin || '',
          params.state_code || '',
          params.preferred_file_format || ''
        ]
      );
      targetId = result.lastID || 0;
    } catch (insertErr: any) {
      if (insertErr?.message?.includes('UNIQUE') || insertErr?.code === 'SQLITE_CONSTRAINT') {
        const matched = await db.get('SELECT id FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [distName]);
        if (matched) {
          targetId = matched.id;
          await db.run(
            `UPDATE distributors 
             SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                 contact = CASE WHEN ? != '' THEN ? ELSE contact END,
                 email = CASE WHEN ? != '' THEN ? ELSE email END
             WHERE id = ?`,
            [cleanPhone, cleanPhone, cleanPhone, cleanPhone, cleanEmail, cleanEmail, matched.id]
          );
        } else {
          throw insertErr;
        }
      } else {
        throw insertErr;
      }
    }
  }

  if (!targetId) {
    throw new Error('Unable to create or locate distributor record.');
  }

  // Auto register AI Learning profile
  try {
    await db.run(
      'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
      [targetId]
    );
  } catch (_) {}

  const finalDistributor = await db.get('SELECT * FROM distributors WHERE id = ?', [targetId]);
  const effectiveName = finalDistributor?.name || distName;
  const effectivePhone = finalDistributor?.phone || finalDistributor?.contact || cleanPhone;

  // 2. Update/Insert 'pharmarack_distributor_mappings'
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    if (effectiveName) {
      await db.run(
        `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(store_name) DO UPDATE SET
           distributor_id = COALESCE(EXCLUDED.distributor_id, pharmarack_distributor_mappings.distributor_id),
           phone = CASE WHEN EXCLUDED.phone != '' THEN EXCLUDED.phone ELSE pharmarack_distributor_mappings.phone END,
           updated_at = CURRENT_TIMESTAMP`,
        [effectiveName.trim(), targetId, effectivePhone || '']
      );

      if (effectivePhone) {
        await db.run(
          `UPDATE pharmarack_distributor_mappings
           SET phone = ?, updated_at = CURRENT_TIMESTAMP
           WHERE distributor_id = ? AND (phone IS NULL OR phone = '' OR phone != ?)`,
          [effectivePhone, targetId, effectivePhone]
        );
      }
    }
  } catch (err) {
    console.warn('[distributorSync] Failed to sync pharmarack_distributor_mappings:', err);
  }

  // 3. Update/Insert 'contacts' master table
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'general',
        phone TEXT,
        email TEXT,
        address TEXT,
        gstin TEXT,
        notes TEXT,
        alias_names TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    let existingContact;
    if (effectivePhone) {
      existingContact = await db.get('SELECT id FROM contacts WHERE phone = ? AND type = ?', [effectivePhone, 'distributor']);
    }
    if (!existingContact && effectiveName) {
      existingContact = await db.get('SELECT id FROM contacts WHERE LOWER(name) = LOWER(?) AND type = ?', [effectiveName.trim(), 'distributor']);
    }

    if (existingContact) {
      await db.run(
        `UPDATE contacts
         SET name = ?,
             phone = CASE WHEN ? != '' THEN ? ELSE phone END,
             email = CASE WHEN ? != '' THEN ? ELSE email END,
             address = CASE WHEN ? != '' THEN ? ELSE address END,
             gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
             notes = CASE WHEN ? != '' THEN ? ELSE notes END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          effectiveName.trim(),
          effectivePhone, effectivePhone,
          cleanEmail, cleanEmail,
          params.address || '', params.address || '',
          params.gstin || '', params.gstin || '',
          params.notes || '', params.notes || '',
          existingContact.id
        ]
      );
    } else if (effectiveName) {
      await db.run(
        `INSERT INTO contacts (name, type, phone, email, address, gstin, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [effectiveName.trim(), 'distributor', effectivePhone, cleanEmail, params.address || '', params.gstin || '', params.notes || '']
      );
    }
  } catch (err) {
    console.warn('[distributorSync] Failed to sync contacts:', err);
  }

  return finalDistributor;
}
