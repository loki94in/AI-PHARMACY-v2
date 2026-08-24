import express from 'express';
import { dbManager } from '../database/connection.js';
import { researchMedicineSchedule } from '../services/scheduleResearchService.js';
import type { ScheduleType } from '../utils/drugSchedules.js';

const router = express.Router();

const VALID_TYPES = new Set(['H1', 'H', 'X']);
const MAX_LIMIT = 100;

function normalizeType(raw: unknown): string | null {
  const t = String(raw || '').trim().toUpperCase().replace(/^SCHEDULE\s*/, '');
  return VALID_TYPES.has(t) ? t : null;
}

interface ScheduleRow {
  id: number;
  name: string;
  generic_name: string | null;
  manufacturer: string | null;
  mrp: number | null;
  pack_unit: string | null;
  packaging: string | null;
  schedule_type: string | null;
  stock: number | null;
}

// Aggregate live stock per medicine from active inventory batches.
const STOCK_JOIN = `
  LEFT JOIN (
    SELECT medicine_id, SUM(quantity + COALESCE(loose_quantity, 0)) AS stock
    FROM inventory_master
    WHERE is_active = 1
    GROUP BY medicine_id
  ) inv ON inv.medicine_id = m.id`;

/**
 * GET /api/schedule-drugs/summary
 * Counts of master medicines classified under Schedule H / H1 / X.
 */
router.get('/summary', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    // Sargable IN-list on the indexed schedule_type column — never wrap the
    // column in UPPER()/TRIM() or this becomes a 291k-row full scan.
    const rows: Array<{ schedule_type: string; c: number }> = await db.all(`
      SELECT schedule_type, COUNT(*) AS c
      FROM medicines
      WHERE schedule_type IN ('H', 'H1', 'X', 'Schedule H1')
      GROUP BY schedule_type
    `);
    let h1 = 0, h = 0, x = 0;
    for (const r of rows) {
      if (r.schedule_type === 'H1' || r.schedule_type === 'Schedule H1') h1 += r.c;
      else if (r.schedule_type === 'H') h += r.c;
      else if (r.schedule_type === 'X') x += r.c;
    }
    res.json({ success: true, h1, h, x, total: h1 + h + x });
  } catch (err) {
    console.error('Schedule drugs summary error:', err);
    res.status(500).json({ error: 'Failed to load schedule summary' });
  }
});

/**
 * GET /api/schedule-drugs?type=H1|H|X&q=&stock=in|out&page=1&limit=50
 * Single paged listing of scheduled medicines (master catalog + live stock).
 */
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const type = normalizeType(String(req.query.type || ''));
    const q = String(req.query.q || '').trim();
    const stock = String(req.query.stock || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    // Sargable schedule filter — classified rows carry exactly these canonical
    // values (legacy 'Schedule H1' spelling kept for safety). The IN-list lets
    // idx_medicines_schedule_type prune before the name sort.
    const conditions: string[] = [`m.schedule_type IN ('H', 'H1', 'X', 'Schedule H1')`];
    const params: Array<string | number> = [];

    if (type) {
      conditions.push(type === 'H1'
        ? "m.schedule_type IN ('H1', 'Schedule H1')"
        : 'm.schedule_type = ?');
      if (type !== 'H1') params.push(type);
    }

    // Prefix-first search (idx_medicines_name range scan); middle-word fallback
    // runs as a second pass below ONLY when the prefix pass came up thin.
    let likeClause = '';
    let likeParams: string[] = [];
    if (q.length >= 2) {
      likeClause = 'AND (m.name LIKE ? OR m.generic_name LIKE ?)';
      likeParams = [`${q}%`, `${q}%`];
    }

    const sql = (extraLike: string, extraParams: string[], orderLimit: string) => `
      SELECT m.id, m.name, m.generic_name, m.manufacturer, m.mrp,
             m.pack_unit, m.packaging, m.schedule_type, inv.stock
      FROM medicines m
      ${STOCK_JOIN}
      WHERE ${conditions.join(' AND ')} ${extraLike}
      ${orderLimit}`;

    const stockFilterSql = stock === 'in'
      ? 'AND inv.stock > 0'
      : stock === 'out'
        ? "AND COALESCE(inv.stock, 0) <= 0"
        : '';

    // Fetch one extra row to compute hasMore without a full COUNT(*).
    let rows: ScheduleRow[] = await db.all(
      sql(`${likeClause} ${stockFilterSql}`, likeParams, `ORDER BY m.name LIMIT ${limit + 1} OFFSET ${offset}`),
      [...params, ...likeParams]
    );

    if (q.length >= 2 && rows.length < Math.min(limit, 15) && page === 1 && !stock) {
      // Middle-word fallback for tokens that are not name prefixes.
      const midParams = [`%${q}%`, `%${q}%`];
      const midRows: ScheduleRow[] = await db.all(
        sql(likeClause, midParams, `ORDER BY m.name LIMIT ${limit + 1}`),
        [...params, ...midParams]
      );
      const seen = new Set(rows.map((r: ScheduleRow) => r.id));
      for (const r of midRows) {
        if (!seen.has(r.id)) rows.push(r);
      }
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);

    res.json({ success: true, page, limit, hasMore, items: rows });
  } catch (err) {
    console.error('Schedule drugs list error:', err);
    res.status(500).json({ error: 'Failed to load schedule medicines' });
  }
});

/**
 * GET /api/schedule-drugs/unclassified?q=&page=&limit=
 * Newly added master medicines the offline classifier could NOT place — the
 * human-in-the-loop review queue. Newest first.
 */
router.get('/unclassified', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const offset = (page - 1) * limit;

    const baseWhere = "(m.schedule_type IS NULL OR m.schedule_type IN ('None', ''))";
    const like = q.length >= 2 ? "AND (m.name LIKE ? OR COALESCE(m.generic_name, '') LIKE ?)" : '';
    const params: string[] = q.length >= 2 ? [`${q}%`, `${q}%`] : [];

    interface UnclassifiedRow {
      id: number; name: string; generic_name: string | null;
      manufacturer: string | null; packaging: string | null; source: string | null;
    }
    let rows: UnclassifiedRow[] = await db.all(
      `SELECT m.id, m.name, m.generic_name, m.manufacturer, m.packaging, m.source
       FROM medicines m
       WHERE ${baseWhere} ${like}
       ORDER BY m.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      params,
    );
    if (q.length >= 2 && rows.length < Math.min(limit, 15) && page === 1) {
      // Middle-word fallback for tokens that are not name prefixes.
      const midParams = [`%${q}%`, `%${q}%`];
      const midRows: UnclassifiedRow[] = await db.all(
        `SELECT m.id, m.name, m.generic_name, m.manufacturer, m.packaging, m.source
         FROM medicines m
         WHERE ${baseWhere}
           AND (m.name LIKE ? OR COALESCE(m.generic_name, '') LIKE ?)
         ORDER BY m.id DESC LIMIT ${limit + 1}`,
        midParams,
      );
      const seen = new Set(rows.map((r) => r.id));
      for (const r of midRows) if (!seen.has(r.id)) rows.push(r);
    }

    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    res.json({ success: true, page, limit, hasMore, items: rows });
  } catch (err) {
    console.error('Schedule unclassified list error:', err);
    res.status(500).json({ error: 'Failed to load unclassified medicines' });
  }
});

/**
 * GET /api/schedule-drugs/research?id=
 * ONE Google search + ONE screenshot + OCR + schedule word match. READ-ONLY —
 * writes nothing; the pharmacist confirms via POST /classify.
 */
router.get('/research', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const id = parseInt(String(req.query.id || ''), 10);
    if (!id) return res.status(400).json({ error: 'id is required' });

    const med = await db.get(
      'SELECT id, name, generic_name, manufacturer, packaging, schedule_type FROM medicines WHERE id = ?',
      [id],
    );
    if (!med) return res.status(404).json({ error: 'Medicine not found' });
    if (med.schedule_type && !['None', '', null].includes(med.schedule_type)) {
      return res.status(400).json({ error: `Already classified as ${med.schedule_type}` });
    }

    const result = await researchMedicineSchedule({
      id: med.id,
      name: med.name,
      packaging: med.packaging,
      manufacturer: med.manufacturer,
    });
    res.json({ success: true, medicine: { id: med.id, name: med.name }, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Schedule research error:', err);
    if (msg === 'NO_CHROME') {
      return res.status(503).json({ error: 'Chrome not found on this machine — cannot run the Google lookup.' });
    }
    res.status(500).json({ error: `Google research failed: ${msg}` });
  }
});

const VALID_SAVE_TYPES = new Set(['H1', 'H', 'X']);

function mergeMetadata(existingJson: unknown, patch: Record<string, unknown>): string {
  let existing: Record<string, unknown> = {};
  try {
    const parsed = typeof existingJson === 'string' && existingJson.trim()
      ? JSON.parse(existingJson) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch { /* corrupt legacy metadata — replace rather than crash */ }
  return JSON.stringify({ ...existing, ...patch });
}

/**
 * POST /api/schedule-drugs/classify  { id, schedule_type: 'H1'|'H'|'X'|'NONE', evidence? }
 * HUMAN-CONFIRMED write only (human-in-the-loop contract): the schedule lands in
 * medicines.schedule_type exclusively after an explicit user click, with the OCR
 * evidence keywords stored in medicines.metadata for audit traceability.
 */
router.post('/classify', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const id = parseInt(String(req.body?.id || ''), 10);
    const rawType = String(req.body?.schedule_type || '').trim().toUpperCase().replace(/^SCHEDULE\s*/, '');
    const evidence = req.body?.evidence;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (rawType !== 'NONE' && !VALID_SAVE_TYPES.has(rawType)) {
      return res.status(400).json({ error: "schedule_type must be 'H1', 'H', 'X' or 'NONE'" });
    }

    const row = await db.get('SELECT id, metadata FROM medicines WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Medicine not found' });

    const metaPatch: Record<string, unknown> = {
      schedule_review: rawType === 'NONE' ? 'manual_none' : 'confirmed',
      schedule_source: 'google_serp_ocr_manual',
      reviewed_at: new Date().toISOString(),
    };
    if (rawType !== 'NONE' && evidence && Array.isArray(evidence.keywords)) {
      metaPatch.schedule_evidence = evidence.keywords.slice(0, 12);
    }
    await db.run(
      'UPDATE medicines SET schedule_type = ?, metadata = ? WHERE id = ?',
      [rawType === 'NONE' ? 'None' : rawType, mergeMetadata(row.metadata, metaPatch), id],
    );
    res.json({ success: true, id, schedule_type: rawType === 'NONE' ? 'None' : (rawType as ScheduleType) });
  } catch (err) {
    console.error('Schedule classify error:', err);
    res.status(500).json({ error: 'Failed to save classification' });
  }
});

export default router;
