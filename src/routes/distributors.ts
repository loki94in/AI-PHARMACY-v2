import express from 'express';
import { dbManager } from '../database/connection.js';
import { reconcileCreditNote } from '../services/creditNoteService.js';

const router = express.Router();

router.get('/distributors', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const distributors = await db.all('SELECT * FROM distributors ORDER BY name');
    await dbManager.close();
    res.json(distributors);
  } catch (error) {
    await dbManager.close();
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

    await dbManager.close();

    // Trigger checking refills now that new purchase stock is saved
    // This would be handled via events or services in a more complete refactor

    res.json({ success: true, message: 'Purchase saved' });
  } catch (error) {
    await dbManager.close();
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
    await dbManager.close();
    res.json(result);
  } catch (error) {
    await dbManager.close();
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
    await dbManager.close();
    res.json(pendingReturns);
  } catch (error) {
    await dbManager.close();
    console.error('Failed to fetch pending returns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
