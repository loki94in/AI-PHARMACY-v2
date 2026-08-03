import express from 'express';
import { dbManager } from '../database/connection.js';
import { reconcileCreditNote } from '../services/creditNoteService.js';
import { extractCleanEmail } from '../utils/emailSanitizer.js';

const router = express.Router();

const getDistributorsHandler = async (req: express.Request, res: express.Response) => {
  try {
    const db = await dbManager.getConnection();
    const distributors = await db.all('SELECT * FROM distributors ORDER BY name');
    res.json(distributors);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.get('/distributors', getDistributorsHandler);
router.get('/', getDistributorsHandler);

// Create or update distributor details
const postDistributorsHandler = async (req: express.Request, res: express.Response) => {
  const { name, phone, email, address, gstin } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Distributor name is required' });
  }
  const rawPhone = (phone && typeof phone === 'string' && !phone.includes('@') && !phone.includes('<')) ? phone.trim() : (typeof phone === 'number' ? String(phone) : '');
  const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, '') : '';
  const cleanEmail = extractCleanEmail(email);
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT id FROM distributors WHERE name = ? OR name LIKE ?', [name, `%${name}%`]);
    let targetId: number;
    if (existing) {
      targetId = existing.id;
      await db.run(
        `UPDATE distributors 
         SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
             contact = CASE WHEN ? != '' THEN ? ELSE contact END,
             email = CASE WHEN ? != '' THEN ? ELSE email END,
             address = CASE WHEN ? != '' THEN ? ELSE address END,
             gstin = CASE WHEN ? != '' THEN ? ELSE gstin END
         WHERE id = ?`,
        [cleanPhone, cleanPhone, cleanPhone, cleanPhone, cleanEmail, cleanEmail, address || '', address || '', gstin || '', gstin || '', existing.id]
      );
    } else {
      const result = await db.run(
        `INSERT INTO distributors (name, phone, contact, email, address, gstin) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, cleanPhone, cleanPhone, cleanEmail, address || '', gstin || '']
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
};

router.post('/distributors', postDistributorsHandler);
router.post('/', postDistributorsHandler);

// Update distributor details including preferred email invoice format
const putDistributorHandler = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { name, phone, email, preferred_file_format, gstin, address } = req.body;
  const rawPhone = (phone && typeof phone === 'string' && !phone.includes('@') && !phone.includes('<')) ? phone.trim() : (typeof phone === 'number' ? String(phone) : '');
  const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, '') : '';
  const cleanEmail = extractCleanEmail(email);
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE distributors 
       SET name = CASE WHEN ? != '' THEN ? ELSE name END,
           phone = CASE WHEN ? != '' THEN ? ELSE phone END,
           contact = CASE WHEN ? != '' THEN ? ELSE contact END,
           email = CASE WHEN ? != '' THEN ? ELSE email END,
           preferred_file_format = CASE WHEN ? != '' THEN ? ELSE preferred_file_format END,
           gstin = CASE WHEN ? != '' THEN ? ELSE gstin END,
           address = CASE WHEN ? != '' THEN ? ELSE address END
       WHERE id = ?`,
      [
        name || '', name || '',
        cleanPhone, cleanPhone,
        cleanPhone, cleanPhone,
        cleanEmail, cleanEmail,
        preferred_file_format || '', preferred_file_format || '',
        gstin || '', gstin || '',
        address || '', address || '',
        id
      ]
    );

    // Auto register learning profile for local AI learning integration
    try {
      await db.run(
        'INSERT OR IGNORE INTO distributor_learning_profiles (distributor_id) VALUES (?)',
        [id]
      );
    } catch (_) {}

    res.json({ success: true, message: 'Distributor details updated successfully', id: Number(id) });
  } catch (error) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.put('/distributors/:id', putDistributorHandler);
router.put('/:id', putDistributorHandler);

// Delete a distributor
const deleteDistributorHandler = async (req: express.Request, res: express.Response) => {
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
};

router.delete('/distributors/:id', deleteDistributorHandler);
router.delete('/:id', deleteDistributorHandler);

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
