import express from 'express';
import { dbManager } from '../database/connection.js';
import { runAudit } from '../utils/auditEngine.js';

const router = express.Router();

async function logAudit(db: any, report: Awaited<ReturnType<typeof runAudit>>) {
  const description = `${report.status} — ${report.blockingCount} blocking issue(s) across ${report.issueCategories}/${report.totalCategories} categories with findings`;
  const result = await db.run(
    'INSERT INTO action_logs (action_type, description, metadata) VALUES (?, ?, ?)',
    ['AUDIT', description, JSON.stringify(report)]
  );
  return result.lastID;
}

// Run a fresh audit against live data and persist the result.
router.post('/run', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const report = await runAudit(db);
    const id = await logAudit(db, report);
    res.json({ id, ...report });
  } catch (err: any) {
    console.error('Audit run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Most recently stored audit result, if any.
router.get('/latest', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT id, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' ORDER BY id DESC LIMIT 1"
    );
    if (!row) return res.json(null);
    res.json({ id: row.id, storedAt: row.created_at, ...JSON.parse(row.metadata) });
  } catch (err: any) {
    console.error('Audit latest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lightweight history list for reopening a past audit.
router.get('/history', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      "SELECT id, description, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' ORDER BY id DESC LIMIT 50"
    );
    const history = rows.map((r: any) => {
      let status = 'UNKNOWN';
      let blockingCount = 0;
      try {
        const meta = JSON.parse(r.metadata);
        status = meta.status;
        blockingCount = meta.blockingCount;
      } catch (_e) { /* tolerate malformed legacy rows */ }
      return { id: r.id, storedAt: r.created_at, description: r.description, status, blockingCount };
    });
    res.json(history);
  } catch (err: any) {
    console.error('Audit history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// A specific past audit by id.
router.get('/:id', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT id, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' AND id = ?",
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Audit not found' });
    res.json({ id: row.id, storedAt: row.created_at, ...JSON.parse(row.metadata) });
  } catch (err: any) {
    console.error('Audit fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
