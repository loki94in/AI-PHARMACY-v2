import express from 'express';
import fs from 'fs';
import { dbManager } from '../database/connection.js';

const router = express.Router();

router.get('/catalog/job/:id', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const job = await db.get(`SELECT * FROM catalog_jobs WHERE id = ?`, req.params.id);
    await dbManager.close();
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    let previewData: any[] = [];
    let headers: string[] = [];
    let suggestedMapping = {};
    
    if (job.extracted_data) {
      try {
        const extracted = JSON.parse(job.extracted_data);
        if (extracted.previewData) previewData = extracted.previewData;
        if (extracted.headers) headers = extracted.headers;
        if (extracted.suggestedMapping) suggestedMapping = extracted.suggestedMapping;
      } catch (e) {
        console.error('Failed to parse extracted_data JSON', e);
      }
    }
    
    res.json({ 
      success: true, 
      jobId: job.id, 
      status: job.status,
      totalCount: job.total_count || 0,
      existingCount: job.existing_count || 0,
      newCount: job.new_count || 0,
      duplicateCount: job.duplicate_count || 0,
      progress: job.progress || 0,
      processedCount: job.processed_count || 0,
      errorLog: job.error_log || null,
      original_filename: job.original_filename,
      extractedData: job.extracted_data ? JSON.parse(job.extracted_data) : [],
      previewData,
      headers,
      suggestedMapping,
      mappingConfig: job.mapping_config ? JSON.parse(job.mapping_config) : null,
      matchedPreviousJobId: job.matched_previous_job_id || null,
      newlyDetectedColumns: job.newly_detected_columns ? JSON.parse(job.newly_detected_columns) : []
    });
  } catch (error) {
    console.error('Fetch job error:', error);
    res.status(500).json({ error: 'Internal server error fetching job' });
  }
});

// Pause a catalog ingestion job
router.post('/catalog/job/:id/pause', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
    
    if (!job) {
      await dbManager.close();
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'processing') {
      await dbManager.close();
      return res.status(400).json({ error: 'Only actively processing jobs can be paused' });
    }

    await db.run("UPDATE catalog_jobs SET status = 'paused' WHERE id = ?", jobId);
    await dbManager.close();

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('catalog_job_update', { 
      id: jobId, 
      status: 'paused', 
      progress: job.progress || 0,
      total_count: job.total_count || 0,
      new_count: job.new_count || 0,
      existing_count: job.existing_count || 0,
      duplicate_count: job.duplicate_count || 0
    });

    res.json({ success: true, message: 'Ingestion paused' });
  } catch (error) {
    console.error('Pause job error:', error);
    res.status(500).json({ error: 'Internal server error pausing job' });
  }
});

// Resume a catalog ingestion job
router.post('/catalog/job/:id/resume', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
    
    if (!job) {
      await dbManager.close();
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'paused') {
      await dbManager.close();
      return res.status(400).json({ error: 'Only paused jobs can be resumed' });
    }

    await db.run("UPDATE catalog_jobs SET status = 'pending' WHERE id = ?", jobId);
    await dbManager.close();

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('catalog_job_update', { 
      id: jobId, 
      status: 'pending', 
      progress: job.progress || 0,
      total_count: job.total_count || 0,
      new_count: job.new_count || 0,
      existing_count: job.existing_count || 0,
      duplicate_count: job.duplicate_count || 0
    });

    import('../worker/catalogWorker.js')
      .then(({ runCatalogImport }) => {
        runCatalogImport(jobId).catch(err => console.error('Resumed background catalog import failed:', err));
      })
      .catch(err => console.error('Failed to load runCatalogImport from worker:', err));

    res.json({ success: true, message: 'Ingestion resumed' });
  } catch (error) {
    console.error('Resume job error:', error);
    res.status(500).json({ error: 'Internal server error resuming job' });
  }
});

// Trigger Catalogue Background Import Job with customized mappings
router.post('/catalog/import-job/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const { mappings, filters } = req.body;

    if (!mappings || typeof mappings !== 'object') {
      return res.status(400).json({ error: 'Invalid or missing mappings configuration' });
    }

    const db = await dbManager.getConnection();
    const job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
    
    if (!job) {
      await dbManager.close();
      return res.status(404).json({ error: 'Job not found' });
    }

    // Save mappings to catalog_mappings for smart learning
    const headers = Object.keys(mappings);
    const headerKey = headers.slice().sort().join(',');
    try {
      await db.run(
        'INSERT OR REPLACE INTO catalog_mappings (file_headers, mapping_json) VALUES (?, ?)',
        [headerKey, JSON.stringify(mappings)]
      );
    } catch (learnErr) {
      console.warn('Smart learning mapping save failed:', learnErr);
    }

    // Set status to pending and save mapping config on the job
    await db.run(
      'UPDATE catalog_jobs SET mapping_config = ?, data_filters = ?, status = "pending", progress = 0, processed_count = 0, new_count = 0, existing_count = 0, duplicate_count = 0 WHERE id = ?',
      [JSON.stringify(mappings), JSON.stringify(filters || {}), jobId]
    );
    await dbManager.close();

    // Start background import worker process asynchronously
    import('../worker/catalogWorker.js')
      .then(({ runCatalogImport }) => {
        runCatalogImport(jobId).catch(err => console.error('Background catalog import failed:', err));
      })
      .catch(err => console.error('Failed to load runCatalogImport from worker:', err));

    res.json({ success: true, message: 'Import started in the background' });
  } catch (error) {
    console.error('Import job trigger error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New Catalog Import Endpoint (Receives confirmed preview data)
router.post('/catalog/import', async (req, res) => {
  const { medicines } = req.body;
  if (!Array.isArray(medicines)) {
    return res.status(400).json({ error: 'Invalid payload, expected array of medicines' });
  }
  
  try {
    const db = await dbManager.getConnection();
    
    const { normalizeMedicineName } = await import('../utils/nameNormalizer.js');
    
    for (const med of medicines) {
      if (!med.name) continue;
      
      const cleanName = med.name.trim();
      const adjustedName = normalizeMedicineName(cleanName, med.manufacturer);
      
      const existing = await db.get(`SELECT id FROM medicines WHERE lower(name) = lower(?)`, adjustedName);
      if (existing) {
        const updates = ["name = ?"];
        const params = [adjustedName];
        
        if (med.manufacturer) { updates.push("manufacturer = COALESCE(NULLIF(manufacturer, ''), ?)"); params.push(med.manufacturer); }
        if (med.marketed_by) { updates.push("marketed_by = COALESCE(NULLIF(marketed_by, ''), ?)"); params.push(med.marketed_by); }
        if (med.api_reference) { updates.push("api_reference = COALESCE(NULLIF(api_reference, ''), ?)"); params.push(med.api_reference); }
        if (med.strength) { updates.push("strength = COALESCE(NULLIF(strength, ''), ?)"); params.push(med.strength); }
        if (med.packaging_type) { updates.push("packaging = COALESCE(NULLIF(packaging, ''), ?)"); params.push(med.packaging_type); }
        
        params.push(existing.id);
        const setClause = updates.join(', ');
        await db.run(`UPDATE medicines SET ${setClause} WHERE id = ?`, ...params);
      } else {
        await db.run(
          `INSERT INTO medicines (name, api_reference, strength, packaging, manufacturer, marketed_by) VALUES (?, ?, ?, ?, ?, ?)`,
          adjustedName,
          med.api_reference || null,
          med.strength || null,
          med.packaging_type || null,
          med.manufacturer || null,
          med.marketed_by || null
        );
      }
    }
    
    await dbManager.close();
    res.json({ success: true, message: 'Catalog imported successfully' });
  } catch (error) {
    await dbManager.close();
    console.error('Import error:', error);
    res.status(500).json({ error: 'Internal server error during import' });
  }
});

// API to fetch all catalog jobs
router.get('/jobs', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const jobs = await db.all('SELECT * FROM catalog_jobs ORDER BY created_at DESC');
    await dbManager.close();
    res.json(jobs);
  } catch (error) {
    await dbManager.close();
    console.error('Failed to fetch jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a catalog ingestion job
router.delete('/catalog/job/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const db = await dbManager.getConnection();
    const job = await db.get('SELECT * FROM catalog_jobs WHERE id = ?', jobId);
    
    if (!job) {
      await dbManager.close();
      return res.status(404).json({ error: 'Job not found' });
    }

    // Attempt to delete physical file if it exists
    if (job.file_path && fs.existsSync(job.file_path)) {
      try {
        fs.unlinkSync(job.file_path);
      } catch (err) {
        console.warn(`[Catalog] Failed to delete physical file: ${job.file_path}`, err);
      }
    }

    await db.run('DELETE FROM catalog_jobs WHERE id = ?', jobId);
    await dbManager.close();

    res.json({ success: true, message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Internal server error deleting job' });
  }
});

// Fetch staged reviews for a catalog job
router.get('/catalog/job/:id/reviews', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const reviews = await db.all(
      'SELECT * FROM staged_medicine_reviews WHERE job_id = ? ORDER BY id ASC',
      req.params.id
    );
    await dbManager.close();
    
    const parsedReviews = reviews.map(r => ({
      ...r,
      original_row_data: r.original_row_data ? JSON.parse(r.original_row_data) : null,
      extracted_json: r.extracted_json ? JSON.parse(r.extracted_json) : null,
      approved_json: r.approved_json ? JSON.parse(r.approved_json) : null
    }));
    
    res.json({ success: true, reviews: parsedReviews });
  } catch (error: any) {
    console.error('Fetch reviews error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Approve staged review record
router.post('/catalog/review/:id/approve', async (req, res) => {
  const { approvedData } = req.body;
  try {
    const db = await dbManager.getConnection();
    const review = await db.get('SELECT * FROM staged_medicine_reviews WHERE id = ?', req.params.id);
    
    if (!review) {
      await dbManager.close();
      return res.status(404).json({ error: 'Review not found' });
    }
    
    const job = await db.get('SELECT mapping_config FROM catalog_jobs WHERE id = ?', review.job_id);
    const mapping = job && job.mapping_config ? JSON.parse(job.mapping_config) : {};
    const row = review.original_row_data ? JSON.parse(review.original_row_data) : {};
    
    // 1. Create or update medicine
    const key = review.medicine_name.toLowerCase().trim();
    
    let med = await db.get('SELECT id FROM medicines WHERE lower(name) = ?', key);
    if (!med) {
      const alias = await db.get('SELECT medicine_id FROM medicine_aliases WHERE lower(alias_name) = ?', key);
      if (alias) {
        med = await db.get('SELECT id FROM medicines WHERE id = ?', alias.medicine_id);
      }
    }
    
    let medId = med ? med.id : null;
    
    const customMappings = Object.entries(mapping)
      .filter(([csvCol, targetCol]) => targetCol && String(targetCol).startsWith('custom_col_'))
      .map(([csvCol, targetCol]) => ({
        csvCol,
        dbCol: String(targetCol).substring(11).trim().replace(/\s+/g, '_').toLowerCase()
      }));
      
    if (medId) {
      const updates: string[] = ["name = ?", "api_reference = ?"];
      const params: any[] = [approvedData.name || review.medicine_name, approvedData.api_reference || null];
      
      if (approvedData.strength !== undefined) { updates.push("strength = ?"); params.push(approvedData.strength); }
      if (approvedData.packaging !== undefined) { updates.push("packaging = ?"); params.push(approvedData.packaging); }
      if (approvedData.manufacturer !== undefined) { updates.push("manufacturer = ?"); params.push(approvedData.manufacturer); }
      if (approvedData.marketed_by !== undefined) { updates.push("marketed_by = ?"); params.push(approvedData.marketed_by); }
      if (row.hsn_code !== undefined) { updates.push("hsn_code = ?"); params.push(row.hsn_code); }
      if (row.schedule_type !== undefined) { updates.push("schedule_type = ?"); params.push(row.schedule_type); }
      if (row.mrp !== undefined) { updates.push("mrp = ?"); params.push(parseFloat(row.mrp) || 0); }
      
      for (const cm of customMappings) {
        if (row[cm.csvCol] !== undefined) {
          updates.push(`"${cm.dbCol}" = ?`);
          params.push(row[cm.csvCol]);
        }
      }
      
      params.push(medId);
      await db.run(`UPDATE medicines SET ${updates.join(', ')} WHERE id = ?`, ...params);
    } else {
      const columns = ['name', 'api_reference', 'strength', 'packaging', 'manufacturer', 'marketed_by', 'hsn_code', 'schedule_type', 'mrp'];
      const placeholders = ['?', '?', '?', '?', '?', '?', '?', '?', '?'];
      const params = [
        approvedData.name || review.medicine_name,
        approvedData.api_reference || null,
        approvedData.strength || null,
        approvedData.packaging || null,
        approvedData.manufacturer || null,
        approvedData.marketed_by || null,
        row.hsn_code || null,
        row.schedule_type || null,
        parseFloat(row.mrp) || 0
      ];
      
      for (const cm of customMappings) {
        columns.push(`"${cm.dbCol}"`);
        placeholders.push('?');
        params.push(row[cm.csvCol] !== undefined ? row[cm.csvCol] : null);
      }
      
      const result = await db.run(
        `INSERT INTO medicines (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        params
      );
      medId = result.lastID!;
    }
    
    // 2. Learning
    if (approvedData.api_reference) {
      try {
        await db.run(
          `INSERT OR REPLACE INTO medicine_reference (name, composition1, composition2, manufacturer) VALUES (?, ?, ?, ?)`,
          [
            approvedData.name || review.medicine_name,
            approvedData.api_reference,
            null,
            approvedData.manufacturer || null
          ]
        );
      } catch (refErr) {
        console.warn('Continuous learning save failed:', refErr);
      }
    }
    
    // 3. Stock
    const qtyCol = Object.keys(mapping).find(k => mapping[k] === 'quantity');
    const batchCol = Object.keys(mapping).find(k => mapping[k] === 'batch_no');
    const expCol = Object.keys(mapping).find(k => mapping[k] === 'expiry_date');
    
    if (qtyCol || batchCol || expCol) {
      const qty = qtyCol ? parseInt(row[qtyCol], 10) || 0 : 0;
      const batchNo = batchCol ? String(row[batchCol] || '').trim() : 'B-CATALOG';
      const expiry = expCol ? String(row[expCol] || '').trim() : '2028-12-31';
      const mrpVal = parseFloat(row.mrp) || 0;
      
      const existingInv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, batchNo]);
      if (existingInv) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [qty, existingInv.id]);
      } else {
        await db.run(
          'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp) VALUES (?, ?, ?, ?, ?)',
          [medId, qty, batchNo, expiry, mrpVal]
        );
      }
    }
    
    // 4. Update status
    await db.run(
      "UPDATE staged_medicine_reviews SET status = 'approved', approved_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(approvedData), req.params.id]
    );
    
    // 5. Update catalog job counter
    if (review.job_id) {
      await db.run(
        "UPDATE catalog_jobs SET new_count = new_count + 1 WHERE id = ?",
        review.job_id
      );
    }
    
    await dbManager.close();
    
    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('catalog_review_updated', {
      jobId: review.job_id,
      reviewId: review.id,
      status: 'approved'
    });
    
    res.json({ success: true, message: 'Approved successfully.' });
  } catch (error: any) {
    console.error('Approve review error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Reject staged review record
router.post('/catalog/review/:id/reject', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      "UPDATE staged_medicine_reviews SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      req.params.id
    );
    
    const review = await db.get('SELECT job_id FROM staged_medicine_reviews WHERE id = ?', req.params.id);
    await dbManager.close();
    
    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('catalog_review_updated', {
      jobId: review ? review.job_id : null,
      reviewId: req.params.id,
      status: 'rejected'
    });
    
    res.json({ success: true, message: 'Rejected successfully.' });
  } catch (error: any) {
    console.error('Reject review error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Manually trigger enrichment for a staged review record
router.post('/catalog/review/:id/enrich', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const review = await db.get('SELECT * FROM staged_medicine_reviews WHERE id = ?', req.params.id);
    
    if (!review) {
      await dbManager.close();
      return res.status(404).json({ error: 'Staged review not found' });
    }
    
    await dbManager.close();
    
    res.json({ success: true, message: 'Enrichment triggered in background.' });
    
    (async () => {
      try {
        const { googleSearchService } = await import('../services/googleSearchService.js');
        const searchResult = await googleSearchService.discoverMedicineInfo(review.medicine_name);
        
        if (searchResult) {
          const extractedJson = JSON.stringify({
            api_reference: searchResult.api_reference || '',
            strength: searchResult.strength || '',
            manufacturer: searchResult.manufacturer || '',
            dosage_form: searchResult.dosage_form || '',
            pack_info: searchResult.pack_info || '',
            therapeutic_class: searchResult.therapeutic_class || ''
          });
          
          const activeDb = await dbManager.getConnection();
          await activeDb.run(
            "UPDATE staged_medicine_reviews SET screenshot_path = ?, raw_ocr_text = ?, extracted_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [
              searchResult.screenshot_path || null,
              searchResult.raw_text || null,
              extractedJson,
              review.id
            ]
          );
          await activeDb.close();
          
          const { eventService } = await import('../services/eventService.js');
          eventService.broadcast('catalog_review_updated', {
            jobId: review.job_id,
            reviewId: review.id,
            status: 'enriched'
          });
        }
      } catch (enrichErr) {
        console.error('Manual background enrichment failed:', enrichErr);
      }
    })();
    
  } catch (error: any) {
    console.error('Trigger enrichment error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get daily google search usage stats
router.get('/catalog/search-status', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const limitRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_search_daily_limit'");
    const limit = limitRow ? parseInt(limitRow.value, 10) : 50;
    
    const countRow = await db.get(
      "SELECT COUNT(*) as count FROM google_search_logs WHERE created_at >= datetime('now', '-1 day')"
    );
    const count = countRow ? countRow.count : 0;
    await dbManager.close();
    
    res.json({ success: true, count, limit });
  } catch (error: any) {
    console.error('Search status check error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
