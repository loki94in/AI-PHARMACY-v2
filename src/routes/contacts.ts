import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

// GET /api/contacts - Fetch all unified contacts with optional type & search filter
router.get('/', async (req, res) => {
  const { type, search, limit } = req.query;
  try {
    const db = await dbManager.getConnection();
    let sql = 'SELECT * FROM contacts WHERE 1=1';
    const params: any[] = [];

    if (type && type !== 'all') {
      sql += ' AND type = ?';
      params.push(String(type));
    }

    if (search) {
      const q = `%${String(search).trim()}%`;
      sql += ' AND (name LIKE ? OR phone LIKE ? OR gstin LIKE ? OR alias_names LIKE ?)';
      params.push(q, q, q, q);
    }

    sql += ' ORDER BY type ASC, name ASC';

    if (limit && !isNaN(Number(limit))) {
      sql += ' LIMIT ?';
      params.push(Number(limit));
    }

    const contacts = await db.all(sql, params);
    res.json({ success: true, count: contacts.length, data: contacts });
  } catch (err: any) {
    console.error('[Contacts API] GET error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch contacts' });
  }
});

// POST /api/contacts - Create or upsert a unified contact & sync with domain tables
router.post('/', async (req, res) => {
  const { name, type, phone, email, address, gstin, notes, alias_names, is_active } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Contact name is required' });
  }
  if (!type || !['distributor', 'delivery_boy', 'doctor', 'customer', 'owner', 'admin'].includes(type)) {
    return res.status(400).json({ error: 'Valid contact type is required' });
  }

  const cleanName = name.trim();
  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
  const now = new Date().toISOString();

  try {
    const db = await dbManager.getConnection();

    // Check existing contact by type & name
    const existing = await db.get(
      'SELECT id FROM contacts WHERE type = ? AND (LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?))',
      [type, cleanName, `%${cleanName}%`]
    );

    let contactId: number;

    if (existing) {
      contactId = existing.id;
      await db.run(
        `UPDATE contacts 
         SET name = ?,
             phone = COALESCE(?, phone),
             email = COALESCE(?, email),
             address = COALESCE(?, address),
             gstin = COALESCE(?, gstin),
             notes = COALESCE(?, notes),
             alias_names = COALESCE(?, alias_names),
             is_active = COALESCE(?, is_active),
             updated_at = ?
         WHERE id = ?`,
        [cleanName, cleanPhone, email || null, address || null, gstin || null, notes || null, alias_names || null, is_active ?? 1, now, contactId]
      );
    } else {
      const result = await db.run(
        `INSERT INTO contacts (name, type, phone, email, address, gstin, notes, alias_names, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cleanName, type, cleanPhone, email || null, address || null, gstin || null, notes || null, alias_names || null, is_active ?? 1, now, now]
      );
      contactId = result.lastID;
    }

    // Sync with domain tables
    await syncDomainTable(db, type, cleanName, cleanPhone, email, address, gstin, is_active);

    const updated = await db.get('SELECT * FROM contacts WHERE id = ?', contactId);
    res.json({ success: true, message: 'Contact saved and synced', data: updated });
  } catch (err: any) {
    console.error('[Contacts API] POST error:', err);
    res.status(500).json({ error: err?.message || 'Failed to save contact' });
  }
});

// PUT /api/contacts/:id - Update specific contact by ID
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, phone, email, address, gstin, notes, alias_names, is_active } = req.body;

  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM contacts WHERE id = ?', id);

    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const cleanName = (name || existing.name).trim();
    const cleanPhone = phone !== undefined ? (phone ? String(phone).replace(/\D/g, '') : null) : existing.phone;
    const targetType = type || existing.type;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE contacts
       SET name = ?,
           type = ?,
           phone = ?,
           email = ?,
           address = ?,
           gstin = ?,
           notes = ?,
           alias_names = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        cleanName,
        targetType,
        cleanPhone,
        email !== undefined ? email : existing.email,
        address !== undefined ? address : existing.address,
        gstin !== undefined ? gstin : existing.gstin,
        notes !== undefined ? notes : existing.notes,
        alias_names !== undefined ? alias_names : existing.alias_names,
        is_active !== undefined ? is_active : existing.is_active,
        now,
        id
      ]
    );

    // Sync with domain tables
    await syncDomainTable(db, targetType, cleanName, cleanPhone, email, address, gstin, is_active);

    const updated = await db.get('SELECT * FROM contacts WHERE id = ?', id);
    res.json({ success: true, message: 'Contact updated and synced', data: updated });
  } catch (err: any) {
    console.error('[Contacts API] PUT error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM contacts WHERE id = ?', id);

    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await db.run('DELETE FROM contacts WHERE id = ?', id);
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err: any) {
    console.error('[Contacts API] DELETE error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete contact' });
  }
});

/** Helper to cascade contact updates to domain tables (distributors, delivery_boys, doctors, customers) */
async function syncDomainTable(
  db: any,
  type: string,
  name: string,
  phone: string | null,
  email?: string,
  address?: string,
  gstin?: string,
  isActive?: number
) {
  try {
    if (type === 'distributor') {
      const dist = await db.get('SELECT id FROM distributors WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)', [name, `%${name}%`]);
      if (dist) {
        await db.run(
          `UPDATE distributors SET phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address), gstin = COALESCE(?, gstin) WHERE id = ?`,
          [phone, email || null, address || null, gstin || null, dist.id]
        );
      } else {
        await db.run(
          `INSERT OR IGNORE INTO distributors (name, phone, email, address, gstin) VALUES (?, ?, ?, ?, ?)`,
          [name, phone, email || null, address || null, gstin || null]
        );
      }
    } else if (type === 'delivery_boy') {
      const boy = await db.get('SELECT id FROM delivery_boys WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)', [name, `%${name}%`]);
      if (boy) {
        await db.run(
          `UPDATE delivery_boys SET whatsapp_number = COALESCE(?, whatsapp_number), is_active = COALESCE(?, is_active) WHERE id = ?`,
          [phone, isActive ?? 1, boy.id]
        );
      } else {
        await db.run(
          `INSERT OR IGNORE INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, ?)`,
          [name, phone, isActive ?? 1]
        );
      }
    } else if (type === 'doctor') {
      const doc = await db.get('SELECT id FROM doctors WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)', [name, `%${name}%`]);
      if (doc) {
        await db.run(
          `UPDATE doctors SET phone = COALESCE(?, phone), address = COALESCE(?, address) WHERE id = ?`,
          [phone, address || null, doc.id]
        );
      } else {
        await db.run(
          `INSERT OR IGNORE INTO doctors (name, phone, address) VALUES (?, ?, ?)`,
          [name, phone, address || null]
        );
      }
    } else if (type === 'customer') {
      const cust = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)', [name, `%${name}%`]);
      if (cust) {
        await db.run(
          `UPDATE customers SET phone = COALESCE(?, phone), address = COALESCE(?, address) WHERE id = ?`,
          [phone, address || null, cust.id]
        );
      } else {
        await db.run(
          `INSERT OR IGNORE INTO customers (name, phone, address) VALUES (?, ?, ?)`,
          [name, phone, address || null]
        );
      }
    }
  } catch (syncErr) {
    console.warn('[Contacts API] Domain sync warning:', syncErr);
  }
}

export default router;
