import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

// GET / — list queued email order reviews, most recent first.
// Optional ?status=pending filter; defaults to returning all rows.
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { status } = req.query;
    let rows;
    if (status && typeof status === 'string') {
      rows = await db.all(
        'SELECT * FROM email_order_reviews WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT 1000',
        [status]
      );
    } else {
      rows = await db.all('SELECT * FROM email_order_reviews ORDER BY created_at DESC, id DESC LIMIT 1000');
    }
    res.json(rows);
  } catch (err) {
    console.error('List email order reviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/dismiss — mark a queued row as reviewed (user has handled it,
// either by manually creating the purchase via the Purchases page or
// deciding it wasn't a real order).
router.post('/:id/dismiss', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid review id' });
  }
  try {
    const db = await dbManager.getConnection();
    const result = await db.run(
      "UPDATE email_order_reviews SET status = 'reviewed' WHERE id = ?",
      [id]
    );
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Dismiss email order review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
