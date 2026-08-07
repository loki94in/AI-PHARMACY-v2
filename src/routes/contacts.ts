import express from 'express';
import { dbManager } from '../database/connection.js';
import { syncDistributorPhoneAcrossTables } from '../utils/distributorSyncHelper.js';

const router = express.Router();

async function ensureContactsTable(db: any) {
  await db.exec(`
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
}

// GET /api/contacts
router.get('/', async (req, res) => {
  const { type, search } = req.query;
  try {
    const db = await dbManager.getConnection();
    await ensureContactsTable(db);
    let query = 'SELECT * FROM contacts WHERE 1=1';
    const params: any[] = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY name ASC';
    query += search ? ' LIMIT 100' : ' LIMIT 1000';

    const contacts = await db.all(query, params);
    res.json({ success: true, count: contacts.length, data: contacts });
  } catch (err: any) {
    console.error('Failed to fetch contacts:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts
router.post('/', async (req, res) => {
  const { name, type = 'general', phone, email, address, gstin, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';

  try {
    const db = await dbManager.getConnection();
    await ensureContactsTable(db);

    // Check existing contact by phone or name
    let existing;
    if (cleanPhone) {
      existing = await db.get('SELECT id FROM contacts WHERE phone = ? AND type = ?', [cleanPhone, type]);
    }
    if (!existing && name.trim()) {
      existing = await db.get('SELECT id FROM contacts WHERE LOWER(name) = LOWER(?) AND type = ?', [name.trim(), type]);
    }

    let contactId: number;
    if (existing) {
      contactId = existing.id;
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
          name.trim(),
          cleanPhone, cleanPhone,
          email || '', email || '',
          address || '', address || '',
          gstin || '', gstin || '',
          notes || '', notes || '',
          existing.id
        ]
      );
    } else {
      const result = await db.run(
        `INSERT INTO contacts (name, type, phone, email, address, gstin, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), type, cleanPhone, email || '', address || '', gstin || '', notes || '']
      );
      contactId = result.lastID || 0;
    }

    // Sync with distributors and pharmarack_distributor_mappings tables if type === 'distributor'
    if (type === 'distributor') {
      try {
        await syncDistributorPhoneAcrossTables(db, {
          name: name.trim(),
          phone: cleanPhone,
          email,
          address,
          gstin,
          notes
        });
      } catch (syncErr) {
        console.warn('Failed to sync distributor phone from contacts POST:', syncErr);
      }
    }

    const saved = await db.get('SELECT * FROM contacts WHERE id = ?', [contactId]);
    res.json({ success: true, message: 'Contact saved successfully', data: saved });
  } catch (err: any) {
    console.error('Failed to save contact:', err);
    res.status(500).json({ error: 'Failed to save contact' });
  }
});

// PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, phone, email, address, gstin, notes } = req.body;
  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';

  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE contacts 
       SET name = CASE WHEN ? != '' THEN ? ELSE name END,
           type = CASE WHEN ? != '' THEN ? ELSE type END,
           phone = CASE WHEN ? != '' THEN ? ELSE phone END,
           email = CASE WHEN ? != '' THEN ? ELSE email END,
           address = CASE WHEN ? != '' THEN ? ELSE address END,
           gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
           notes = CASE WHEN ? != '' THEN ? ELSE notes END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        name || '', name || '',
        type || '', type || '',
        cleanPhone, cleanPhone,
        email || '', email || '',
        address || '', address || '',
        gstin || '', gstin || '',
        notes || '', notes || '',
        id
      ]
    );

    const updated = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);

    if (updated && updated.type === 'distributor') {
      try {
        await syncDistributorPhoneAcrossTables(db, {
          name: updated.name,
          phone: updated.phone,
          email: updated.email,
          address: updated.address,
          gstin: updated.gstin,
          notes: updated.notes
        });
      } catch (syncErr) {
        console.warn('Failed to sync distributor phone from contacts PUT:', syncErr);
      }
    }

    res.json({ success: true, message: 'Contact updated successfully', data: updated });
  } catch (err: any) {
    console.error('Failed to update contact:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM contacts WHERE id = ?', [id]);
    res.json({ success: true, message: 'Contact deleted successfully' });
  } catch (err: any) {
    console.error('Failed to delete contact:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;
