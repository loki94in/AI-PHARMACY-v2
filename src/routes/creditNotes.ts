import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// List credit notes (with optional filters)
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { distributor_id, status } = req.query;

    let query = `
      SELECT cn.*, d.name as distributor_name
      FROM credit_notes cn
      LEFT JOIN distributors d ON cn.distributor_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (distributor_id) {
      query += ' AND cn.distributor_id = ?';
      params.push(distributor_id);
    }
    if (status) {
      query += ' AND cn.status = ?';
      params.push(status);
    }

    query += ' ORDER BY cn.cn_date DESC';

    const creditNotes = await db.all(query, params);
        res.json(creditNotes);
  } catch (err) {
    console.error('Credit notes fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending credit notes for a distributor
router.get('/pending/:distributorId', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { distributorId } = req.params;

    const pendingCNs = await db.all(
      `SELECT * FROM credit_notes 
       WHERE distributor_id = ? AND status = 'pending' 
       ORDER BY cn_date ASC`,
      [distributorId]
    );

    const totalPending = pendingCNs.reduce((sum, cn) => sum + (cn.amount - cn.applied_amount), 0);

        res.json({ creditNotes: pendingCNs, totalPending });
  } catch (err) {
    console.error('Pending CNs fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new credit note
router.post('/', async (req, res) => {
  const { distributor_id, cn_number, cn_date, amount, reason, related_purchase_id } = req.body;

  if (!distributor_id || !cn_date || !amount) {
    return res.status(400).json({ error: 'Distributor, CN date, and amount are required' });
  }

  try {
    const db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const result = await db.run(
      `INSERT INTO credit_notes (distributor_id, cn_number, cn_date, amount, reason, related_purchase_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [distributor_id, cn_number || null, cn_date, amount, reason || null, related_purchase_id || null]
    );

    const cnId = result.lastID;

    // Log the action
    await db.run(
      `INSERT INTO action_logs (action_type, description) 
       VALUES ('CREATE_CREDIT_NOTE', ?)`,
      [`Created CN #${cn_number || cnId} for distributor ID ${distributor_id}, amount: ₹${amount}`]
    );

    await db.run('COMMIT');
    
    res.json({ success: true, id: cnId, message: 'Credit note created successfully' });
  } catch (error) {
    console.error('Create CN error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Apply credit note to a purchase bill
router.post('/apply', async (req, res) => {
  const { cn_id, purchase_id, apply_amount } = req.body;

  if (!cn_id || !purchase_id) {
    return res.status(400).json({ error: 'Credit note ID and purchase ID are required' });
  }

  try {
    const db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    // Get the credit note
    const cn = await db.get('SELECT * FROM credit_notes WHERE id = ?', [cn_id]);
    if (!cn) {
      await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Credit note not found' });
    }

    if (cn.status !== 'pending') {
      await db.run('ROLLBACK');
            return res.status(400).json({ error: 'Credit note is not pending' });
    }

    const availableAmount = cn.amount - cn.applied_amount;
    const amountToApply = apply_amount ? Math.min(apply_amount, availableAmount) : availableAmount;

    if (amountToApply <= 0) {
      await db.run('ROLLBACK');
            return res.status(400).json({ error: 'No available amount to apply' });
    }

    // Get the purchase bill
    const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purchase_id]);
    if (!purchase) {
      await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Purchase not found' });
    }

    // Update purchase total
    const newTotal = Math.max(0, purchase.total_amount - amountToApply);
    await db.run('UPDATE purchases SET total_amount = ? WHERE id = ?', [newTotal, purchase_id]);

    // Update credit note
    const newAppliedAmount = cn.applied_amount + amountToApply;
    const newStatus = newAppliedAmount >= cn.amount ? 'applied' : 'pending';
    
    await db.run(
      `UPDATE credit_notes 
       SET applied_amount = ?, applied_to_purchase_id = ?, applied_date = CURRENT_TIMESTAMP, status = ?
       WHERE id = ?`,
      [newAppliedAmount, purchase_id, newStatus, cn_id]
    );

    // Log the action
    await db.run(
      `INSERT INTO action_logs (action_type, description) 
       VALUES ('APPLY_CREDIT_NOTE', ?)`,
      [`Applied ₹${amountToApply} from CN #${cn.cn_number || cn.id} to purchase ID ${purchase_id}. New bill total: ₹${newTotal}`]
    );

    await db.run('COMMIT');
    
    res.json({ 
      success: true, 
      message: `₹${amountToApply} credit note applied successfully`,
      newPurchaseTotal: newTotal,
      remainingCN: availableAmount - amountToApply
    });
  } catch (error) {
    console.error('Apply CN error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a credit note (only if pending)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const db = await dbManager.getConnection();

    const cn = await db.get('SELECT * FROM credit_notes WHERE id = ?', [id]);
    if (!cn) {
            return res.status(404).json({ error: 'Credit note not found' });
    }

    if (cn.status !== 'pending') {
            return res.status(400).json({ error: 'Can only delete pending credit notes' });
    }

    await db.run('DELETE FROM credit_notes WHERE id = ?', [id]);

    await db.run(
      `INSERT INTO action_logs (action_type, description) 
       VALUES ('DELETE_CREDIT_NOTE', ?)`,
      [`Deleted CN #${cn.cn_number || cn.id} for distributor ID ${cn.distributor_id}`]
    );

        res.json({ success: true, message: 'Credit note deleted' });
  } catch (error) {
    console.error('Delete CN error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
