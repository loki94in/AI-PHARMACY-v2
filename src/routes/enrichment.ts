import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { dbManager } from '../database/connection.js';
import { loadReferenceData, getEnrichmentStatus, runEnrichment, getEnrichmentRunningState, requestEnrichmentStop, ensureEnrichmentColumns, backfillSuggestedCompositions, reclassifyNonPharmaProducts, DOSAGE_FORM_SET } from '../worker/compositionEnricher.js';
import { onlineDataEnricher } from '../services/onlineDataEnricher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const REFERENCE_CSV = path.join(DATA_DIR, 'reference_medicines.csv');

const router = express.Router();

// multer: memory storage for reference CSV uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Get enrichment status ────────────────────────────────────────────────────
router.get('/enrichment/status', async (_req, res) => {
  try {
    const status = await getEnrichmentStatus();
    res.json(status);
  } catch (error) {
    console.error('Failed to get enrichment status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Start enrichment process ─────────────────────────────────────────────────
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

// ─── Stop enrichment process ──────────────────────────────────────────────────
router.post('/enrichment/stop', async (_req, res) => {
  try {
    if (!getEnrichmentRunningState()) {
      return res.status(409).json({ error: 'Enrichment is not currently running' });
    }
    requestEnrichmentStop();
    res.json({ success: true, message: 'Stop signal sent — enrichment will halt at next batch boundary' });
  } catch (error) {
    console.error('Failed to stop enrichment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Backfill suggested_composition for pre-existing needs_review rows ───────
// POST /api/enrichment/backfill-suggestions
// Re-scores medicines already marked needs_review that predate the
// suggested_composition column (or otherwise have it NULL), so they show a
// suggestion the user can accept instead of an empty composition field.
router.post('/enrichment/backfill-suggestions', async (_req, res) => {
  try {
    const result = await backfillSuggestedCompositions();
    res.json({ success: true, updated: result.updated });
  } catch (error) {
    console.error('Failed to backfill suggested compositions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Reclassify pre-existing cosmetic/surgical/ayurvedic/etc. rows ───────────
// POST /api/enrichment/reclassify-non-pharma
// One-time migration: moves rows already processed before isNonPharmaCategory
// existed into 'non_pharma' status so they stop showing in the review queue.
router.post('/enrichment/reclassify-non-pharma', async (_req, res) => {
  try {
    const result = await reclassifyNonPharmaProducts();
    res.json({ success: true, updated: result.updated });
  } catch (error) {
    console.error('Failed to reclassify non-pharma products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Reload reference from the already-saved CSV on disk ─────────────────────
// POST /api/enrichment/reference/reload-from-disk
// Useful when the CSV is already at data/reference_medicines.csv — avoids large HTTP upload.
router.post('/enrichment/reference/reload-from-disk', async (_req, res) => {
  try {
    const result = await loadReferenceData({ force: true });
    res.json({ success: true, loaded: result.loaded, skipped: result.skipped });
  } catch (error) {
    console.error('Failed to reload reference from disk:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Import salt master CSV ───────────────────────────────────────────────────
// POST /api/enrichment/reference/import
// Accepts multipart CSV; saves to data/reference_medicines.csv; force-reloads into medicine_reference.
router.post('/enrichment/reference/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'Only CSV files are accepted' });
    }

    // Save to disk atomically
    const tmpPath = REFERENCE_CSV + '.tmp';
    fs.writeFileSync(tmpPath, req.file.buffer);
    fs.renameSync(tmpPath, REFERENCE_CSV);

    // Force-reload into medicine_reference table
    const result = await loadReferenceData({ force: true });

    res.json({ success: true, loaded: result.loaded, skipped: result.skipped });
  } catch (error) {
    console.error('Failed to import reference CSV:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Export salt master CSV ───────────────────────────────────────────────────
// GET /api/enrichment/reference/export
// Streams medicine_reference table as CSV.
router.get('/enrichment/reference/export', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT name, composition1, composition2, manufacturer FROM medicine_reference ORDER BY name');
    await dbManager.close();

    const header = 'name,short_composition1,short_composition2,manufacturer_name\n';
    const body = rows.map(r => {
      const escape = (v: string | null) => {
        const s = (v || '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      };
      return [escape(r.name), escape(r.composition1), escape(r.composition2), escape(r.manufacturer)].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reference_medicines.csv"');
    res.send(header + body);
  } catch (error) {
    console.error('Failed to export reference CSV:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Export verified compositions CSV ────────────────────────────────────────
// GET /api/enrichment/export?status=manual
// Streams verified medicines as CSV.
router.get('/enrichment/export', async (req, res) => {
  try {
    const status = (req.query.status as string) || 'manual';
    const allowed = ['manual', 'matched', 'needs_review'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }

    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT name, api_reference, manufacturer FROM medicines WHERE enrichment_status = ? ORDER BY name`,
      status
    );
    await dbManager.close();

    const header = 'name,api_reference,manufacturer\n';
    const body = rows.map(r => {
      const escape = (v: string | null) => {
        const s = (v || '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      };
      return [escape(r.name), escape(r.api_reference), escape(r.manufacturer)].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="verified_medicines_${status}.csv"`);
    res.send(header + body);
  } catch (error) {
    console.error('Failed to export verified CSV:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get enrichment queue ─────────────────────────────────────────────────────
router.get('/enrichment/queue', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const filter = (req.query.filter as string) || 'all'; // 'all', 'needs_review', 'unmatched', 'non_pharma'
    const offset = (page - 1) * limit;

    const db = await dbManager.getConnection();
    await ensureEnrichmentColumns(db);

    // 'all' intentionally excludes 'non_pharma' — those are auto-skipped
    // cosmetic/surgical/ayurvedic/etc. items, not things needing review.
    // filter=non_pharma is available for admin auditing of what got skipped.
    let whereClause = "WHERE enrichment_status IN ('needs_review', 'unmatched')";
    if (filter === 'needs_review') whereClause = "WHERE enrichment_status = 'needs_review'";
    if (filter === 'unmatched') whereClause = "WHERE enrichment_status = 'unmatched'";
    if (filter === 'non_pharma') whereClause = "WHERE enrichment_status = 'non_pharma'";

    const countRow = await db.get(`SELECT COUNT(*) as total FROM medicines ${whereClause}`);
    const totalItems = countRow?.total || 0;

    // suggested_composition is stored at enrichment time from the exact same
    // reference row that produced enrichment_confidence — no N+1 lookup needed.
    const items = await db.all(
      `SELECT id, name, manufacturer, api_reference, enrichment_status, enrichment_confidence, suggested_composition FROM medicines ${whereClause} ORDER BY enrichment_confidence DESC LIMIT ? OFFSET ?`,
      limit, offset
    );

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

// ─── Manually set composition for a medicine ──────────────────────────────────
router.put('/enrichment/queue/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { composition } = req.body;

    if (!composition || !composition.trim()) {
      return res.status(400).json({ error: 'Composition is required' });
    }

    const db = await dbManager.getConnection();
    await ensureEnrichmentColumns(db);
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

// ─── Preview token classification for a medicine name ────────────────────────
// GET /api/enrichment/preview-tokens?name=<raw_name>
// Splits the raw name into tokens and marks each as included/excluded using
// the same DOSAGE_FORM_SET logic as cleanMedicineName(). The UI uses this
// to render the token chip selector.
router.get('/enrichment/preview-tokens', (_req, res) => {
  const rawName = ((_req.query.name as string) || '').trim();
  if (!rawName) {
    return res.status(400).json({ error: 'name query param is required' });
  }

  // Split on whitespace + common separators, preserving original casing for display
  const rawTokens = rawName.split(/[\s\-\/]+/).filter(t => t.length > 0);

  const tokens = rawTokens.map(token => {
    const upper = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isPureNumber = /^\d+$/.test(upper);
    const isDosageAmount = /^\d+(MG|ML|MCG|GM|IU|NO|NOS|S)$/i.test(upper);
    const isDosageForm = DOSAGE_FORM_SET.has(upper);
    const included = !isPureNumber && !isDosageAmount && !isDosageForm && upper.length > 0;
    return { text: token, included };
  });

  const preview = tokens
    .filter(t => t.included)
    .map(t => t.text.toUpperCase())
    .join(' ');

  res.json({ tokens, preview });
});

// ─── Save user's custom search term for a medicine ───────────────────────────
// POST /api/enrichment/set-search-term
// Body: { id: number, searchTerm: string }
// Saves search_term_override to DB so future online enrichment uses it.
router.post('/enrichment/set-search-term', async (req, res) => {
  try {
    const id = parseInt(req.body.id);
    const searchTerm = (req.body.searchTerm || '').trim();
    if (!id || !searchTerm) {
      return res.status(400).json({ error: 'id and searchTerm are required' });
    }

    const db = await dbManager.getConnection();
    await ensureEnrichmentColumns(db);
    await db.run(
      'UPDATE medicines SET search_term_override = ? WHERE id = ?',
      searchTerm, id
    );
    await dbManager.close();

    res.json({ success: true, searchTerm });
  } catch (error) {
    console.error('Failed to set search term override:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Trigger online enrichment for a single medicine ─────────────────────────
// POST /api/enrichment/trigger-online/:id
// Fires the full online enrichment pipeline (OpenFDA → RxNorm → Google)
// using the saved search_term_override for the Google query.
router.post('/enrichment/trigger-online/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const db = await dbManager.getConnection();
    await ensureEnrichmentColumns(db);
    const row = await db.get(
      'SELECT name, search_term_override FROM medicines WHERE id = ?',
      id
    );
    await dbManager.close();

    if (!row) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    // Fire-and-forget — responds immediately, enrichment runs in background
    onlineDataEnricher.enrichMedicineByName(
      row.name,
      row.search_term_override || undefined
    ).catch(err => console.warn('[Enricher] Manual trigger failed:', err));

    res.json({ success: true, medicineName: row.name, searchTerm: row.search_term_override || null });
  } catch (error) {
    console.error('Failed to trigger online enrichment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
