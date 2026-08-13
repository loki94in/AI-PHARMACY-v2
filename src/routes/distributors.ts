import express from 'express';
import fs from 'fs';
import { dbManager } from '../database/connection.js';
import { reconcileCreditNote } from '../services/creditNoteService.js';
import { syncDistributorPhoneAcrossTables } from '../utils/distributorSyncHelper.js';
import { eventService } from '../services/eventService.js';
import { syncTodayActiveDistributors } from '../services/distributorDispatchReminderWorker.js';

const router = express.Router();

const getDistributorsHandler = async (req: express.Request, res: express.Response) => {
  try {
    const db = await dbManager.getConnection();
    const distributors = await db.all('SELECT * FROM distributors ORDER BY name LIMIT 1000');
    res.json(distributors);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.get('/distributors', getDistributorsHandler);
router.get('/', getDistributorsHandler);

// Get Pharmarack catalog distributors list for conflict resolution and merging
router.get('/pharmarack-list', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_name TEXT UNIQUE,
        distributor_code TEXT,
        phone TEXT,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const rows = await db.all('SELECT * FROM pharmarack_distributors ORDER BY store_name ASC LIMIT 1000');
    res.json({ success: true, distributors: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch Pharmarack distributors: ' + error.message });
  }
});

// Create or update distributor details
const postDistributorsHandler = async (req: express.Request, res: express.Response) => {
  const { name, store_name, phone, contact, email, address, gstin, state_code, preferred_file_format } = req.body;
  const distName = (name || store_name || '').trim();
  if (!distName) {
    return res.status(400).json({ error: 'Distributor name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    const savedDistributor = await syncDistributorPhoneAcrossTables(db, {
      name: distName,
      phone,
      contact,
      email,
      address,
      gstin,
      state_code,
      preferred_file_format
    });

    res.json({
      success: true,
      message: 'Distributor saved successfully',
      id: savedDistributor.id,
      data: savedDistributor
    });
    eventService.broadcast('distributors_updated', { action: 'create', id: savedDistributor.id });
  } catch (error: any) {
    console.error('Failed to create/update distributor:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};

router.post('/distributors', postDistributorsHandler);
router.post('/', postDistributorsHandler);

// Update distributor details including preferred email invoice format
const putDistributorHandler = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { name, store_name, phone, contact, email, preferred_file_format, gstin, address, state_code } = req.body;
  try {
    const db = await dbManager.getConnection();
    const savedDistributor = await syncDistributorPhoneAcrossTables(db, {
      id: Number(id),
      name: name || store_name,
      phone,
      contact,
      email,
      address,
      gstin,
      state_code,
      preferred_file_format
    });

    syncTodayActiveDistributors().catch(() => {});

    res.json({
      success: true,
      message: 'Distributor details updated successfully',
      id: Number(id),
      data: savedDistributor
    });
    eventService.broadcast('distributors_updated', { action: 'update', id: Number(id) });
  } catch (error: any) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};

router.put('/distributors/:id', putDistributorHandler);
router.put('/:id', putDistributorHandler);

// Delete a distributor
const deleteDistributorHandler = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();

    // Remove learned OCR files from disk before dropping their DB rows so nothing orphaned is left behind
    try {
      const files = await db.all('SELECT file_path FROM distributor_historical_files WHERE distributor_id = ?', [id]);
      for (const f of files) {
        if (f.file_path && fs.existsSync(f.file_path)) {
          try { fs.unlinkSync(f.file_path); } catch (e) { console.warn('Failed to delete distributor file:', f.file_path, e); }
        }
      }
      await db.run('DELETE FROM distributor_historical_files WHERE distributor_id = ?', [id]);
    } catch (_) {}

    // Deleted distributors must stop appearing on the Dispatch page immediately
    try {
      await db.run('DELETE FROM distributor_dispatch_reminders WHERE distributor_id = ?', [id]);
    } catch (_) {}

    try {
      await db.run('DELETE FROM distributor_learning_profiles WHERE distributor_id = ?', [id]);
    } catch (_) {}

    await db.run('DELETE FROM distributors WHERE id = ?', [id]);

    eventService.broadcast('distributors_updated', { action: 'delete', id: Number(id) });
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

router.get(['/distributors/:id/pending-returns', '/:id/pending-returns'], async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const pendingReturns = await db.all(
      `SELECT ert.*, r.return_no 
       FROM expiry_returns_tracking ert
       LEFT JOIN returns r ON ert.return_id = r.id
       WHERE ert.distributor_id = ? AND ert.status IN ('pending', 'overdue')
       ORDER BY ert.return_date ASC LIMIT 1000`,
      [id]
    );
    res.json(pendingReturns);
  } catch (error) {
    console.error('Failed to fetch pending returns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
