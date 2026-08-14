import { extractCleanEmail } from './emailSanitizer.js';
import { isValidDistributorName } from './nameNormalizer.js';

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

export function normalizeDistributorName(rawName: string): string {
  if (!rawName) return '';
  return rawName
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, '')
    .replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic|cosmetics|cosmatics/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface ResolvedDistributorContact {
  distributor_id: number | null;
  distributor_name: string;
  distributor_phone: string;
  preferred_file_format?: string;
  source: 'mapping' | 'exact_master' | 'fuzzy_master' | 'contact' | 'none';
}

/**
 * Universal Distributor Phone & Contact Resolver.
 * Resolves distributor phone via:
 * 1. Persistent store mapping in `pharmarack_distributor_mappings`
 * 2. Exact match in `distributors` table
 * 3. Fuzzy normalized match in `pharmarack_distributor_mappings`
 * 4. Fuzzy normalized match in `distributors` table (and auto-persists mapping)
 * 5. Unified `contacts` table
 */
export async function resolveDistributorContact(db: any, storeOrDistName: string): Promise<ResolvedDistributorContact> {
  const rawName = (storeOrDistName || '').trim();
  if (!rawName) {
    return { distributor_id: null, distributor_name: '', distributor_phone: '', source: 'none' };
  }

  const cleanStoreNorm = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normStore = normalizeDistributorName(rawName);

  const cleanPhoneStr = (p: any): string => {
    if (!p) return '';
    const raw = String(p).trim();
    if (raw.includes('@') || raw.includes('<')) return '';
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    return digits.length === 10 ? digits : (digits ? digits : '');
  };

  // 1. Check exact match in pharmarack_distributor_mappings
  try {
    const mapRow = await db.get(
      `SELECT m.store_name, m.distributor_id, m.phone as map_phone, d.name as dist_name, d.phone as dist_phone, d.preferred_file_format
       FROM pharmarack_distributor_mappings m
       LEFT JOIN distributors d ON m.distributor_id = d.id
       WHERE LOWER(TRIM(m.store_name)) = LOWER(TRIM(?))`,
      [rawName]
    );
    if (mapRow) {
      const phone = cleanPhoneStr(mapRow.dist_phone || mapRow.map_phone);
      if (phone) {
        return {
          distributor_id: mapRow.distributor_id || null,
          distributor_name: mapRow.dist_name || mapRow.store_name || rawName,
          distributor_phone: phone,
          preferred_file_format: mapRow.preferred_file_format,
          source: 'mapping'
        };
      }
    }
  } catch (_) {}

  // 2. Check exact match in distributors table
  try {
    const distRow = await db.get(
      `SELECT id, name, phone, contact, preferred_file_format FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`,
      [rawName]
    );
    if (distRow) {
      const phone = cleanPhoneStr(distRow.phone || distRow.contact);
      if (phone) {
        return {
          distributor_id: distRow.id,
          distributor_name: distRow.name,
          distributor_phone: phone,
          preferred_file_format: distRow.preferred_file_format,
          source: 'exact_master'
        };
      }
    }
  } catch (_) {}

  // 3. Check fuzzy / normalized match in pharmarack_distributor_mappings
  try {
    const allMappings = await db.all(
      `SELECT m.store_name, m.distributor_id, m.phone as map_phone, d.name as dist_name, d.phone as dist_phone, d.preferred_file_format
       FROM pharmarack_distributor_mappings m
       LEFT JOIN distributors d ON m.distributor_id = d.id`
    );
    if (Array.isArray(allMappings) && allMappings.length > 0) {
      const matched = allMappings.find((m: any) => {
        const sName = m.store_name || '';
        const rawSavedNorm = sName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normSaved = normalizeDistributorName(sName);
        return (
          (rawSavedNorm && rawSavedNorm === cleanStoreNorm) ||
          (normSaved && normSaved === normStore) ||
          (normSaved && normStore && (normStore.includes(normSaved) || normSaved.includes(normStore)))
        );
      });
      if (matched) {
        const phone = cleanPhoneStr(matched.dist_phone || matched.map_phone);
        if (phone) {
          // Auto-persist resolved store mapping so future lookups and AI Learning index know about this alias
          try {
            await db.run(
              `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(store_name) DO UPDATE SET
                 distributor_id = COALESCE(EXCLUDED.distributor_id, pharmarack_distributor_mappings.distributor_id),
                 phone = CASE WHEN EXCLUDED.phone != '' THEN EXCLUDED.phone ELSE pharmarack_distributor_mappings.phone END,
                 updated_at = CURRENT_TIMESTAMP`,
              [rawName, matched.distributor_id, phone]
            );
          } catch (_) {}

          return {
            distributor_id: matched.distributor_id || null,
            distributor_name: matched.dist_name || matched.store_name || rawName,
            distributor_phone: phone,
            preferred_file_format: matched.preferred_file_format,
            source: 'mapping'
          };
        }
      }
    }
  } catch (_) {}

  // 4. Check fuzzy / normalized match in distributors table
  try {
    const allDistributors = await db.all(
      `SELECT id, name, phone, contact, preferred_file_format FROM distributors`
    );
    if (Array.isArray(allDistributors) && allDistributors.length > 0) {
      // Priority A: Exact stripped alphanumeric match
      let matched = allDistributors.find((d: any) => {
        if (!d || !d.name) return false;
        const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanPhoneStr(d.phone || d.contact) && rawSavedNorm && rawSavedNorm === cleanStoreNorm;
      });

      // Priority B: Normalized keyword match
      if (!matched && normStore) {
        matched = allDistributors.find((d: any) => {
          if (!d || !d.name) return false;
          const normSaved = normalizeDistributorName(d.name);
          return cleanPhoneStr(d.phone || d.contact) && normSaved && normSaved === normStore;
        });
      }

      // Priority C: Substring includes match
      if (!matched && (normStore || cleanStoreNorm)) {
        matched = allDistributors.find((d: any) => {
          if (!d || !d.name) return false;
          const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const normSaved = normalizeDistributorName(d.name);
          const hasPhone = Boolean(cleanPhoneStr(d.phone || d.contact));
          if (!hasPhone) return false;
          return (
            (normStore && normSaved && (normStore.includes(normSaved) || normSaved.includes(normStore))) ||
            (cleanStoreNorm && rawSavedNorm && (cleanStoreNorm.includes(rawSavedNorm) || rawSavedNorm.includes(cleanStoreNorm)))
          );
        });
      }

      if (matched) {
        const phone = cleanPhoneStr(matched.phone || matched.contact);
        if (phone) {
          // Auto-persist resolved mapping so future lookups are instant
          try {
            await db.run(
              `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(store_name) DO UPDATE SET
                 distributor_id = COALESCE(EXCLUDED.distributor_id, pharmarack_distributor_mappings.distributor_id),
                 phone = CASE WHEN EXCLUDED.phone != '' THEN EXCLUDED.phone ELSE pharmarack_distributor_mappings.phone END,
                 updated_at = CURRENT_TIMESTAMP`,
              [rawName, matched.id, phone]
            );
          } catch (_) {}

          return {
            distributor_id: matched.id,
            distributor_name: matched.name,
            distributor_phone: phone,
            preferred_file_format: matched.preferred_file_format,
            source: 'fuzzy_master'
          };
        }
      }
    }
  } catch (_) {}

  // 5. Check contacts master table
  try {
    const contactRow = await db.get(
      `SELECT id, name, phone FROM contacts WHERE type = 'distributor' AND LOWER(TRIM(name)) = LOWER(TRIM(?))`,
      [rawName]
    );
    if (contactRow) {
      const phone = cleanPhoneStr(contactRow.phone);
      if (phone) {
        return {
          distributor_id: null,
          distributor_name: contactRow.name,
          distributor_phone: phone,
          source: 'contact'
        };
      }
    }
  } catch (_) {}

  return { distributor_id: null, distributor_name: rawName, distributor_phone: '', source: 'none' };
}

/**
 * Ensures distributor phone/contact changes are permanently saved and synchronized 
 * across distributors, pharmarack_distributor_mappings, and contacts tables in SQLite.
 */
export async function syncDistributorPhoneAcrossTables(db: any, params: SyncDistributorParams) {
  const rawDistName = (params.name || params.store_name || '').trim();
  const distName = isValidDistributorName(rawDistName) ? rawDistName : '';
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

  // 4. Update 'distributor_dispatch_reminders' active records to keep numbers in sync with AI Learning & settings
  try {
    if (effectivePhone || effectiveName) {
      await db.run(
        `UPDATE distributor_dispatch_reminders
         SET distributor_phone = CASE WHEN ? != '' THEN ? ELSE distributor_phone END,
             distributor_name = CASE WHEN ? != '' THEN ? ELSE distributor_name END
         WHERE distributor_id = ? OR LOWER(TRIM(distributor_name)) = LOWER(TRIM(?))`,
        [
          effectivePhone || '', effectivePhone || '',
          effectiveName.trim(), effectiveName.trim(),
          targetId, effectiveName.trim()
        ]
      );
    }
  } catch (err) {
    console.warn('[distributorSync] Failed to sync distributor_dispatch_reminders:', err);
  }

  return finalDistributor;
}
