import express from 'express';
import { dbManager } from '../database/connection.js';
import { reconcileCreditNote } from '../services/creditNoteService.js';
import { extractCleanEmail } from '../utils/emailSanitizer.js';

const router = express.Router();

router.get('/distributors', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const distributors = await db.all('SELECT * FROM distributors ORDER BY name');
    res.json(distributors);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create or update distributor details
router.post('/distributors', async (req, res) => {
  const { name, phone, email, address, gstin } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Distributor name is required' });
  }
  const cleanEmail = extractCleanEmail(email);
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT id FROM distributors WHERE name = ? OR name LIKE ?', [name, `%${name}%`]);
    let targetId: number;
    if (existing) {
      targetId = existing.id;
      await db.run(
        `UPDATE distributors 
         SET phone = COALESCE(?, phone),
             contact = COALESCE(?, contact, phone),
             email = COALESCE(?, email),
             address = COALESCE(?, address),
             gstin = COALESCE(?, gstin)
         WHERE id = ?`,
        [phone, phone, cleanEmail, address, gstin, existing.id]
      );
    } else {
      const result = await db.run(
        `INSERT INTO distributors (name, phone, contact, email, address, gstin) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, phone, phone, cleanEmail, address, gstin]
      );
      targetId = result.lastID || 0;
    }

    // Auto register learning profile for local AI learning integration
    try {
      await db.run(
        'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
        [targetId]
      );
    } catch (_) {}

    res.json({ success: true, message: existing ? 'Distributor updated' : 'Distributor created', id: targetId });
  } catch (error: any) {
    console.error('Failed to create/update distributor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update distributor details including preferred email invoice format
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, preferred_file_format, gstin, address } = req.body;
  const cleanEmail = extractCleanEmail(email);
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE distributors 
       SET name = COALESCE(?, name),
           phone = COALESCE(?, phone),
           contact = COALESCE(?, contact, phone),
           email = COALESCE(?, email),
           preferred_file_format = COALESCE(?, preferred_file_format),
           gstin = COALESCE(?, gstin),
           address = COALESCE(?, address)
       WHERE id = ?`,
      [name, phone, phone, cleanEmail, preferred_file_format, gstin, address, id]
    );

    // Auto register learning profile for local AI learning integration
    try {
      await db.run(
        'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
        [id]
      );
    } catch (_) {}

    res.json({ success: true, message: 'Distributor details updated successfully' });
  } catch (error) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a distributor
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM distributors WHERE id = ?', [id]);
    try {
      await db.run('DELETE FROM distributor_learning_profiles WHERE distributor_id = ?', [id]);
    } catch (_) {}
    res.json({ success: true, message: 'Distributor deleted successfully' });
  } catch (error) {
    console.error('Failed to delete distributor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/purchases', async (req, res) => {
  const { distributor, invoice_no, total_amount } = req.body;
  try {
    const db = await dbManager.getConnection();
    // Upsert distributor
    await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', distributor);
    const distRow = await db.get('SELECT id FROM distributors WHERE name = ?', distributor);

    // Insert purchase
    await db.run('INSERT INTO purchases (distributor_id, invoice_no, total_amount) VALUES (?, ?, ?)',
      [distRow.id, invoice_no, total_amount]);

    res.json({ success: true, message: 'Purchase saved' });
  } catch (error) {
    console.error('Failed to save purchase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/returns/reconcile-credit', async (req, res) => {
  const { distributor_id, actual_credit_amount, purchase_id } = req.body;
  if (!distributor_id || actual_credit_amount === undefined) {
    return res.status(400).json({ error: 'distributor_id and actual_credit_amount are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const result = await reconcileCreditNote(db, distributor_id, actual_credit_amount, purchase_id);
    res.json(result);
  } catch (error) {
    console.error('Failed to reconcile credit note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/pending-returns', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const pendingReturns = await db.all(
      `SELECT ert.*, r.return_no 
       FROM expiry_returns_tracking ert
       LEFT JOIN returns r ON ert.return_id = r.id
       WHERE ert.distributor_id = ? AND ert.status IN ('pending', 'overdue')
       ORDER BY ert.return_date ASC`,
      [id]
    );
    res.json(pendingReturns);
  } catch (error) {
    console.error('Failed to fetch pending returns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
