import express from 'express';
import { dbManager } from '../database/connection.js';
import { loadReferenceData, getEnrichmentStatus, runEnrichment, getEnrichmentRunningState } from '../worker/compositionEnricher.js';

const router = express.Router();

// Get enrichment status
router.get('/enrichment/status', async (_req, res) => {
  try {
    const status = await getEnrichmentStatus();
    res.json(status);
  } catch (error) {
    console.error('Failed to get enrichment status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start enrichment process
router.post('/enrichment/start', async (_req, res) => {
  try {
    if (getEnrichmentRunningState()) {
      return res.status(409).json({ error: 'Enrichment is already running' });
    }

    // First ensure reference data is loaded
    const loadResult = await loadReferenceData();
    console.log('Reference data status:', loadResult);

    // Run enrichment in background (don't await)
    runEnrichment((pct, matched) => {
      // Progress logged in the worker
    }).catch(err => console.error('Enrichment failed:', err));

    res.json({ success: true, message: 'Enrichment started in background' });
  } catch (error) {
    console.error('Failed to start enrichment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get enrichment queue (medicines needing manual review)
router.get('/enrichment/queue', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const filter = (req.query.filter as string) || 'all'; // 'all', 'needs_review', 'unmatched'
    const offset = (page - 1) * limit;

    const db = await dbManager.getConnection();

    let whereClause = "WHERE enrichment_status IN ('needs_review', 'unmatched')";
    if (filter === 'needs_review') whereClause = "WHERE enrichment_status = 'needs_review'";
    if (filter === 'unmatched') whereClause = "WHERE enrichment_status = 'unmatched'";

    const countRow = await db.get(`SELECT COUNT(*) as total FROM medicines ${whereClause}`);
    const totalItems = countRow?.total || 0;

    const items = await db.all(
      `SELECT id, name, manufacturer, api_reference, enrichment_status, enrichment_confidence FROM medicines ${whereClause} ORDER BY enrichment_confidence DESC LIMIT ? OFFSET ?`,
      limit, offset
    );

    // For needs_review items, find the suggested composition from reference
    for (const item of items) {
      if (item.enrichment_status === 'needs_review') {
        const ref = await db.get(
          `SELECT composition1, composition2, name as ref_name FROM medicine_reference WHERE name LIKE ? LIMIT 1`,
          `%${item.name.split(' ')[0]}%`
        );
        if (ref) {
          item.suggested_composition = [ref.composition1, ref.composition2].filter(Boolean).join(' + ');
          item.ref_name = ref.ref_name;
        }
      }
    }

    await dbManager.close();

    res.json({
      data: items,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Failed to get enrichment queue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manually set composition for a medicine
router.put('/enrichment/queue/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { composition } = req.body;

    if (!composition || !composition.trim()) {
      return res.status(400).json({ error: 'Composition is required' });
    }

    const db = await dbManager.getConnection();
    await db.run(
      "UPDATE medicines SET api_reference = ?, enrichment_status = 'manual', enrichment_confidence = 1.0 WHERE id = ?",
      composition.trim(), id
    );
    await dbManager.close();

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update composition:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
